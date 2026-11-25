import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http,
  isAddress, keccak256, parseEventLogs, TransactionReceiptNotFoundError, type Hash, type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  xLayerTestnet, SentinelAccountAbi, SentinelAccountFactoryAbi, IsolatedControllerAbi,
  type DeploymentManifest
} from '@peridot/chain-config';

const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
function envAddress(name: string) {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw Error(`Expected an address in ${name}`);
  return getAddress(value);
}
async function once() {
  const chainId = Number(process.env.KEEPER_CHAIN_ID);
  if (chainId !== 31337 && chainId !== 1952) throw Error('Keeper requires chain 31337 or 1952');
  const rpc = new URL(process.env.KEEPER_RPC ?? (chainId === 31337 ? 'http://127.0.0.1:8545' : 'https://testrpc.xlayer.tech'));
  if (chainId === 31337 && !['127.0.0.1','localhost','[::1]'].includes(rpc.hostname)) throw Error('Local mode requires loopback RPC');
  if (chainId === 1952 && (rpc.protocol !== 'https:' || !['testrpc.xlayer.tech','xlayertestrpc.okx.com'].includes(rpc.hostname))) {
    throw Error('Use the official testnet RPC for testnet signing');
  }
  const chain = chainId === 31337 ? foundry : defineChain(xLayerTestnet);
  const transport = http(rpc.href, { retryCount: 0, timeout: 20000 });
  const client = createPublicClient({ chain, transport });
  if (await client.getChainId() !== chainId) throw Error('RPC chain mismatch');
  const manifestUrl = new URL(`../../../packages/chain-config/deployments/${chainId}.json`, import.meta.url);
  const m: DeploymentManifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  if (m.chainId !== chainId || m.status !== 'deployed' || m.abiVersion !== 'v1') throw Error('Deployment is unavailable');
  const account = envAddress('KEEPER_ACCOUNT');
  const operator = envAddress('KEEPER_OPERATOR');
  const execute = process.argv.includes('--execute');
  if (operator === getAddress('0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67')) throw Error('Use a separately revocable operator');
  const factory = m.contracts.SentinelAccountFactory;
  const [owner, controller] = await Promise.all([
    client.readContract({address:account,abi:SentinelAccountAbi,functionName:'owner'}),
    client.readContract({address:account,abi:SentinelAccountAbi,functionName:'controller'})
  ]);
  const registered = await client.readContract({address:factory,abi:SentinelAccountFactoryAbi,
    functionName:'accountOf', args:[owner,controller]});
  if (getAddress(registered) !== account || operator === getAddress(owner)) throw Error('Invalid account or operator');

  const directory = new URL(`../.state/${chainId}/${factory}/${operator}/`, import.meta.url);
  await mkdir(directory,{recursive:true, mode:0o700});
  const journal = new DatabaseSync(fileURLToPath(new URL('operator.sqlite',directory)));
  journal.exec('CREATE TABLE IF NOT EXISTS pending(slot INTEGER PRIMARY KEY CHECK(slot=1), hash TEXT NOT NULL, nonce INTEGER NOT NULL)');
  const activity = new URL('activity.jsonl',directory);
  async function record(row: object) {
    const line = json({at:new Date().toISOString(),chainId,account,operator,...row});
    await appendFile(activity,line+'\n',{mode:0o600});
    console.log(line);
  }
  async function reconcile(hash: Hash, wait: boolean) {
    const receipt = wait ? await client.waitForTransactionReceipt({hash,timeout:60000,retryCount:0})
      : await client.getTransactionReceipt({hash});
    const events = parseEventLogs({abi:SentinelAccountAbi,eventName:'AutoRepayExecuted',logs:receipt.logs})
      .filter(event => getAddress(event.address) === getAddress(receipt.to!));
    await record({state:receipt.status,account:receipt.to,hash,block:receipt.blockNumber,gas:receipt.gasUsed,
      outcomes:events.map(event=>event.args)});
    journal.prepare('DELETE FROM pending WHERE slot=1 AND hash=?').run(hash);
  }
  const pending = journal.prepare('SELECT hash FROM pending WHERE slot=1').get() as {hash:Hash} | undefined;
  if (pending) {
    try { await reconcile(pending.hash,false); }
    catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
      await record({state:'awaiting-confirmation',hash:pending.hash});
    }
    return;
  }
  const trigger = await client.readContract({address:account,abi:SentinelAccountAbi,functionName:'autoRepayTriggerBps'});
  // Stored LTV is for reporting. autoRepay accrues both books and evaluates the trigger atomically.
  const ltv = await client.readContract({address:controller,abi:IsolatedControllerAbi,
    functionName:'currentLtvBps',args:[account]}).catch(()=>null);
  if (!trigger) { await record({state:'disabled',ltv}); return; }
  const call = {address:account,abi:SentinelAccountAbi,functionName:'autoRepay',account:operator} as const;
  let amount;
  try { ({result:amount} = await client.simulateContract(call)); }
  catch (error) {
    const reason = error instanceof Error && 'shortMessage' in error ? String(error.shortMessage) : 'Simulation failed';
    await record({state:'simulation-failed',trigger,ltv,reason}); return;
  }
  const [gas,gasPrice,balance] = await Promise.all([
    client.estimateContractGas(call),client.getGasPrice(),client.getBalance({address:operator})]);
  const gasLimit = gas + gas / 4n + 1000n;
  const fee = gasPrice * gasLimit;
  const maxFee = BigInt(process.env.KEEPER_MAX_FEE_WEI ?? '1000000000000000');
  if (fee > maxFee || fee > balance) { await record({state:'gas-budget',amount,fee,balance}); return; }
  if (!execute) { await record({state:'simulated',amount,trigger,ltv,fee}); return; }
  const signer = chainId === 31337 ? operator : privateKeyToAccount(process.env.KEEPER_TESTNET_OPERATOR_KEY as Hex);
  if (typeof signer !== 'string' && getAddress(signer.address) !== operator) throw Error('Operator key mismatch');
  const wallet = createWalletClient({chain,transport,account:signer});
  const nonce = await client.getTransactionCount({address:operator,blockTag:'pending'});
  const raw = await wallet.signTransaction({to:account, chain, type:'legacy', nonce, gasPrice, gas:gasLimit,
    data:encodeFunctionData({abi:SentinelAccountAbi,functionName:'autoRepay'})});
  const hash = keccak256(raw);
  // Each operator has one outstanding transaction. Reconciliation clears only the matching hash.
  const reservation = journal.prepare('INSERT OR IGNORE INTO pending(slot,hash,nonce) VALUES(1,?,?)').run(hash,nonce);
  if (!reservation.changes) { await record({state:'another-transaction-pending'}); return; }
  const broadcast = await client.sendRawTransaction({serializedTransaction:raw});
  if (broadcast !== hash) throw Error('Unexpected transaction hash');
  await record({state:'submitted',hash,amount,trigger,ltv});
  await reconcile(hash,true);
}
once().catch((error: unknown)=>{
  // Never serialize signer objects, signed payloads, or RPC request details.
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Keeper failed');
  process.exitCode = 1;
});

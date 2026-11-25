import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http,
  BaseError, ContractFunctionRevertedError, keccak256, parseEventLogs, TransactionReceiptNotFoundError, type Hash, type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  xLayerTestnet, SentinelAccountAbi, SentinelAccountFactoryAbi, IsolatedControllerAbi
} from '@peridot/chain-config';

import {localInstance,type KeeperConfig} from './config.js';

import {recordAttempt} from './activity.js';

export async function runOnce(config: KeeperConfig, execute: boolean): Promise<string> {
  const {chainId,rpc,account,operator,factory,directory} = config;
  const chain = chainId === 31337 ? foundry : defineChain(xLayerTestnet);
  const transport = http(rpc.href, { retryCount: 0, timeout: 20000 });
  const client = createPublicClient({ chain, transport });
  if (await client.getChainId() !== chainId) throw Error('RPC chain mismatch');
  if (config.instanceId && (await localInstance(rpc)).instanceId !== config.instanceId) throw Error('Local Anvil instance changed');
  const [owner, controller] = await Promise.all([
    client.readContract({address:account,abi:SentinelAccountAbi,functionName:'owner'}),
    client.readContract({address:account,abi:SentinelAccountAbi,functionName:'controller'})
  ]);
  const registered = await client.readContract({address:factory,abi:SentinelAccountFactoryAbi,
    functionName:'accountOf', args:[owner,controller]});
  if (getAddress(registered) !== account || operator === getAddress(owner)) throw Error('Invalid account or operator');

  await mkdir(directory,{recursive:true, mode:0o700});
  const journal = new DatabaseSync(fileURLToPath(new URL('operator.sqlite',directory)));
  journal.exec('PRAGMA busy_timeout=2000');
  try {
    journal.exec('BEGIN IMMEDIATE');
    journal.exec('CREATE TABLE IF NOT EXISTS pending(slot INTEGER PRIMARY KEY CHECK(slot=1), hash TEXT NOT NULL, nonce INTEGER NOT NULL, account TEXT)');
    // Preserve pending transactions from the original one-shot keeper. Their target may be unknown until mined.
    const columns = journal.prepare('PRAGMA table_info(pending)').all();
    if (!columns.some(column => column.name === 'account')) journal.exec('ALTER TABLE pending ADD COLUMN account TEXT');
    journal.exec('COMMIT');
  } catch (error) { journal.close(); throw error; }
  const record = (row: Parameters<typeof recordAttempt>[1]) => recordAttempt(config,row);
  async function reconcile(hash: Hash, wait: boolean) {
    const receipt = wait ? await client.waitForTransactionReceipt({hash,timeout:60000,retryCount:0})
      : await client.getTransactionReceipt({hash});
    const events = parseEventLogs({abi:SentinelAccountAbi,eventName:'AutoRepayExecuted',logs:receipt.logs})
      .filter(event => getAddress(event.address) === getAddress(receipt.to!));
    await record({state:receipt.status,account:receipt.to,hash,block:receipt.blockNumber,gas:receipt.gasUsed,
      outcomes:events.map(event=>event.args)});
    journal.prepare('DELETE FROM pending WHERE slot=1 AND hash=?').run(hash);
    return receipt.to?.toLowerCase() === account.toLowerCase() ? receipt.status : 'another-transaction-reconciled';
  }
  try {
    const pending = journal.prepare('SELECT hash,account FROM pending WHERE slot=1').get() as {hash:Hash;account:string|null} | undefined;
    if (pending) {
      try { return await reconcile(pending.hash,false); }
      catch (error) {
        if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
        if (pending.account?.toLowerCase() !== account.toLowerCase()) return await record({state:'another-transaction-pending'});
        return await record({state:'awaiting-confirmation',hash:pending.hash});
      }
    }
    const trigger = await client.readContract({address:account,abi:SentinelAccountAbi,functionName:'autoRepayTriggerBps'});
    // Stored LTV is for reporting. autoRepay accrues both books and evaluates the trigger atomically.
    const ltv = await client.readContract({address:controller,abi:IsolatedControllerAbi,
      functionName:'currentLtvBps',args:[account]}).catch(()=>null);
    if (!trigger) { return await record({state:'disabled',ltv}); }
    const call = {address:account,abi:SentinelAccountAbi,functionName:'autoRepay',account:operator} as const;
    let amount;
    try { ({result:amount} = await client.simulateContract(call)); }
    catch (error) {
      const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
      if (!(revert instanceof ContractFunctionRevertedError)) throw error;
      const reason = revert.data?.errorName ?? 'ExecutionReverted';
      return await record({state:'simulation-failed',trigger,ltv,reason});
    }
    const [gas,gasPrice,balance] = await Promise.all([
      client.estimateContractGas(call),client.getGasPrice(),client.getBalance({address:operator})]);
    const gasLimit = gas + gas / 4n + 1000n;
    const fee = gasPrice * gasLimit;
    const maxFee = BigInt(process.env.KEEPER_MAX_FEE_WEI ?? '1000000000000000');
    if (fee > maxFee || fee > balance) { return await record({state:'gas-budget',amount,fee,balance}); }
    if (!execute) { return await record({state:'simulated',amount,trigger,ltv,fee}); }
    const key = process.env.KEEPER_TESTNET_OPERATOR_KEY;
    if (chainId === 1952 && !/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw Error('Set a separate testnet operator key in the environment');
    const signer = chainId === 31337 ? operator : privateKeyToAccount(key as Hex);
    if (typeof signer !== 'string' && getAddress(signer.address) !== operator) throw Error('Operator key mismatch');
    const wallet = createWalletClient({chain,transport,account:signer});
    const nonce = await client.getTransactionCount({address:operator,blockTag:'pending'});
    const raw = await wallet.signTransaction({to:account, chain, type:'legacy', nonce, gasPrice, gas:gasLimit,
      data:encodeFunctionData({abi:SentinelAccountAbi,functionName:'autoRepay'})});
    const hash = keccak256(raw);
    // Each operator has one outstanding transaction. Reconciliation clears only the matching hash.
    const reservation = journal.prepare('INSERT OR IGNORE INTO pending(slot,hash,nonce,account) VALUES(1,?,?,?)').run(hash,nonce,account);
    if (!reservation.changes) { return await record({state:'another-transaction-pending'}); }
    const broadcast = await client.sendRawTransaction({serializedTransaction:raw});
    if (broadcast !== hash) throw Error('Unexpected transaction hash');
    await record({state:'submitted',hash,amount,trigger,ltv});
    return await reconcile(hash,true);
  } finally { journal.close(); }
}

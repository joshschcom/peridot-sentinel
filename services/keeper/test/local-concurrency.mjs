// Functional test against the seeded, unforked development deployment. Uses valueless mock collateral.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, zeroAddress } from 'viem';
import { foundry } from 'viem/chains';
import { SentinelAccountAbi, SentinelAccountFactoryAbi, IsolatedControllerAbi, TestnetTokenAbi } from '@peridot/chain-config';

const run = promisify(execFile);
const url = 'http://127.0.0.1:18545';
const transport = http(url,{retryCount:0});
const client = createPublicClient({chain:foundry,transport});
const meta = await client.request({method:'anvil_metadata'});
assert.equal(await client.getChainId(),31337);
assert(meta.instanceId && !meta.forkedNetwork);
const manifest = JSON.parse(await readFile(new URL('../../../packages/chain-config/deployments/31337.json',import.meta.url)));
assert.equal(manifest.tapeout.mode,'development-reference');
const users = await client.request({method:'eth_accounts'});
const operator = users[4];
const owner = users[3];
const factory = manifest.contracts.SentinelAccountFactory;
const market = manifest.markets[0].controller;
const policy = manifest.tapeout.circuits.find(c=>c.kind==='ACCOUNT').policyId;
const wallet = createWalletClient({account:owner,chain:foundry,transport});
async function write(address,abi,functionName,args) {
  const call = {address,abi,functionName,args,account:owner};
  const gas = await client.estimateContractGas(call);
  const hash = await wallet.writeContract({...call,gas:gas + gas / 2n + 30000n});
  assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');
}
const lookup = {address:factory,abi:SentinelAccountFactoryAbi,functionName:'accountOf',args:[owner,market]};
let account = await client.readContract(lookup);
if (account === zeroAddress) {
  await write(factory,SentinelAccountFactoryAbi,'createAccount',[market,policy]);
  account = await client.readContract(lookup);
}
const act = (method,...args) => write(account,SentinelAccountAbi,method,args);
await write(manifest.contracts.MockCollateral,TestnetTokenAbi,'mint',[account,100n * 10n**18n]);
await act('enterCollateral');
await act('supply',100n * 10n**18n);
await act('borrow',30_000_000n);
await act('setAutoRepayTrigger',1);
const budget = 5_000_000n;
await act('setOperator',operator,8,budget,(await client.getBlock()).timestamp + 3600n);
const preBlock = await client.getBlockNumber({cacheTime:0});
const environment = {...process.env,KEEPER_CHAIN_ID:'31337',KEEPER_RPC:url,KEEPER_OPERATOR:operator,KEEPER_ACCOUNT:account};
const program = fileURLToPath(new URL('../dist/once.js',import.meta.url));
const before = await client.readContract({address:market,abi:IsolatedControllerAbi,functionName:'currentLtvBps',args:[account]});
const workers = await Promise.all([1,2].map(()=>run(process.execPath,[program,'--execute'],{env:environment})));
const end = await client.getBlockNumber({cacheTime:0});
const logs = await client.getContractEvents({address:account,abi:SentinelAccountAbi,eventName:'AutoRepayExecuted',fromBlock:preBlock+1n,toBlock:end});
assert.equal(logs.length,1,'exactly one repayment should settle');
assert.equal(logs[0].args.amount,budget);
assert(logs[0].args.ltvAfterBps < before);
const grant = await client.readContract({address:account,abi:SentinelAccountAbi,functionName:'operators',args:[operator]});
assert.equal(grant[1],0n);
const output = {label:'Unforked local Anvil simulation; development reference processor',chainId:31337,account,operator,
  receiptHash:logs[0].transactionHash,block:logs[0].blockNumber,event:logs[0].args,grantRemaining:grant[1],
  workers:workers.map(w=>w.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)))};
console.log(JSON.stringify(output,(_,v)=>typeof v==='bigint'?v.toString():v,2));

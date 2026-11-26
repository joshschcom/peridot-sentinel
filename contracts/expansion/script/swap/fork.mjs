// Start a fresh private node as described in evidence/session5-swap/README.md.
// Every state-changing RPC below uses this literal loopback address. No keys.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData,
  getAddress, http, keccak256, parseAbi, parseEventLogs, toFunctionSelector, toHex, zeroHash } from 'viem';

const url = 'http://127.0.0.1:19635';
const publicRpc = 'https://rpc.xlayer.tech';
const rpc = createPublicClient({transport:http(url,{timeout:120000,retryCount:0}),cacheTime:0});
const wallet = createWalletClient({transport:http(url,{timeout:120000,retryCount:0})});
const observations = JSON.parse(readFileSync(new URL('../../../../evidence/session5-venues/observations.json',import.meta.url))).mainnet;
const pin = BigInt(observations.number);
const fork = await rpc.request({method:'anvil_nodeInfo'});
assert.equal(await rpc.getChainId(),31337);
assert.equal(fork.forkConfig.forkUrl,publicRpc);
assert.equal(fork.forkConfig.forkBlockNumber,Number(pin));
assert.equal((await rpc.getBlock()).hash,observations.hash,'use a fresh fork');
const accounts = [];
for (const a of await wallet.getAddresses()) {
  if (!await rpc.getCode({address:a})) accounts.push(a);
  if (accounts.length===2) break;
}
assert.equal(accounts.length,2);
const [owner,operator]=accounts;
const receipts=[];
const deployed={};
const ledger={
  pool:observations.uniV3.pool, router:observations.runtime.uniV3Router.address, factory:observations.runtime.uniV3Factory.address,
  usdc:observations.uniV3.token0, wokb:observations.uniV3.token1, cpu:'0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5',
  pass:'0x3896076be165d6a7ec2a70ccf6876673fe245007',
};
const sponsorAbi=parseAbi([
  'function mint(uint256,uint256) payable','function mintPrice() view returns(uint256)','function protocolFee() view returns(uint256)',
  'function TAPEOUT_FEE() view returns(uint256)','function tapeout(bytes,uint32,uint32) payable','function nextId() view returns(uint256)',
  'function netlist(uint256) view returns(bytes)','function circuitInfo(uint256) view returns(uint32,uint32,uint32,uint32)',
]);
const erc20=parseAbi(['function deposit() payable','function transfer(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)']);
const balance=(token,who)=>read(token,erc20,'balanceOf',[who]);
const allowance=(token,who,spender)=>read(token,erc20,'allowance',[who,spender]);
function read(address,abi,functionName,args=[]) {return rpc.readContract({address,abi,functionName,args});}
async function send(label,request,actor=owner,revert=false) {
  const timestamp=BigInt(observations.timestamp)+BigInt(receipts.length)+1n;
  await rpc.request({method:'evm_setNextBlockTimestamp',params:[toHex(timestamp)]});
  const hash=await wallet.sendTransaction({account:actor,chain:null,gas:15_000_000n,...request});
  console.error(label,hash);
  let r;
  for (let attempt=0; attempt<240 && !r; attempt++) {
    const mined=await rpc.request({method:'eth_getTransactionReceipt',params:[hash]});
    if (mined) r=await rpc.getTransactionReceipt({hash});
    else await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert(r,'missing fork receipt '+hash);
  assert.equal(r.status,revert?'reverted':'success',label+' '+hash);
  assert.equal((await rpc.getBlock({blockNumber:r.blockNumber})).hash,r.blockHash);
  receipts.push({label,hash,status:r.status,actor,to:r.to,created:r.contractAddress,block:r.blockNumber,blockHash:r.blockHash,gas:r.gasUsed});
  return r;
}
const tx=(label,to,abi,functionName,args=[],additional={},actor=owner,revert=false)=>send(label,
  {to,data:encodeFunctionData({abi,functionName,args}),...additional},actor,revert);
function artifact(name,expansion) {
  const prefix=expansion?'../../out/':'../../../out/';
  return JSON.parse(readFileSync(new URL(prefix+name+'.sol/'+name+'.json',import.meta.url)));
}
const abis={};
async function deploy(name,args=[],expansion=true) {
  const {abi,bytecode}=artifact(name,expansion);
  abis[name]=abi;
  const r=await send('Deploy '+name,{data:encodeDeployData({abi,bytecode:bytecode.object,args})});
  const address=r.contractAddress;
  deployed[name]={address,runtimeHash:keccak256(await rpc.getCode({address}))};
  return address;
}
function event(r,abi,address,eventName) {
  const list=parseEventLogs({logs:r.logs.filter(l=>l.address.toLowerCase()===address.toLowerCase()),abi,eventName});
  assert.equal(list.length,1,eventName);
  return list[0].args;
}
const lendingFixtures=JSON.parse(readFileSync(new URL('../../../../packages/circuit-sdk/fixtures/policies-v1.json',import.meta.url))).policies;
const execution=JSON.parse(readFileSync(new URL('../../policy/execution.json',import.meta.url)));
const fixtures=[...lendingFixtures, execution];
const gates=fixtures.reduce((n,p)=>n+BigInt(p.gateCount),0n);
const price=await read(ledger.pass,sponsorAbi,'mintPrice');
const mintFee=await read(ledger.pass,sponsorAbi,'protocolFee');
await tx('Mint NAND components on fork',ledger.pass,sponsorAbi,'mint',[0n,gates],{value:price*gates+mintFee});
const fee=await read(ledger.cpu,sponsorAbi,'TAPEOUT_FEE');
const circuits=[];
for(const f of fixtures) {
  await tx('Fabricate '+(f.spec?.kind??'EXECUTION')+' on fork',ledger.cpu,sponsorAbi,'tapeout',[f.netlist,20,1],{value:fee});
  const id=await read(ledger.cpu,sponsorAbi,'nextId');
  assert.equal(keccak256(await read(ledger.cpu,sponsorAbi,'netlist',[id])),f.netlistHash);
  assert.deepEqual(await read(ledger.cpu,sponsorAbi,'circuitInfo',[id]),[20,1,0,f.gateCount]);
  circuits.push({kind:f.spec?.kind??'EXECUTION',id,netlistHash:f.netlistHash,gateCount:f.gateCount});
}
// Local M4 market construction gives the new account real typed lending bindings. The demo only swaps idle tokens.
const oracle=await deploy('TestnetOracle',[],false);
const model=await deploy('DemoRateModel',[31_536_000n],false);
const book=await deploy('MarketPToken',[],false);
const registry=await deploy('PolicyRegistry',[owner],false);
const policy=await deploy('TapeOutPolicyAdapter',[registry],false);
await tx('Trust pinned fork CPU',registry,abis.PolicyRegistry,'setProcessorTrust',[ledger.cpu,true]);
for (const [kind,f] of lendingFixtures.entries()) {
  const r=await tx('Register '+circuits[kind].kind+' policy',registry,abis.PolicyRegistry,'register',
    [ledger.cpu,circuits[kind].id,kind,f.netlistHash,f.configHash,zeroHash]);
  circuits[kind].policyId=event(r,abis.PolicyRegistry,registry,'PolicyRegistered').policyId;
}
const markets=await deploy('MarketFactory',[registry,policy,oracle,model,book,ledger.wokb,ledger.usdc],false);
const r=await tx('Create isolated market on fork',markets,abis.MarketFactory,'createMarket',
  [circuits[0].policyId,7500,8500,500n*10n**18n,1000n*10n**6n,900n*10n**6n,10n*10n**6n]);
const market=event(r,abis.MarketFactory,markets,'MarketCreated').controller;
const lending=await deploy('PeridotLendingAdapter',[markets,market]);
const source=await deploy('ChainlinkSwapQuoteSource',[ledger.usdc,ledger.wokb,observations.feeds.USDC.address,
  observations.feeds.OKB.address,observations.feeds.sequencer.address]);
const swap=await deploy('SinglePoolSwapAdapter',[ledger.router,ledger.factory,ledger.usdc,ledger.wokb,source,86400,500]);
const binding=await deploy('ExecutionPolicy',[ledger.cpu,circuits[2].id]);
const factory=await deploy('SentinelAccountFactoryV2',[lending,swap,binding]);
await tx('Create v2 account',factory,abis.SentinelAccountFactoryV2,'createAccount',[circuits[1].policyId]);
const account=await read(factory,abis.SentinelAccountFactoryV2,'accountOf',[owner]);
const accountAbi=artifact('SentinelAccountV2',true).abi;
assert.equal(getAddress(await read(swap,abis.SinglePoolSwapAdapter,'pool')),getAddress(ledger.pool));
const amount=10n**18n;
await tx('Wrap fork OKB into real WOKB',ledger.wokb,erc20,'deposit',[],{value:2n*amount});
await tx('Fund account with fork WOKB',ledger.wokb,erc20,'transfer',[account,2n*amount]);
const deadline=BigInt(observations.timestamp)+600n;
await tx('Grant bounded swap authority',account,accountAbi,'setGrant',[operator,swap,5,ledger.wokb,amount,2n*amount,deadline]);
const state=async()=>({
  accountWOKB:await balance(ledger.wokb,account),accountUSDC:await balance(ledger.usdc,account),
  operatorUSDC:await balance(ledger.usdc,operator),poolWOKB:await balance(ledger.wokb,ledger.pool),poolUSDC:await balance(ledger.usdc,ledger.pool),
  accountToAdapter:await allowance(ledger.wokb,account,swap),adapterToRouter:await allowance(ledger.wokb,swap,ledger.router),
  adapterWOKB:await balance(ledger.wokb,swap),remaining:(await read(account,accountAbi,'grants',[operator,swap,5,ledger.wokb]))[1],
});
const before=await state();
const [expected,floor,timestamp]=await read(swap,abis.SinglePoolSwapAdapter,'executionQuote',[ledger.wokb,amount]);
const deniedMin=expected-expected*101n/10_000n;
const allowedMin=expected-expected*95n/10_000n;
assert(deniedMin>=floor);
const denied=await tx('101 bps loss denied by EXECUTION circuit',account,accountAbi,'swapExactIn',
  [ledger.wokb,amount,deniedMin,deadline],{},operator,true);
const deniedTrace=await rpc.request({method:'debug_traceTransaction',params:[denied.transactionHash,{tracer:'callTracer'}]});
const denialSelector=toFunctionSelector('ExecutionPolicyDenied()');
assert.equal(deniedTrace.output,denialSelector);
assert.deepEqual(await state(),before);
const settled=await tx('95 bps limit allows V2 exact-input swap',account,accountAbi,'swapExactIn',
  [ledger.wokb,amount,allowedMin,deadline],{},operator);
const settledEvent=event(settled,accountAbi,account,'SwapSettled');
const poolEvent=event(settled,parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']),ledger.pool,'Swap');
const after=await state();
assert.equal(before.accountWOKB-after.accountWOKB,amount);
assert.equal(after.accountUSDC-before.accountUSDC,settledEvent.amountOut);
assert.equal(after.poolWOKB-before.poolWOKB,amount);
assert.equal(before.poolUSDC-after.poolUSDC,settledEvent.amountOut);
assert.equal(after.accountToAdapter+after.adapterToRouter+after.adapterWOKB,0n);
assert.equal(after.operatorUSDC,before.operatorUSDC);
assert.equal(before.remaining-after.remaining,amount);
assert.equal(getAddress(poolEvent.recipient),getAddress(account));
assert.equal(getAddress(poolEvent.sender),getAddress(ledger.router));
assert.equal(poolEvent.amount0,-settledEvent.amountOut);
assert.equal(poolEvent.amount1,amount);
console.log(JSON.stringify({label:'Anvil 31337; simulation on a fork of X Layer 196',upstream:{rpc:publicRpc,block:pin,hash:observations.hash,timestamp:observations.timestamp},
  owner,operator,ledger,deployed,market,account,circuits,amount,expected,floor,timestamp,allowedMin,deniedMin,deadline,denialSelector,
  deniedStateMatchedBefore:true,before,after,poolEvent,settledEvent,receipts},(_,v)=>typeof v==='bigint'?v.toString():v,2));

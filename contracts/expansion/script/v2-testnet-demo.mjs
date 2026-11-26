// Public authorizations and transactions for the independent v2 mock profile; never route via the v1 account.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {decodeErrorResult,encodeFunctionData,getAddress,keccak256,parseAbi,parseEventLogs} from 'viem'
import {deployer,operator,openSession,readJson,retryRead,writeJson} from './session6-transactions.mjs'

const [mode,phase,forkManifest]=process.argv.slice(2)
assert(['fork','testnet'].includes(mode) && ['prepare','operator','verify'].includes(phase))
assert(mode==='fork'||!forkManifest)
const path=mode==='testnet'?'packages/chain-config/expansion/deployments/1952.json':forkManifest
const profile=readJson(path)
const base=readJson('packages/chain-config/deployments/1952.json')
assert(profile.chainId===1952 && profile.profile===(mode==='testnet'?'1952':profile.profile) &&
  profile.execution.mode==='development-reference' && getAddress(profile.m4.controller)===getAddress(base.markets[0].controller))
const a=profile.contracts
const abi=readJson('packages/chain-config/expansion/abi/SentinelAccountV2.json')
const policy=readJson('packages/chain-config/expansion/abi/ExecutionPolicy.json')
const token=parseAbi(['function mint(address,uint256)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'])
const s=await openSession({mode,role:phase==='operator'?'operator':'deployer',slug:'v2-demo',forkPort:19626})
const reportPath=mode==='testnet'?'evidence/session6-v2/1952.json':s.dir+'/evidence.json'
const report=existsSync(reportPath)?readJson(reportPath):{chainId:1952,profile:profile.label,public:mode==='testnet',account:a.account,operator}
const wad=10n**18n
const view=(address,abi,functionName,args=[],blockNumber)=>s.readContract({address,abi,functionName,args,blockNumber})
const call=(label,address,contract,fn,args,extra={})=>s.send(label,{to:address,data:encodeFunctionData({abi:contract,functionName:fn,args}),...extra})
const record=r=>({hash:r.transactionHash,block:r.blockNumber,blockHash:r.blockHash,gasUsed:r.gasUsed,status:r.status,from:r.from,to:r.to})
const grantAt=block=>view(a.account,abi,'grants',[operator,a.swap,5,a.mockWokb],block)
const events=(r,name)=>parseEventLogs({abi,logs:r.logs.filter(l=>getAddress(l.address)===getAddress(a.account)),eventName:name})
async function rejection(data,block) {
  try {await s.client.call({account:deployer,to:a.account,data,blockNumber:block})}
  catch(e) {
    const error=e.walk?.(x=>typeof x.data==='string' && /^0x[\da-f]+$/i.test(x.data))
    if(error) {
      const decoded=decodeErrorResult({abi:policy,data:error.data})
      assert.equal(decoded.errorName,'ExecutionPolicyDenied')
      return {method:'eth_call replay',block,selector:error.data,error:decoded.errorName}
    }
    throw e
  }
  throw Error('Expected execution policy denial')
}
try {
  assert.equal(getAddress(await view(a.account,abi,'owner')),getAddress(deployer))
  assert.equal(getAddress(await view(a.account,abi,'swapAdapter')),getAddress(a.swap))
  assert.equal(getAddress(await view(a.account,abi,'lendingAdapter')),getAddress(a.lending))
  assert.equal(getAddress(await view(a.account,abi,'controller')),getAddress(base.markets[0].controller))
  assert.equal(keccak256(await retryRead(()=>s.client.getCode({address:a.account}),Boolean)),profile.runtimeCodeHashes.account)
  if(phase==='prepare') {
    const start=await retryRead(()=>s.client.getBlock())
    if(!s.state.data.expiry){s.state.data.expiry=String(start.timestamp+86400n);s.save()}
    const expiry=BigInt(s.state.data.expiry)
    await call('mint-demo-swap-inventory',a.mockWokb,token,'mint',[a.account,2n*wad])
    await call('mint-v2-lending-collateral',base.contracts.MockCollateral,token,'mint',[a.account,wad])
    const supplied=await call('owner-supply',a.account,abi,'supply',[wad])
    const before=await view(a.account,abi,'exposure',[],supplied.blockNumber-1n)
    const after=await view(a.account,abi,'exposure',[],supplied.blockNumber)
    assert(after[0]>before[0] && after[1]===before[1])
    assert.equal(await view(base.contracts.MockCollateral,token,'allowance',[a.account,base.markets[0].collateralMarket],supplied.blockNumber),0n)
    report.ownerSupply={...record(supplied),rawInput:wad,sharesBefore:before[0],sharesAfter:after[0],debtRaw:after[1]}
    const granted=await call('bounded-swap-grant',a.account,abi,'setGrant',[operator,a.swap,5,a.mockWokb,wad,2n*wad,expiry])
    assert.deepEqual(await grantAt(granted.blockNumber),[wad,2n*wad,expiry])
    assert.equal(await view(a.account,abi,'operatorCount',[],granted.blockNumber),1n)
    assert.equal(getAddress(await view(a.account,abi,'operatorAt',[0n],granted.blockNumber)),getAddress(operator))
    report.grant={...record(granted),op:5,maxPerCall:wad,cumulative:2n*wad,expiry}
    const bad=encodeFunctionData({abi,functionName:'swapExactIn',args:[a.mockWokb,wad,79_192_000n,expiry]})
    if(!s.state.steps['denied-at-101-bps']) await retryRead(()=>rejection(bad,granted.blockNumber))
    const denied=await s.send('denied-at-101-bps',{to:a.account,data:bad,gas:1_500_000n,expected:'reverted'})
    const why=await retryRead(()=>rejection(bad,denied.blockNumber-1n))
    assert.equal((await grantAt(denied.blockNumber))[1],2n*wad)
    assert(denied.gasUsed<1_500_000n)
    report.denial={...record(denied),...{replay:why},lossBps:101,hardMaxBps:500,policyMaxBps:100}
    writeJson(reportPath,report)
  } else if(phase==='operator') {
    assert(report.grant && report.denial,'Owner preparation has not completed')
    const r=await call('operator-swap',a.account,abi,'swapExactIn',[a.mockWokb,wad,79_200_000n,BigInt(report.grant.expiry)])
    const [ev]=events(r,'SwapSettled')
    assert.equal(getAddress(ev.args.operator),getAddress(operator))
    assert.equal(ev.args.amountOut,79_960_000n)
    const before=r.blockNumber-1n,after=r.blockNumber
    const balance=(asset,holder,b)=>view(asset,token,'balanceOf',[holder],b)
    assert.equal(await balance(a.mockUsdc,a.account,after)-await balance(a.mockUsdc,a.account,before),ev.args.amountOut)
    assert.equal(await balance(a.mockWokb,a.account,before)-await balance(a.mockWokb,a.account,after),wad)
    assert.equal(await balance(a.mockUsdc,operator,after),await balance(a.mockUsdc,operator,before))
    assert.equal(await view(a.mockWokb,token,'allowance',[a.account,a.swap],after),0n)
    assert.equal(await view(a.mockWokb,token,'allowance',[a.swap,a.venue],after),0n)
    assert.equal((await grantAt(before))[1]-(await grantAt(after))[1],wad)
    report.operatorSwap={...record(r),event:ev.args,remaining:(await grantAt(after))[1],recipient:a.account,allowanceAfter:'0'}
    writeJson(reportPath,report)
  } else {
    assert(report.operatorSwap,'Wait for the distinct confirmed operator receipt')
    const r=await call('emergency-revoke-all',a.account,abi,'revokeAllOperators',[])
    const [ev]=events(r,'AllOperatorsRevoked')
    assert.equal(await view(a.account,abi,'operatorCount',[],r.blockNumber),0n)
    assert.deepEqual(await grantAt(r.blockNumber),[0n,0n,0n])
    report.emergencyRevoke={...record(r),newEpoch:ev.args.newEpoch,operatorCount:'0'}
    writeJson(reportPath,report)
  }
  console.log(reportPath)
} finally {s.close()}

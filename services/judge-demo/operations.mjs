import assert from 'node:assert/strict'
import {decodeFunctionResult,encodeErrorResult,getAddress,keccak256,toHex} from 'viem'
import {base,wad,usd,retryRead,writeJson} from './transport.mjs'
import {binding,call,data,event,m4,read,requireEqual,checkedCode,checkArtifacts,typeNames} from './contracts.mjs'
const equal=(a,b)=>assert.deepEqual(a,b)
const sameAddress=requireEqual
function contracts(m){
  return Object.fromEntries(Object.entries(m.contracts).map(([key,address])=>[key,binding(typeNames[key],address)]))
}
async function identity(s,m,boxes,at){
  assert(m.schemaVersion===1 && m.chainId===1952 && m.profile===s.profile && m.campaign===s.campaign)
  sameAddress(m.owner,s.actors.owner);sameAddress(m.operator,s.actors.operator);sameAddress(m.deployer,s.actors.deployer)
  equal(m.base, Object.fromEntries(Object.entries(base.contracts).map(([k,a])=>[k,getAddress(a)])))
  checkArtifacts()
  assert.equal(Object.keys(boxes).length,Object.keys(typeNames).length)
  for(const [k,c] of Object.entries(boxes))assert.equal(await checkedCode(s,c,at),m.runtimeCodeHashes[k])
  const a=m.markets.A,v1=binding('SentinelAccount',a.account)
  const pin=async(c,fn,address,args=[])=>sameAddress(await read(s,c,fn,args,at),address)
  await Promise.all([
    pin(boxes.factory,'accountOf',boxes.account.address,[m.owner]),pin(boxes.account,'owner',m.owner),
    pin(boxes.account,'lendingAdapter',boxes.lending.address),pin(boxes.account,'swapAdapter',boxes.swap.address),
    pin(boxes.account,'executionPolicy',boxes.execution.address),pin(boxes.execution,'processor',boxes.cpu.address),
    pin(boxes.account,'controller',a.controller),pin(boxes.lending,'marketFactory',m4.MarketFactory.address),
    pin(boxes.lending,'debtMarket',a.debtMarket),pin(boxes.swap,'pool',boxes.venue.address),
    pin(m4.SentinelAccountFactory,'accountOf',v1.address,[m.owner,a.controller]),pin(v1,'owner',m.owner),
    pin(boxes.swap,'router',boxes.venue.address),pin(boxes.swap,'priceSource',boxes.source.address),
    pin(boxes.source,'oracle',boxes.mockOracle.address),
  ])
  assert.equal(await read(s,m4.MarketFactory,'isMarket',[a.controller],at),true)
  assert.equal(await read(s,boxes.execution,'circuitId',[],at),BigInt(m.policies.execution.circuitId))
  assert.equal(keccak256(await read(s,boxes.cpu,'netlist',[BigInt(m.policies.execution.circuitId)],at)),m.policies.execution.netlistHash)
  return v1
}
function receiptRecord(s,r,c,input){
  const step=Object.values(s.state.steps).find(x=>x.hash===r.transactionHash)
  return {schemaVersion:1,campaign:s.campaign,chainId:1952,profile:s.profile,actor:getAddress(r.from),account:c.address,target:c.address,
    dataHash:keccak256(input),hash:r.transactionHash,blockNumber:r.blockNumber,blockHash:r.blockHash,status:r.status,gasUsed:r.gasUsed,gasLimit:step.gasLimit}
}
async function expectedRevert(s,actor,c,input,at,reason) {
  const block=typeof at==='bigint'?toHex(at):at
  const result=await retryRead(async()=>{
    try{await s.client.request({method:'eth_call',params:[{from:actor,to:c.address,data:input,gas:toHex(2_000_000n)},block]})}
    catch(error){
      for(let cause=error;cause;cause=cause.cause){const raw=typeof cause.data==='string'?cause.data:cause.data?.data;if(/^0x[0-9a-f]{8,}$/i.test(raw??''))return raw}
      throw error
    }
    throw Error('Unexpected simulation success')
  })
  assert.equal(result,reason,'Unexpected contract rejection')
  return result
}
const snapshot=async(s,m,b,v1,at)=>{
  const op=m.operator,addr=b.account.address,v1Addr=v1.address
  const book=binding('MarketPToken',m.markets.A.debtMarket)
  const [swapGrant,borrowGrant,repayGrant,idleIn,idleOut,operatorOut,books,allowance,venueAllowance,v1Debt,v1Funds,v1Allowance]=await Promise.all([
    read(s,b.account,'grants',[op,b.swap.address,5,b.mockWokb.address],at),read(s,b.account,'grants',[op,b.lending.address,2,m4.MockDebt.address],at),
    read(s,v1,'operators',[op],at),read(s,b.mockWokb,'balanceOf',[addr],at),read(s,b.mockUsdc,'balanceOf',[addr],at),read(s,b.mockUsdc,'balanceOf',[op],at),
    read(s,b.account,'exposure',[],at),read(s,b.mockWokb,'allowance',[addr,b.swap.address],at),read(s,b.mockWokb,'allowance',[b.swap.address,b.venue.address],at),
    read(s,book,'borrowBalanceStored',[v1Addr],at),read(s,m4.MockDebt,'balanceOf',[v1Addr],at),read(s,m4.MockDebt,'allowance',[v1Addr,book.address],at),
  ])
  return {swapGrant,borrowGrant,repayGrant,idleIn,idleOut,operatorOut,books,allowance,venueAllowance,v1Debt,v1Funds,v1Allowance}
}
async function operatorStep(s,m,b,v1) {
  const phase=s.phase,operator=s.actors.operator
  const c=phase==='repay'?v1:b.account
  const amountIn=wad/4n,amountOut=19_990_000n,minOut=19_800_000n
  const fn=phase==='repay'?'autoRepay':phase==='swap'?'swapExactIn':'borrow'
  const args=phase==='repay'?[]:phase==='swap'?[b.mockWokb.address,amountIn,minOut,BigInt(m.grants.swap.expiry)]:[1n]
  const input=data(c,fn,args),denied=phase==='deny-operator'
  const reason=keccak256(toHex('OperatorNotAuthorized()')).slice(0,10)
  if(!s.state.steps[phase]?.hash){
    const block=await s.head(),before=await snapshot(s,m,b,v1,block.number)
    if(phase==='repay'){
      equal(before.repayGrant,[8,2n*usd,BigInt(m.grants.repay.expiry)])
      assert(block.timestamp<before.repayGrant[2] && before.v1Debt>=2n*usd && before.v1Funds>=2n*usd)
    }else{
      equal(before.borrowGrant,[0n,0n,0n])
      if(!denied){equal(before.swapGrant,[wad,2n*wad,BigInt(m.grants.swap.expiry)]);assert(block.timestamp<before.swapGrant[2])}
    }
    if(denied) await expectedRevert(s,operator,c,input,'pending',reason)
    else{
      const result=await retryRead(()=>s.client.call({account:operator,to:c.address,data:input,blockTag:'pending'}))
      assert.equal(decodeFunctionResult({abi:c.abi,functionName:fn,data:result.data}),phase==='repay'?2n*usd:amountOut)
    }
  }
  const r=await s.send(phase,'operator',c.address,input,denied?{gas:300_000n,expected:'reverted'}:{})
  const [before,after]=await Promise.all([snapshot(s,m,b,v1,r.blockNumber-1n),snapshot(s,m,b,v1,r.blockNumber)])
  const proof={...receiptRecord(s,r,c,input),before,after}
  if(denied){
    assert(r.logs.length===0 && r.gasUsed<300_000n);equal(before,after)
    proof.reason='OperatorNotAuthorized()';proof.replay=await expectedRevert(s,operator,c,input,r.blockNumber,reason)
  }else if(phase==='swap'){
    const e=event(r,c,'SwapSettled')
    sameAddress(e.operator,operator);sameAddress(e.tokenIn,b.mockWokb.address);sameAddress(e.tokenOut,b.mockUsdc.address)
    assert.equal(e.amountIn,amountIn);assert.equal(e.amountOut,amountOut)
    assert.equal(before.swapGrant[1]-after.swapGrant[1],amountIn)
    assert.equal(before.idleIn-after.idleIn,amountIn);assert.equal(after.idleOut-before.idleOut,amountOut);assert.equal(after.operatorOut,before.operatorOut)
    assert(after.allowance===0n && after.venueAllowance===0n);proof.settlement=e;proof.recipient=c.address
  }else{
    const e=event(r,c,'AutoRepayExecuted');sameAddress(e.operator,operator);assert.equal(e.amount,2n*usd);assert(e.ltvBeforeBps>e.ltvAfterBps)
    assert(before.v1Debt>after.v1Debt && before.v1Funds-after.v1Funds===2n*usd && before.repayGrant[1]-after.repayGrant[1]===2n*usd && after.v1Allowance===0n)
    proof.settlement=e
  }
  return proof
}
async function policyDenials(s,m){
  const results={}
  for(const [id,target,kind,errName] of [['A',5800n,'account','AccountPolicyRejected'],['B',5200n,'B','MarketPolicyRejected']]){
    const market=m.markets[id],account=binding('SentinelAccount',market.account),controller=binding('IsolatedController',market.controller),book=binding('MarketPToken',market.debtMarket)
    sameAddress(await read(s,m4.SentinelAccountFactory,'accountOf',[m.owner,market.controller]),account.address)
    const planKey='deny-'+id
    if(!s.state.plan[planKey]){
      const at=(await s.head()).number
      const [colPrice,freshC]=await read(s,m4.TestnetOracle,'price',[m4.MockCollateral.address],at)
      const [debtPrice,freshD]=await read(s,m4.TestnetOracle,'price',[m4.MockDebt.address],at)
      assert(freshC&&freshD)
      const collateral=binding('MarketPToken',market.collateralMarket)
      const shares=await read(s,collateral,'balanceOf',[account.address],at),rate=await read(s,collateral,'exchangeRateStored',[],at)
      const rawCollateral=shares*rate/wad
      const targetDebt=(rawCollateral*colPrice/wad)*usd*target/(debtPrice*10_000n)
      const existing=await read(s,book,'borrowBalanceStored',[account.address],at)
      assert(targetDebt>existing);s.state.plan[planKey]=String(targetDebt-existing);s.save()
    }
    const amount=BigInt(s.state.plan[planKey]),input=data(account,'borrow',[amount])
    const error=encodeErrorResult({abi:m4.TapeOutPolicyAdapter.abi,errorName:errName,args:[m.policies[kind].policyId,1]})
    if(!s.state.steps[planKey]?.hash)await expectedRevert(s,m.owner,account,input,'pending',error)
    const r=await s.send(planKey,'owner',account.address,input,{expected:'reverted',gas:2_000_000n})
    assert(r.logs.length===0 && r.gasUsed<2_000_000n)
    const at=r.blockNumber,replay=await expectedRevert(s,m.owner,account,input,at,error)
    const [applies,fresh,ltv,cashOk]=await read(s,controller,'previewPolicy',[account.address,2,book.address,amount],at)
    assert(applies&&fresh&&cashOk && ltv>=target-3n && ltv<=target+3n)
    const ctx=await read(s,m4.TapeOutPolicyAdapter,'encodeContext',[2,fresh,ltv,cashOk],at)
    const outputs={}
    for(const [key,policy] of [['MARKET',m.policies[id]],['ACCOUNT',m.policies.account]]){
      outputs[key]=await read(s,m4.DevelopmentReferenceProcessor,'eval',[BigInt(policy.circuitId),ctx],at)
      assert.equal(outputs[key],(key==='MARKET')===(id==='B')?'0x00':'0x01')
    }
    const oldDebt=await read(s,book,'borrowBalanceStored',[account.address],at-1n),newDebt=await read(s,book,'borrowBalanceStored',[account.address],at)
    assert.equal(oldDebt,newDebt)
    results[id]={...receiptRecord(s,r,account,input),error:errName,replay,market:market.controller,policyId:m.policies[kind].policyId,outputs,ltv,context:ctx,amountRaw:amount,beforeDebt:oldDebt,afterDebt:newDebt}
  }
  return results
}
export async function readiness(s,m,atBlock){
  const b=contracts(m),head=atBlock===undefined?await s.head():await retryRead(()=>s.client.getBlock({blockNumber:atBlock})),at=head.number,v1=await identity(s,m,b,at)
  const obs=await snapshot(s,m,b,v1,at),grants=m.grants
  const expiry=BigInt(grants.swap.expiry),fresh=head.timestamp<expiry
  const [raw,freshCol]=await read(s,m4.TestnetOracle,'price',[m4.MockCollateral.address],at)
  const [price,freshDebt]=await read(s,m4.TestnetOracle,'price',[m4.MockDebt.address],at)
  const [quoteIn,freshIn]=await read(s,b.mockOracle,'price',[b.mockWokb.address],at)
  const [quoteOut,freshOut]=await read(s,b.mockOracle,'price',[b.mockUsdc.address],at)
  const trigger=await read(s,v1,'autoRepayTriggerBps',[],at),ltv=await read(s,binding('IsolatedController',m.markets.A.controller),'currentLtvBps',[v1.address],at)
  const repayReady=fresh && obs.repayGrant[0]===8 && obs.repayGrant[1]===2n*usd && obs.repayGrant[2]===BigInt(grants.repay.expiry) &&
    obs.v1Funds>=2n*usd && obs.v1Debt>=2n*usd && trigger>0 && ltv>=BigInt(trigger) && freshCol && freshDebt && raw>0n && price>0n
  const swapReady=fresh && obs.swapGrant[0]===wad && obs.swapGrant[1]===2n*wad && obs.swapGrant[2]===expiry &&
    obs.idleIn>=wad/4n && freshIn && freshOut && quoteIn===80n*wad && quoteOut===wad
  return {campaign:m.campaign,profile:s.profile,blockNumber:at,blockHash:head.hash,repayReady,swapReady,current:obs,
    ownerWei:await s.balance(m.owner,at),operatorWei:await s.balance(m.operator,at),deployerWei:await s.balance(m.deployer,at)}
}
export async function execute(s,m){
  const boxes=contracts(m)
  const v1=await identity(s,m,boxes,(await s.head()).number)
  let proof
  if(s.phase==='policy-denials') proof=await policyDenials(s,m)
  else if(s.phase==='revoke'){
    const a=await call(s,'revoke-repay','owner',v1,'revokeOperator',[m.operator])
    const t=await call(s,'clear-trigger','owner',v1,'setAutoRepayTrigger',[0])
    const b=await call(s,'revoke-swap','owner',boxes.account,'revokeAllOperators')
    equal(await read(s,v1,'operators',[m.operator],b.blockNumber),[0,0n,0n])
    assert.equal(await read(s,v1,'autoRepayTriggerBps',[],b.blockNumber),0)
    assert.equal(await read(s,boxes.account,'operatorCount',[],b.blockNumber),0n)
    equal(await read(s,boxes.account,'grants',[m.operator,boxes.swap.address,5,boxes.mockWokb.address],b.blockNumber),[0n,0n,0n])
    proof={profile:s.profile,campaign:s.campaign,chainId:1952,owner:m.owner,repayRevoked:a.transactionHash,triggerCleared:t.transactionHash,allV2Revoked:b.transactionHash,block:String(b.blockNumber),operators:0}
  }else proof=await operatorStep(s,m,boxes,v1)
  const path=s.dir+'/'+s.phase+'.json'
  writeJson(path,proof)
  return path
}

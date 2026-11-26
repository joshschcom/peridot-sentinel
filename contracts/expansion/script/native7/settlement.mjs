import assert from 'node:assert/strict'
import {decodeAbiParameters,decodeFunctionData,getAddress,keccak256,toFunctionSelector} from 'viem'
import {packet} from '../../../../evidence/session6-d8b/checks.mjs'
import {artifact,cpu,flatten,loggedEvent} from './fork.mjs'

export async function financialChecks(ctx,{d,guard,registry,witness,dev}){
  const {owner,operator,read,deploy,call,node,source}=ctx
  const col=await deploy('Mock collateral','TestnetToken',['FORK Collateral','fCOL',18])
  const debt=await deploy('Mock USD','TestnetToken',['FORK USD','fUSD',6])
  const oracle=await deploy('Mock price fixture','TestnetOracle')
  const wad=10n**18n,unit=10n**6n
  await call('Set fixture collateral quote',oracle,'setPrice',[col.address,wad])
  await call('Set fixture debt quote',oracle,'setPrice',[debt.address,wad])
  const rate=await deploy('Demo interest model','DemoRateModel',[31536000n])
  const prototype=await deploy('Book prototype','MarketPToken')
  const markets=await deploy('Market factory','MarketFactory',[registry.address,guard.address,oracle.address,rate.address,prototype.address,col.address,debt.address])
  const created=await call('Create isolated native-policy market',markets,'createMarket',[d.programs[0].policyId,7500,8500,500n*wad,1000n*unit,900n*unit,10n*unit])
  const market=loggedEvent(created,markets.abi,markets.address,'MarketCreated')
  const controller={address:market.controller,abi:artifact('IsolatedController').abi}
  const collateralBook={address:market.collateralMarket,abi:prototype.abi}
  const debtBook={address:market.debtMarket,abi:prototype.abi}
  const lending=await deploy('Peridot adapter','PeridotLendingAdapter',[markets.address,controller.address],true)
  const venue=await deploy('Mock inventory venue','TestnetInventoryVenue',[col.address,debt.address,wad,wad],true)
  const quote=await deploy('Mock quote source','TestnetSwapQuoteSource',[oracle.address],true)
  const swap=await deploy('Swap adapter','SinglePoolSwapAdapter',[venue.address,venue.address,col.address,debt.address,quote.address,86400,500],true)
  const factory=await deploy('V2 factory','SentinelAccountFactoryV2',[lending.address,swap.address,guard.address],true)
  await call('Create native v2 account',factory,'createAccount',[d.programs[1].policyId])
  const account={address:await read(factory.address,factory.abi,'accountOf',[owner]),abi:artifact('SentinelAccountV2',true).abi}
  const bookBalance=(book,holder)=>read(book.address,book.abi,'borrowBalanceStored',[holder])
  const balance=(asset,holder)=>read(asset.address,asset.abi,'balanceOf',[holder])
  const deadline=source.timestamp+86400n
  d.wiring={owner,operator,account:account.address,controller:controller.address,collateralBook:collateralBook.address,debtBook:debtBook.address,
    trustedNativeCpu:cpu,untrustedReference:dev.address,assetAndSwapSource:'Fork-only mock tokens and priced inventory. The enforcement processor is the genuine forked CPU.'}
  await call('Supply mock USD inventory',debt,'mint',[owner,200n*unit])
  await call('Approve lending seed',debt,'approve',[debtBook.address,200n*unit])
  await call('Seed debt book',debtBook,'mint',[200n*unit])
  await call('Activate fork market',controller,'activate')
  await call('Fund mock swap venue',debt,'mint',[venue.address,100n*unit])
  await call('Fund account with mock collateral',col,'mint',[account.address,110n*wad])
  await call('Enter v2 collateral',account,'enterCollateral')
  await call('Supply 100 mock collateral through v2',account,'supply',[100n*wad])
  await call('Fund direct borrower',col,'mint',[owner,100n*wad])
  await call('Approve direct collateral book',col,'approve',[collateralBook.address,100n*wad])
  await call('Supply direct collateral',collateralBook,'mint',[100n*wad])
  await call('Enter direct collateral',controller,'enterMarkets',[[collateralBook.address]])
  await call('Bound swap authority',account,'setGrant',[operator,swap.address,5,col.address,wad,3n*wad,deadline])
  const grant=()=>read(account.address,account.abi,'grants',[operator,swap.address,5,col.address])
  const state=async()=>{const values=await Promise.all([bookBalance(debtBook,account.address),bookBalance(debtBook,owner),balance(col,account.address),
    balance(debt,account.address),balance(debt,owner),grant(),read(col.address,col.abi,'allowance',[account.address,swap.address]),
    read(col.address,col.abi,'allowance',[swap.address,venue.address])])
    return {accountDebt:values[0],directDebt:values[1],accountCollateral:values[2],accountUsd:values[3],directUsd:values[4],grant:values[5],accountAllowance:values[6],adapterAllowance:values[7]}}
  d.operations=[]
  async function check({label,contract,name,args,actor=owner,error,expected}){
    const before=await state()
    const r=await call(label,contract,name,args,actor,error?'reverted':'success')
    const trace=await node.request({method:'debug_traceTransaction',params:[r.transactionHash,{tracer:'callTracer'}]})
    const frames=flatten(trace)
    assert(!frames.some(f=>f.to && getAddress(f.to)===getAddress(dev.address)),label+': reference processor in financial trace')
    const native=frames.filter(f=>f.type==='STATICCALL' && getAddress(f.to)===cpu && f.input.startsWith(toFunctionSelector('eval(uint256,bytes)'))).map(f=>{
      const decoded=decodeFunctionData({abi:packet.readOnlyAbi,data:f.input})
      return {id:decoded.args[0],inputs:decoded.args[1],decision:decodeAbiParameters([{type:'bytes'}],f.output)[0],gasUsed:BigInt(f.gasUsed)}
    })
    assert.deepEqual(native.map(x=>[x.id,x.decision]),expected,label+' unexpected native decisions')
    const after=await state()
    if(error){
      assert.equal(trace.output.slice(0,10),toFunctionSelector(error),label+' error '+trace.output)
      assert.equal(r.logs.length,0)
      assert.deepEqual(after,before,label+' changed financial state on failure')
    }
    d.operations.push({label,hash:r.transactionHash,status:r.status,block:r.blockNumber,gas:r.gasUsed,topLevelError:error??null,revertBytes:trace.output && error?trace.output:null,native,referenceCalls:0,before,after})
    return {before,after,r}
  }
  const [m,a,e]=d.programs.map(p=>p.id)
  const accountBorrow=(label,amount,expected,error)=>check({label,contract:account,name:'borrow',args:[amount],expected,error})
  const directBorrow=(label,amount,expected,error)=>check({label,contract:debtBook,name:'borrow',args:[amount],expected,error})
  const swapIt=(label,minOut,expected,error)=>check({label,contract:account,name:'swapExactIn',args:[col.address,wad,minOut,deadline],actor:operator,expected,error})
  await accountBorrow('ACCOUNT 5501 bps denied',55010000n,[[a,'0x00']],'AccountPolicyRejected(bytes32,uint8)')
  const b=await accountBorrow('ACCOUNT 5500 bps accepted by ACCOUNT and MARKET',55000000n,[[a,'0x01'],[m,'0x01']])
  assert.equal(b.after.accountDebt-b.before.accountDebt,55000000n)
  assert.equal(b.after.accountUsd-b.before.accountUsd,55000000n)
  await directBorrow('MARKET 6501 bps direct borrow denied',65010000n,[[m,'0x00']],'MarketPolicyRejected(bytes32,uint8)')
  const db=await directBorrow('MARKET 6500 bps direct borrow accepted',65000000n,[[m,'0x01']])
  assert.equal(db.after.directDebt-db.before.directDebt,65000000n)
  await swapIt('EXECUTION 101 bps denied',989900n,[[e,'0x00']],'ExecutionPolicyDenied()')
  const sw=await swapIt('EXECUTION 100 bps accepted',990000n,[[e,'0x01']])
  assert.equal(sw.before.accountCollateral-sw.after.accountCollateral,wad)
  assert.equal(sw.after.accountUsd-sw.before.accountUsd,999500n)
  assert.equal(sw.before.grant[1]-sw.after.grant[1],wad)
  assert.equal(sw.after.adapterAllowance+sw.after.accountAllowance,0n)
  // Reduce debt to leave ordinary risk-admissible calls available for each outage control.
  await call('Reduce v2 debt for failure-control cases',account,'repay',[5n*unit])
  await call('Approve direct repayment',debt,'approve',[debtBook.address,5n*unit])
  await call('Reduce direct debt for failure-control cases',debtBook,'repayBorrow',[5n*unit])
  const pre=await accountBorrow('Healthy native control for outage scenarios',unit,[[a,'0x01'],[m,'0x01']])
  assert.equal(pre.after.accountUsd-pre.before.accountUsd,unit)
  // Synthetic RPC failures only on our process-owned fork. Restore original bytes without reverting the mined history.
  const impl=getAddress(packet.bindings.beaconState.implementation)
  const faults=[
    {label:'unavailable native CPU',target:cpu,bytes:'0x'},
    {label:'malformed backend runtime (one raw byte)',target:impl,bytes:'0x600160005360016000f3'},
    {label:'changed proxy runtime',target:cpu,bytes:'0x00'},
  ]
  d.injectedFaults=[]
  for(const f of faults){
    const original=await node.getCode({address:f.target})
    assert.equal(keccak256(original),packet.bindings.targetHashes[f.target])
    await node.request({method:'anvil_setCode',params:[f.target,f.bytes]})
    try{
      d.injectedFaults.push({...f,expectedHash:keccak256(original),actualHash:keccak256(f.bytes),scope:'private Anvil state only'})
      await accountBorrow('Fail closed on v2 borrow: '+f.label,unit,[],'IdentityMismatch()')
      await directBorrow('Fail closed on direct borrow: '+f.label,unit,[],'IdentityMismatch()')
      await swapIt('Fail closed on v2 swap: '+f.label,990000n,[],'IdentityMismatch()')
      if(f.bytes==='0x'){
        const repayment=await check({label:'Owner repay while native CPU unavailable',contract:account,name:'repay',args:[unit],expected:[]})
        assert(repayment.after.accountDebt<repayment.before.accountDebt)
      }
    }finally{await node.request({method:'anvil_setCode',params:[f.target,original]})}
    assert.equal(keccak256(await node.getCode({address:f.target})),keccak256(original))
  }
  await swapIt('Native swap resumes after fork fault restoration',990000n,[[e,'0x01']])
  assert.equal(await read(witness.address,witness.abi,'marketId'),m)
}

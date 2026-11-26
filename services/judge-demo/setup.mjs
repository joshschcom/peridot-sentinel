import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {getAddress,keccak256,zeroHash} from 'viem'
import {studioMarketTemplate,compilePolicy} from '@peridot/circuit-sdk'
import {executionCircuit} from '../../contracts/expansion/policy/compile.mjs'
import {base,expansion,wad,usd,readJson,retryRead,writeJson} from './transport.mjs'
import {binding,call,checkedCode,checkArtifacts,data,deploy,event,m4,read,requireEqual} from './contracts.mjs'
const cpu=m4.DevelopmentReferenceProcessor,registry=m4.PolicyRegistry,mf=m4.MarketFactory
const limits=[7500,8500,1000n*wad,1000n*usd,900n*usd,10n*usd]
const tiers={A:[6350,6400,6450,6550,6600,6650,6700,6750,6800,6850,6900,6950,7000],B:[4850,4900,4950,5050,5100,4750,4700,4650,4600,4550,4500]}
const acctSpec=readJson('packages/circuit-sdk/fixtures/policies-v1.json').policies.find(p=>p.spec.kind==='ACCOUNT').spec
const sink=Object.fromEntries(Object.entries(m4).map(([k,c])=>[k,c.address]))

export async function funding(s) {
  checkArtifacts()
  const {deployer,owner,operator}=s.actors
  const plan=s.state.plan
  if(!plan.funding){
    const b=await s.head()
    const balances=Object.fromEntries(await Promise.all(Object.entries(s.actors).map(async ([k,a])=>[k,String(await s.balance(a,b.number))])))
    assert(await s.client.getCode({address:owner,blockNumber:b.number})===undefined,'Judge must be an EOA')
    assert.equal(await s.client.getTransactionCount({address:owner,blockNumber:b.number}),0,'Use a fresh judge wallet for a new campaign')
    const topup=(amount,floor,minimum)=>String(BigInt(amount)+minimum>floor?minimum:floor-BigInt(amount))
    // The 49-step fork setup used 9,977,949 deployer gas and 17,137,139 judge gas.
    // Round above the summed padded transaction limits and reserve separate walkthrough capacity.
    const gasPrice=s.live?await retryRead(()=>s.client.getGasPrice()):(b.baseFeePerGas??20_000_000n)*2n+1n
    const floor=(baseFloor,gasUnits)=>baseFloor>gasUnits*gasPrice?baseFloor:gasUnits*gasPrice
    const judgeValue=topup(balances.owner,floor(6_000_000_000_000_000n,30_000_000n),100_000_000_000_000n)
    const operatorValue=topup(balances.operator,floor(1_000_000_000_000_000n,2_000_000n),100_000_000_000_000n)
    assert(BigInt(judgeValue)<=15_000_000_000_000_000n && BigInt(operatorValue)<=15_000_000_000_000_000n,'Gas estimate exceeds demo transfer ceilings')
    const required=BigInt(judgeValue)+BigInt(operatorValue)+16_000_000n*gasPrice
    assert(BigInt(balances.deployer)>=required,'Deployer needs '+required+' wei for funding and padded gas; ask Claude for testnet faucet funds')
    plan.funding={blockNumber:String(b.number),blockHash:b.hash,balances,judgeValue,operatorValue,gasPriceWei:String(gasPrice),minimumDeployerBalanceWei:String(required)}
    plan.caps={}
    for(const [id,list] of Object.entries(tiers)){
      for(const cap of list){
        const spec=studioMarketTemplate(cap,true).compiled
        if(await read(s,registry,'marketTemplatePolicy',[cpu.address,spec.configHash],b.number)===zeroHash){plan.caps[id]=cap;break}
      }
      assert(plan.caps[id],'Need another unused Studio slider cap for '+id)
    }
    s.save()
  }
  for(const [label,address,value] of [['fund-judge',owner,plan.funding.judgeValue],['fund-operator',operator,plan.funding.operatorValue]])
    await s.send(label,'deployer',address,'0x',{value:BigInt(value)})
  console.error('Fresh Studio policy caps in bps',plan.caps,'judge',owner)
  return plan.funding
}

async function acceptBrowserMarket(s,hash,cap){
  assert(/^0x[0-9a-fA-F]{64}$/.test(hash),'Invalid Studio receipt')
  const receipt=await retryRead(async()=>{
    const r=await s.client.getTransactionReceipt({hash})
    const other=await s.witness.getTransactionReceipt({hash})
    assert.equal(r.blockHash,other.blockHash);assert.equal((await s.client.getBlock({blockNumber:r.blockNumber})).hash,r.blockHash)
    assert((await s.witness.getBlockNumber())>=r.blockNumber+(s.live?2n:0n))
    return r
  })
  assert.equal(receipt.status,'success');requireEqual(receipt.from,s.actors.owner);requireEqual(receipt.to,mf.address)
  assert(receipt.blockNumber>BigInt(s.state.steps['fund-judge'].blockNumber))
  const created=event(receipt,mf,'MarketCreated');requireEqual(created.owner,s.actors.owner)
  const t=await retryRead(()=>s.client.getTransaction({hash}))
  assert.equal(t.input,data(mf,'createMarket',[created.policyId,...limits]))
  const spec=studioMarketTemplate(cap,true).compiled
  const e=await read(s,registry,'getPolicy',[created.policyId],receipt.blockNumber)
  requireEqual(e.publisher,s.actors.owner);requireEqual(e.processor,cpu.address)
  assert.equal(e.netlistHash,spec.netlistHash);assert.equal(e.configHash,spec.configHash)
  assert.equal(await read(s,registry,'marketTemplatePolicy',[cpu.address,spec.configHash],BigInt(s.state.plan.funding.blockNumber)),zeroHash)
  return {receipt,policy:{circuitId:String(e.circuitId),policyId:created.policyId,configHash:e.configHash,netlistHash:e.netlistHash,capBps:cap}}
}
async function marketPolicy(s,id,cap){
  const {compiled,proof}=studioMarketTemplate(cap,true)
  const r=await call(s,'studio-circuit-'+id,'owner',cpu,'addReferenceCircuit',[compiled.netlist])
  const {id:circuitId,netlistHash}=event(r,cpu,'ReferenceCircuitAdded');assert.equal(netlistHash,compiled.netlistHash)
  const rr=await call(s,'studio-register-'+id,'owner',registry,'registerMarketTemplate',[cpu.address,circuitId,cap,true,netlistHash,compiled.configHash,proof])
  const e=event(rr,registry,'MarketTemplateRegistered')
  const entry=await read(s,registry,'getPolicy',[e.policyId],rr.blockNumber)
  assert.equal(entry.circuitId,circuitId);requireEqual(entry.publisher,s.actors.owner)
  return {circuitId:String(circuitId),policyId:e.policyId,configHash:compiled.configHash,netlistHash,capBps:cap}
}
async function accountPolicy(s){
  const compiled=compilePolicy(acctSpec)
  const r=await call(s,'account-circuit','deployer',cpu,'addReferenceCircuit',[compiled.netlist])
  const {id:circuitId,netlistHash}=event(r,cpu,'ReferenceCircuitAdded');assert.equal(netlistHash,compiled.netlistHash)
  const rr=await call(s,'register-account','deployer',registry,'register',[cpu.address,circuitId,1,netlistHash,compiled.configHash,zeroHash])
  const {policyId}=event(rr,registry,'PolicyRegistered')
  return {circuitId:String(circuitId),policyId,configHash:compiled.configHash,netlistHash,capBps:5500}
}

export async function refreshFeeds(s,refs,force=false){
  // On M4 preserve the live valuation. No judge action can change the relative price of existing books.
  for(const [key,oracle,asset,initial] of refs){
    requireEqual(await read(s,oracle,'owner'),s.actors.deployer)
    const b=await s.head()
    const [price,timestamp]=await read(s,oracle,'quotes',[asset],b.number)
    const label='initial-price-'+key
    if(!s.state.steps[label]){
      const amount=price||initial
      assert(amount>0n)
      s.state.plan[label]??=String(amount);s.save()
      assert.equal(price||initial,BigInt(s.state.plan[label]),'Mock price changed before initial refresh')
      await call(s,label,'deployer',oracle,'setPrice',[asset,amount])
    } else if(force && b.timestamp-timestamp>=3600n){
      assert(price>0n)
      await call(s,'refresh-'+key+'-'+timestamp,'deployer',oracle,'setPrice',[asset,price])
    }
  }
}
const sharedFeeds=()=>[['mCOL',m4.TestnetOracle,m4.MockCollateral.address,0n],['mUSD',m4.TestnetOracle,m4.MockDebt.address,0n]]
const privateFeeds=addresses=>[['jWOKB',binding('TestnetOracle',addresses.mockOracle),addresses.mockWokb,80n*wad],['jUSDC',binding('TestnetOracle',addresses.mockOracle),addresses.mockUsdc,wad]]
export const refresh=async(s,m)=>refreshFeeds(s,[...sharedFeeds(),...privateFeeds(m.contracts)],true)

async function makeMarket(s,id,policy,acct,browser){
  const owner=s.actors.owner
  const r=browser??await call(s,'studio-create-'+id,'owner',mf,'createMarket',[policy.policyId,...limits])
  const created=event(r,mf,'MarketCreated');requireEqual(created.owner,owner)
  const controller=binding('IsolatedController',created.controller), debt=binding('MarketPToken',created.debtMarket)
  await call(s,'liquidity-'+id,'owner',m4.MockDebt,'mint',[owner,200n*usd])
  await call(s,'approve-'+id,'owner',m4.MockDebt,'approve',[debt.address,200n*usd])
  await call(s,'seed-'+id,'owner',debt,'mint',[200n*usd])
  await call(s,'activate-'+id,'owner',controller,'activate')
  const a=await call(s,'create-v1-'+id,'owner',m4.SentinelAccountFactory,'createAccount',[controller.address,acct.policyId])
  const account=binding('SentinelAccount',event(a,m4.SentinelAccountFactory,'AccountCreated').account)
  requireEqual(await read(s,account,'owner',[],a.blockNumber),owner)
  await call(s,'collateral-'+id,'owner',m4.MockCollateral,'mint',[account.address,100n*wad])
  await call(s,'enter-'+id,'owner',account,'enterCollateral')
  await call(s,'supply-'+id,'owner',account,'supply',[100n*wad])
  return {controller:controller.address,debtMarket:debt.address,collateralMarket:getAddress(created.collateralMarket),account:account.address,
    marketPolicy:policy.policyId,creationTx:r.transactionHash,creationBlock:String(r.blockNumber),marketId:String(created.marketId)}
}

export async function setup(s,adopt){
  const manifestPath=s.dir+'/manifest.json'
  if(existsSync(manifestPath)){
    const existing=readJson(manifestPath)
    assert.equal(existing.owner,s.actors.owner);assert.equal(existing.profile,s.profile)
    assert(!adopt || adopt===existing.markets.A.creationTx,'Cannot replace a prepared campaign market')
    await refresh(s,existing)
    const {readiness}=await import('./operations.mjs')
    const ready=await readiness(s,existing)
    writeJson(s.dir+'/readiness.json',ready)
    console.error('Reconciled original campaign. Repay ready:',ready.repayReady,'swap ready:',ready.swapReady,'deployer wei:',String(ready.deployerWei))
    return manifestPath
  }
  if(adopt) assert(s.state.steps['fund-judge']?.status==='success','Run fund before Studio so the judge and fresh policy baseline can be verified')
  await funding(s)
  const p=s.state.plan
  if(p.adoptedA!==undefined)assert.equal(adopt??null,p.adoptedA,'Restart with the original Studio decision')
  // Validate the independently created market before fixing this campaign's choice or refreshing shared prices.
  const browser=adopt?await acceptBrowserMarket(s,adopt,p.caps.A):null
  p.adoptedA=adopt??null;s.save()
  await refreshFeeds(s,sharedFeeds(),true)
  const policies={A:browser?.policy??await marketPolicy(s,'A',p.caps.A),B:await marketPolicy(s,'B',p.caps.B),account:await accountPolicy(s)}
  const markets={A:await makeMarket(s,'A',policies.A,policies.account,browser?.receipt),B:await makeMarket(s,'B',policies.B,policies.account)}
  const v1=binding('SentinelAccount',markets.A.account)
  const block=await s.head()
  const [pc]=await read(s,m4.TestnetOracle,'quotes',[m4.MockCollateral.address],block.number)
  const [pd]=await read(s,m4.TestnetOracle,'quotes',[m4.MockDebt.address],block.number)
  p.borrow??=String(100n*usd*pc*4n/(pd*10n));s.save() // 40% actual post-borrow LTV with 100 mCOL deposited.
  assert(BigInt(p.borrow)>2n*usd && BigInt(p.borrow)+10n*usd<200n*usd,'Mock valuation exceeds this fixed-size demo')
  await call(s,'borrow-A','owner',v1,'borrow',[BigInt(p.borrow)])
  p.expiry??=String(block.timestamp+7n*86400n);s.save()
  await call(s,'trigger','owner',v1,'setAutoRepayTrigger',[3500])
  await call(s,'repay-only','owner',v1,'setOperator',[s.actors.operator,8,2n*usd,BigInt(p.expiry)])
  const boxes={}
  boxes.mockWokb=await deploy(s,'mockWokb',['Judge mock WOKB','jWOKB',18])
  boxes.mockUsdc=await deploy(s,'mockUsdc',['Judge mock USDC','jUSDC',6])
  boxes.mockOracle=await deploy(s,'mockOracle')
  const addresses=()=>Object.fromEntries(Object.entries(boxes).map(([k,c])=>[k,c.address]))
  await refreshFeeds(s,privateFeeds(addresses()),true)
  boxes.cpu=await deploy(s,'cpu')
  const exec=await call(s,'execution-circuit','deployer',boxes.cpu,'addReferenceCircuit',[executionCircuit.netlist])
  const {id:cid,netlistHash}=event(exec,boxes.cpu,'ReferenceCircuitAdded')
  assert.equal(netlistHash,executionCircuit.netlistHash)
  policies.execution={circuitId:String(cid),netlistHash,mode:'development-reference',processor:boxes.cpu.address}
  boxes.execution=await deploy(s,'execution',[boxes.cpu.address,cid])
  boxes.source=await deploy(s,'source',[boxes.mockOracle.address])
  boxes.venue=await deploy(s,'venue',[boxes.mockWokb.address,boxes.mockUsdc.address,80n*wad,wad])
  await call(s,'jWOKB-inventory','deployer',boxes.mockWokb,'mint',[boxes.venue.address,10n*wad])
  await call(s,'jUSDC-inventory','deployer',boxes.mockUsdc,'mint',[boxes.venue.address,800n*usd])
  boxes.swap=await deploy(s,'swap',[boxes.venue.address,boxes.venue.address,boxes.mockWokb.address,boxes.mockUsdc.address,boxes.source.address,86400n,500])
  boxes.lending=await deploy(s,'lending',[mf.address,markets.A.controller])
  boxes.factory=await deploy(s,'factory',[boxes.lending.address,boxes.swap.address,boxes.execution.address])
  const v2=await call(s,'create-v2','owner',boxes.factory,'createAccount',[policies.account.policyId])
  boxes.account=binding('SentinelAccountV2',event(v2,boxes.factory,'AccountCreated').account)
  await call(s,'jWOKB-account','deployer',boxes.mockWokb,'mint',[boxes.account.address,3n*wad])
  const end=await call(s,'swap-only','owner',boxes.account,'setGrant',[s.actors.operator,boxes.swap.address,5,boxes.mockWokb.address,wad,2n*wad,BigInt(p.expiry)])
  const at=end.blockNumber,hashes={}
  for(const [key,box] of Object.entries(boxes)) hashes[key]=await checkedCode(s,box,at)
  assert.deepEqual(await read(s,boxes.account,'grants',[s.actors.operator,boxes.swap.address,5,boxes.mockWokb.address],at),[wad,2n*wad,BigInt(p.expiry)])
  assert.deepEqual(await read(s,v1,'operators',[s.actors.operator],at),[8,2n*usd,BigInt(p.expiry)])
  assert.equal(await read(s,boxes.account,'operatorCount',[],at),1n)
  const balances=Object.fromEntries(await Promise.all(Object.entries(s.actors).map(async([k,a])=>[k,String(await s.balance(a,at))])))
  const manifest={schemaVersion:1,chainId:1952,profile:s.profile,campaign:s.campaign,label:'Valueless inventory-backed mock assets and development reference circuits',
    activity:{path:'./activity.json',kind:'judge-event-snapshot',schemaVersion:1},
    deploymentBlock:s.state.steps['fund-judge'].blockNumber,preparedBlock:String(at),preparedBlockHash:end.blockHash,
    ...s.actors,base:sink,markets,policies,contracts:addresses(),runtimeCodeHashes:hashes,
    source:{baseCommit:base.commit,expansionCommit:expansion.source.expansionCommit},
    grants:{repay:{account:v1.address,budgetRaw:String(2n*usd),expiry:p.expiry},swap:{account:boxes.account.address,perCallRaw:String(wad),remainingRaw:String(2n*wad),expiry:p.expiry}},
    funding:{...p.funding,afterWei:balances,judgeTransfer:s.state.steps['fund-judge'].hash,operatorTransfer:s.state.steps['fund-operator'].hash},
    setupReceipts:Object.fromEntries(Object.entries(s.state.steps).map(([key,step])=>[key,step.hash]))}
  const {readiness}=await import('./operations.mjs')
  const ready=await readiness(s,manifest);assert(ready.repayReady && ready.swapReady,'Initial grants/positions failed live checks')
  writeJson(s.dir+'/readiness.json',ready)
  writeJson(manifestPath,manifest)
  console.error('Prepared. Deployer balance in wei:',balances.deployer)
  return manifestPath
}

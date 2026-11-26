// Run from repo root. The Session 6 journal owns all sends, signer and nonce handling.
import assert from 'node:assert/strict'
import {
  decodeErrorResult, decodeFunctionResult, encodeErrorResult, encodeFunctionData, getAddress,
  multicall3Abi, numberToHex, parseEventLogs, zeroHash,
} from 'viem'
import * as abis from '@peridot/chain-config'
import {studioMarketTemplate, STUDIO_MARKET_ROOT} from '@peridot/circuit-sdk'
import {openSession, readJson, retryRead, writeJson} from './session6-transactions.mjs'

const mode = process.argv[2]
const s = await openSession({mode, slug:'independent-rejections', forkPort:19636})
const manifest = readJson('packages/chain-config/deployments/1952.json')
const m4 = manifest.contracts
const bind = (name,address) => ({address:getAddress(address), abi:abis[name+'Abi']})
const registry = bind('PolicyRegistry',m4.PolicyRegistry)
const cpu = bind('DevelopmentReferenceProcessor',manifest.tapeout.processor)
const adapter = bind('TapeOutPolicyAdapter',m4.TapeOutPolicyAdapter)
const markets = bind('MarketFactory',m4.MarketFactory)
const accounts = bind('SentinelAccountFactory',m4.SentinelAccountFactory)
const oracle = bind('TestnetOracle',m4.TestnetOracle)
const col = bind('TestnetToken',m4.MockCollateral)
const usd = bind('TestnetToken',m4.MockDebt)
const accountPolicy = manifest.tapeout.circuits.find(x=>x.kind==='ACCOUNT').policyId
const marketPolicyA = manifest.tapeout.circuits.find(x=>x.kind==='MARKET').policyId
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11'
const wad = 10n**18n
const micro = 10n**6n
const borrow = 2
const negativeGas = 2_000_000n
const digest = (c,fn,args=[]) => encodeFunctionData({abi:c.abi,functionName:fn,args})
const read = (c,fn,args=[],blockNumber) => s.readContract({...c,functionName:fn,args,blockNumber})
const send = (label,c,fn,args=[],options={}) => s.send(label,{to:c.address,data:digest(c,fn,args),...options})
const eq = (a,b) => assert.equal(getAddress(a),getAddress(b))
const event = (receipt,c,name) => {
  const matching = parseEventLogs({abi:c.abi,eventName:name,strict:true,
    logs:receipt.logs.filter(x=>getAddress(x.address)===c.address)})
  assert.equal(matching.length,1,'Expected one '+name+' from '+c.address)
  return matching[0].args
}
const head = () => retryRead(()=>s.client.getBlock(), b=>
  Object.values(s.state.steps).every(step=>!step.block || b.number>=BigInt(step.block)))

async function freshFeeds() {
  // Keep the last mock valuation. Renew only the timestamps required for a fresh risk check.
  const plans = s.state.data.refreshes ??= []
  for (const {label,asset,price} of plans) await send(label,oracle,'setPrice',[asset,BigInt(price)])
  if(s.state.steps['market-policy-denied']?.hash) return
  const block = await head()
  for(const asset of [col.address,usd.address]) {
    const [price,timestamp] = await read(oracle,'quotes',[asset],block.number)
    assert(price>0n && timestamp<=block.timestamp)
    if(block.timestamp+600n < timestamp+86400n) continue
    eq(await read(oracle,'owner',[],block.number),s.actor)
    const label='refresh-'+asset+'-'+timestamp
    plans.push({label,asset,price:String(price)})
    s.save()
    await send(label,oracle,'setPrice',[asset,price])
  }
}

async function studioMarketB() {
  const {compiled,proof} = studioMarketTemplate(5000,true)
  const block = await head()
  assert.equal(await read(registry,'MARKET_TEMPLATE_ROOT',[],block.number),STUDIO_MARKET_ROOT)
  const existing = await read(registry,'marketTemplatePolicy',[cpu.address,compiled.configHash],block.number)
  if(existing===zeroHash || s.state.steps['studio-add-program']) {
    const receipt=await send('studio-add-program',cpu,'addReferenceCircuit',[compiled.netlist])
    const {id,netlistHash}=event(receipt,cpu,'ReferenceCircuitAdded')
    assert.equal(netlistHash,compiled.netlistHash)
    await send('studio-register-market-5000',registry,'registerMarketTemplate',
      [cpu.address,id,5000,true,compiled.netlistHash,compiled.configHash,proof])
  }
  const canonical=await retryRead(()=>read(registry,'marketTemplatePolicy',[cpu.address,compiled.configHash]),id=>id!==zeroHash)
  const entry=await read(registry,'getPolicy',[canonical])
  assert.equal(entry.kind,0)
  eq(entry.processor,cpu.address)
  assert.equal(entry.netlistHash,compiled.netlistHash)
  const created=await send('studio-create-market-B',markets,'createMarket',
    [canonical,7500,8500,1000n*wad,1000n*micro,900n*micro,10n*micro])
  const {controller,collateralMarket,debtMarket,owner,policyId,marketId}=event(created,markets,'MarketCreated')
  eq(owner,s.actor)
  assert.equal(policyId,canonical)
  assert.notEqual(getAddress(controller),getAddress(manifest.markets[0].controller))
  const sentinel=await send('create-sentinel-B',accounts,'createAccount',[controller,accountPolicy])
  const {account}=event(sentinel,accounts,'AccountCreated')
  const scope={controller:bind('IsolatedController',controller),shares:bind('MarketPToken',collateralMarket),
    debt:bind('MarketPToken',debtMarket),account:bind('SentinelAccount',account),marketPolicy:canonical}
  await send('mint-debt-liquidity-B',usd,'mint',[s.actor,200n*micro])
  await send('approve-debt-book-B',usd,'approve',[debtMarket,200n*micro])
  await send('seed-debt-book-B',scope.debt,'mint',[200n*micro])
  await send('activate-market-B',scope.controller,'activate')
  await send('mint-collateral-to-account-B',col,'mint',[account,100n*wad])
  await send('enter-collateral-B',scope.account,'enterCollateral')
  await send('supply-collateral-B',scope.account,'supply',[100n*wad])
  return {scope,marketId,template:{configHash:compiled.configHash,netlistHash:compiled.netlistHash,merkleRoot:STUDIO_MARKET_ROOT}}
}

async function accrued(scope,queries,blockNumber) {
  // The account calls controller.accrue() immediately before previewPolicy(). Simulate the same order
  // inside a single eth_call. No accrued state from this read reaches the deployed lending books.
  const calls=[{target:scope.controller.address,allowFailure:false,callData:digest(scope.controller,'accrue')},
    ...queries.map(([c,fn,args])=>({target:c.address,allowFailure:false,callData:digest(c,fn,args)}))]
  const rows=await s.readContract({address:multicall,abi:multicall3Abi,functionName:'aggregate3',args:[calls],blockNumber})
  return queries.map(([c,fn],i)=>decodeFunctionResult({abi:c.abi,functionName:fn,data:rows[i+1].returnData}))
}

async function borrowAmount(scope,targetBps,blockNumber) {
  const [shares,rate,debt,[pc,fc],[pd,fd]]=await accrued(scope,[
    [scope.shares,'balanceOf',[scope.account.address]],[scope.shares,'exchangeRateStored'],
    [scope.debt,'borrowBalanceStored',[scope.account.address]],[oracle,'price',[col.address]],
    [oracle,'price',[usd.address]],
  ],blockNumber)
  assert(fc && fd && pc>0n && pd>0n)
  const colValue=shares*rate/wad*pc/wad
  const target=colValue*targetBps*micro/(10_000n*pd)
  assert(target>debt,'Borrower already exceeds demo target')
  return target-debt
}

async function expectPolicyRevert(scope,calldata,kind,policyId,blockNumber) {
  const expected=encodeErrorResult({abi:adapter.abi,errorName:kind,args:[policyId,1]})
  const raw=await retryRead(async()=>{
    try {
      await s.client.request({method:'eth_call',params:[{from:s.actor,to:scope.account.address,
        data:calldata,gas:numberToHex(negativeGas)},numberToHex(blockNumber)]})
    } catch(error) {
      for(let err=error;err;err=err.cause){
        const data=typeof err.data==='string'?err.data:err.data?.data
        if(typeof data==='string' && /^0x[0-9a-f]{8,}$/i.test(data)) return data
      }
      throw error
    }
    throw Error('Expected typed borrow denial')
  })
  assert.equal(raw,expected,'eth_call returned another error')
  const decoded=decodeErrorResult({abi:adapter.abi,data:raw})
  return {raw,name:decoded.errorName,policyId:decoded.args[0],reasonCode:decoded.args[1]}
}

async function rejection(scope,across,targetBps,deniedKind,label) {
  const {controller,shares,debt,account,marketPolicy}=scope
  const kind=deniedKind==='ACCOUNT'?'AccountPolicyRejected':'MarketPolicyRejected'
  const deniedId=deniedKind==='ACCOUNT'?accountPolicy:marketPolicy
  let planned=s.state.data[label]
  if(!planned) {
    const block=await head()
    const amount=await borrowAmount(scope,targetBps,block.number)
    planned={amount:String(amount),block:String(block.number),blockHash:block.hash}
    s.state.data[label]=planned
    s.save()
  }
  const amount=BigInt(planned.amount)
  const data=digest(account,'borrow',[amount])
  // Refuse to send an intentional negative if it might instead succeed.
  if(!s.state.steps[label]?.hash) {
    const block=await head()
    await expectPolicyRevert(scope,data,kind,deniedId,block.number)
  }
  const r=await send(label,account,'borrow',[amount],{gas:negativeGas,expected:'reverted'})
  const parent=await retryRead(()=>s.client.getBlock({blockNumber:r.blockNumber-1n}))
  const mined=await retryRead(()=>s.client.getBlock({blockNumber:r.blockNumber}))
  assert.equal(mined.parentHash,parent.hash)
  assert.equal(mined.hash,r.blockHash)
  const tx=await retryRead(()=>s.client.getTransaction({hash:r.transactionHash}))
  eq(tx.from,s.actor);eq(tx.to,account.address)
  assert.equal(tx.input,data)
  assert.equal(tx.gas,negativeGas)
  assert(r.gasUsed<tx.gas)
  const parentRevert=await expectPolicyRevert(scope,data,kind,deniedId,parent.number)
  const minedRevert=await expectPolicyRevert(scope,data,kind,deniedId,mined.number)
  const [preview,borrowed,cash]=await accrued(scope,[
    [controller,'previewPolicy',[account.address,borrow,debt.address,amount]],
    [debt,'totalBorrows'],[debt,'getCash'],
  ],mined.number)
  const [applies,fresh,ltv,cashOk]=preview
  assert(applies && fresh && cashOk && ltv>=targetBps-2n && ltv<=targetBps+2n)
  const [protocolBorrowBps,liquidationBps,,,borrowCap,minCash]=await read(controller,'limits',[],mined.number)
  assert(ltv<=protocolBorrowBps && cash>=amount+minCash && borrowed+amount<=borrowCap)
  assert(await read(controller,'active',[],mined.number))
  assert(await read(controller,'collateralEntered',[account.address],mined.number))
  eq(await read(account,'owner',[],mined.number),s.actor)
  eq(await read(account,'controller',[],mined.number),controller.address)
  assert.equal(await read(account,'policyId',[],mined.number),accountPolicy)
  assert.equal(await read(controller,'policyId',[],mined.number),marketPolicy)
  const context=await read(adapter,'encodeContext',[borrow,fresh,ltv,cashOk],mined.number)
  const decisions=[]
  for(const [role,id] of [['MARKET',marketPolicy],['ACCOUNT',accountPolicy]]) {
    const e=await read(registry,'getPolicy',[id],mined.number)
    eq(e.processor,cpu.address)
    const output=await read(cpu,'eval',[e.circuitId,context],mined.number)
    assert.equal(output,role===deniedKind?'0x00':'0x01')
    decisions.push({role,policyId:id,netlistHash:e.netlistHash,processor:e.processor,circuitId:e.circuitId,output})
  }
  const before=await read(debt,'borrowBalanceStored',[account.address],parent.number)
  const after=await read(debt,'borrowBalanceStored',[account.address],mined.number)
  assert.equal(before,after)
  return {market:across,controller:controller.address,account:account.address,collateralBook:shares.address,
    debtBook:debt.address,amountRaw:amount,intendedLtvBps:targetBps,postLtvBps:ltv,priorBlock:parent.number,
    priorBlockHash:parent.hash,block:r.blockNumber,blockHash:r.blockHash,hash:r.transactionHash,
    transactionIndex:r.transactionIndex,status:r.status,logs:r.logs.length,gasLimit:tx.gas,gasUsed:r.gasUsed,
    from:tx.from,to:tx.to,calldata:tx.input,reasonSource:'Exact eth_call replay at parent block and mined block, matching custom error bytes; receipt independently shows mined failure.',
    parentRevert,minedRevert,applicable:applies,oracleFresh:fresh,cashOk,protocolBorrowBps,liquidationBps,
    marketBorrowCapRaw:borrowCap,marketBorrowsRaw:borrowed,marketCashRaw:cash,minimumCashRaw:minCash,
    storedDebtBefore:before,storedDebtAfter:after,context,decisions}
}

try {
  assert.equal(manifest.chainId,1952)
  assert.equal(manifest.tapeout.mode,'development-reference')
  assert.equal(await read(col,'decimals'),18);assert.equal(await read(usd,'decimals'),6)
  await freshFeeds()
  const a=manifest.markets[0]
  const acctA=await read(accounts,'accountOf',[s.actor,a.controller])
  eq(acctA,readJson('evidence/testnet/keeper-auto-repay-1952.json').sentinelAccount)
  const scopeA={controller:bind('IsolatedController',a.controller),shares:bind('MarketPToken',a.collateralMarket),
    debt:bind('MarketPToken',a.debtMarket),account:bind('SentinelAccount',acctA),marketPolicy:marketPolicyA}
  const first=await rejection(scopeA,'A',5800n,'ACCOUNT','account-policy-denied')
  const b=await studioMarketB()
  const second=await rejection(b.scope,'B',5200n,'MARKET','market-policy-denied')
  const info=mode==='fork'?(await s.client.request({method:'anvil_nodeInfo'})).forkConfig:null
  const result={label:mode==='fork'?'Private Anvil fork of X Layer testnet 1952':'Public X Layer testnet 1952',
    chainId:1952,fork:info,profile:'M4 lending, valueless mock tokens and mock USD feed, Peridot development reference processor',
    journal:s.dir,actor:s.actor,marketB:{marketId:b.marketId,flow:'Studio SDK compile and Merkle registration, factory creation, seed, activation and owner funding via script',...b.template},
    rejections:[first,second],transactions:s.state.steps}
  const out=mode==='testnet'?'evidence/session6-rejections/public-1952.json':
    'evidence/session6-rejections/'+s.dir.split('/').at(-2)+'.json'
  writeJson(out,result)
  console.log(out)
} finally {s.close()}

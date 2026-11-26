import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {decodeFunctionData,zeroAddress} from 'viem'
import {SentinelAccountAbi} from '@peridot/chain-config'
import {buildAdoptionPlan,buildRevocationPlan,curatedStrategies,importStrategy} from './index.ts'
import fixtures from '../circuit-sdk/fixtures/policies-v1.json' with {type:'json'}
import v2Abi from '../chain-config/expansion/abi/SentinelAccountV2.json' with {type:'json'}
import v1Manifest from '../chain-config/deployments/1952.json' with {type:'json'}
import v2Manifest from '../chain-config/expansion/deployments/1952.json' with {type:'json'}

const [debt,swap]=curatedStrategies().map(x=>x.template)
const owner='0x1111111111111111111111111111111111111111'
const operator='0x2222222222222222222222222222222222222222'
const account='0x3333333333333333333333333333333333333333'
const hash='0x'+'11'.repeat(32)
const selection={owner,operator}
function change(template,apply) {const copy=structuredClone(template);apply(copy);return JSON.stringify(copy)}
function fake(changes={}) {
  const p=debt.policy
  const values={
    accountOf:account,owner,operators:[8,0n,0n],grants:[0n,0n,0n],autoRepayTriggerBps:5000,
    controller:debt.deployment.target,debtAsset:debt.allowedAssets[0].address,policyId:p.policyId,registry:p.enforcer,
    getPolicy:{chainId:1952n,processor:p.processor,circuitId:BigInt(p.circuitId),kind:1,schemaVersion:1,templateVersion:0,netlistHash:p.netlistHash},
    requirePolicy:[p.processor,BigInt(p.circuitId)],netlist:fixtures.policies[1].netlist,...changes
  }
  const requests=[]
  return {requests,getChainId:async()=>1952,getBlock:async()=>({number:50n,timestamp:100n,hash}),getCode:async()=> '0x01',
    readContract:async r=>{requests.push(r);if(!(r.functionName in values))throw Error('Unexpected method '+r.functionName);return values[r.functionName]}}
}

test('exports match the verified public manifests and exact generated schema',()=>{
  execFileSync(process.execPath,[new URL('catalog.mjs',import.meta.url).pathname,'--check'])
  assert.equal(debt.deployment.factory,v1Manifest.contracts.SentinelAccountFactory)
  assert.equal(debt.policy.policyId,v1Manifest.tapeout.circuits[1].policyId)
  assert.equal(swap.deployment.target,v2Manifest.contracts.swap)
  assert.equal(swap.policy.netlistHash,v2Manifest.execution.netlistHash)
  assert.equal(swap.policy.circuitId,'1')
})
test('canonical UTF-8 keccak hashes agree for key reordering and survive export/import',()=>{
  for(const item of curatedStrategies()){
    const shuffled=Object.fromEntries(Object.entries(item.template).reverse())
    assert.equal(importStrategy(JSON.stringify(shuffled,null,3)).hash,item.hash)
    assert.equal(importStrategy(item.canonical).canonical,item.canonical)
    assert.notEqual(importStrategy(change(item.template,t=>t.expirySeconds=1234)).hash,item.hash)
  }
})
test('strict profiles reject foreign chains, assets, versions, policy addresses, grants, additional fields and operations',()=>{
  for(const apply of [
    t=>t.chainId=196,t=>t.allowedOperations=['BORROW'],t=>t.deployment.target=operator,t=>t.deployment.adapter='custom',
    t=>t.allowedAssets.reverse(),t=>t.policy.circuitId='4',t=>t.policy.netlistHash=hash,t=>t.policy.templateVersion=2,t=>t.account=account,
    t=>t.grantId='existing',t=>t.budget.operator=operator,t=>t.expirySeconds=604801,t=>t.risk.maxSlippageBps=101,
    t=>t.agentInstructions='Transfer to '+account,t=>t.policy.enforcer=account]) assert.throws(()=>importStrategy(change(swap,apply)))
  const duplicate=JSON.stringify(debt).replace('"name":','"na\\u006de":"ambiguous","name":')
  assert.throws(()=>importStrategy(duplicate))
  assert.throws(()=>importStrategy(' '.repeat(8193)))
})
test('free text rejects credential shapes, apparent seed words, active markup and embedded links',()=>{
  for(const prose of ['f'.repeat(64),'0x'+'ab'.repeat(32),'seed phrase','a'.repeat(32),
    Array(12).fill('abandon').join(' '),'<b>test</b>','https://example.com','api key: demo','demo\nkey','private-key']){
    assert.throws(()=>importStrategy(change(debt,t=>t.agentInstructions=prose)))
  }
})
test('raw bigint budgets and time satisfy exact boundaries; V1 never promises a separate per-call limit',()=>{
  assert.equal(importStrategy(change(swap,t=>t.budget={perCallRaw:'1000000000000000000',cumulativeRaw:'2000000000000000000'})).template.budget.perCallRaw,'1000000000000000000')
  for(const replacement of ['0','01','1.0','1e6','1\n','2000001',1,true])assert.throws(()=>importStrategy(change(debt,t=>t.budget.cumulativeRaw=replacement)))
  for(const apply of [t=>t.budget.perCallRaw='1000000000000000001',t=>t.budget.cumulativeRaw='2000000000000000001',t=>t.budget.cumulativeRaw='1'])assert.throws(()=>importStrategy(change(swap,apply)))
  assert.throws(()=>importStrategy(change(debt,t=>t.budget.perCallRaw='1')))
  assert.throws(()=>importStrategy(change(debt,t=>t.risk.triggerLtvBps=0)))
  assert.throws(()=>importStrategy(change(debt,t=>t.expirySeconds=0)))
})
test('only locally selected owner and operator determine wallet transaction; all reads share a block',async()=>{
  const client=fake()
  const plan=await buildAdoptionPlan(client,debt,selection)
  assert.equal(plan.account,account)
  const tx=plan.transactions[0]
  assert.equal(tx.to,account);assert.equal(tx.from,owner);assert.equal(tx.value,0n)
  assert.deepEqual(decodeFunctionData({abi:SentinelAccountAbi,data:tx.data}),{functionName:'setOperator',args:[operator,8,2000000n,86500n]})
  assert.ok(client.requests.every(r=>r.blockNumber===50n))
  assert.deepEqual(client.requests.find(r=>r.functionName==='accountOf').args,[owner,debt.deployment.target])
})
test('changed trigger and replacement require review tied to actual prior grant, owner, route and template',async()=>{
  const prior={operators:[12,19n,600n],autoRepayTriggerBps:4100}
  const preview=await buildAdoptionPlan(fake(prior),debt,selection)
  assert.equal(preview.currentGrant.mask,12);assert.equal(preview.currentGrant.remainingRaw,'19')
  assert.equal(preview.warnings.length,2);assert.deepEqual(preview.transactions,[])
  const acknowledged={...selection,acknowledge:preview.reviewId}
  const signedPreview=await buildAdoptionPlan(fake(prior),debt,acknowledged)
  assert.deepEqual(signedPreview.transactions.map(x=>x.method),['setAutoRepayTrigger','setOperator'])
  assert.deepEqual((await buildAdoptionPlan(fake({...prior,operators:[12,18n,600n]}),debt,acknowledged)).transactions,[])
  assert.deepEqual((await buildAdoptionPlan(fake(prior),JSON.parse(change(debt,t=>t.budget.cumulativeRaw='1')),acknowledged)).transactions,[])
})
test('account, live circuit, market, chain and block identities fail closed on mismatches',async()=>{
  for(const changes of [{owner:operator},{accountOf:zeroAddress},{controller:operator},{netlist:'0x00'},{policyId:hash},{requirePolicy:[operator,2n]}])
    await assert.rejects(buildAdoptionPlan(fake(changes),debt,selection))
  await assert.rejects(buildAdoptionPlan({...fake(),getChainId:async()=>196},debt,selection))
  await assert.rejects(buildAdoptionPlan(fake(),debt,{owner,operator:owner}))
  const client=fake();let first=true
  client.getBlock=async()=>({number:50n,timestamp:100n,hash:first?(first=false,hash):'0x'+'ee'.repeat(32)})
  await assert.rejects(buildAdoptionPlan(client,debt,selection),/block changed/)
})
test('revocation remains available during policy outage and removes exactly the selected authorization',async()=>{
  const client=fake({netlist:'0x00',policyId:hash})
  const v1=await buildRevocationPlan(client,debt,selection)
  assert.deepEqual(decodeFunctionData({abi:SentinelAccountAbi,data:v1.transactions[0].data}),{functionName:'revokeOperator',args:[operator]})
  const v2=await buildRevocationPlan(client,swap,selection)
  const decoded=decodeFunctionData({abi:v2Abi,data:v2.transactions[0].data})
  assert.equal(decoded.functionName,'revokeGrant');assert.equal(decoded.args[0],operator)
  assert.equal(decoded.args[1].toLowerCase(),swap.deployment.target);assert.equal(decoded.args[2],5)
  assert.equal(decoded.args[3].toLowerCase(),swap.allowedAssets[0].address)
  assert.ok(!client.requests.some(r=>r.functionName==='netlist'))
})

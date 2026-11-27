import assert from 'node:assert/strict'
import test from 'node:test'
import {decodeFunctionData, encodeAbiParameters, getAddress, keccak256, parseAbiParameters, stringToHex, zeroAddress} from 'viem'
import {curatedStrategies} from './validate.ts'
import compiledAbi from '../chain-config/expansion/abi/StrategyRegistry.json' with {type:'json'}
import {
  buildStrategyPublication, discoverPublishedStrategies, readPublishedStrategy, registryAbi, verifyStrategyPublication,
} from './registry.ts'

const publications=curatedStrategies()
const creator='0x1111111111111111111111111111111111111111'
const registry='0x2222222222222222222222222222222222222222'
const operator='0x3333333333333333333333333333333333333333'
const seriesId=keccak256(stringToHex('trial'))
const code='0x60006000'
const pin={chainId:1952,address:registry,runtimeCodeHash:keccak256(code),deploymentBlock:100n,confirmations:2}
const key={creator,seriesId,version:1}
const blockHash=n=>keccak256(stringToHex(String(n)))
const txHash=blockHash('publish')
function validRecord(item=publications[0]) {
  const policy=item.template.policy
  return {
    targetChainId:1952n,adapterVersion:keccak256(stringToHex(item.template.deployment.adapter)),
    policyKey:keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint256,bytes32'),[
      getAddress(policy.enforcer),getAddress(policy.processor),BigInt(policy.circuitId),policy.netlistHash])),
    contentHash:item.hash,canonicalJson:stringToHex(item.canonical),
  }
}
function recordWithBytes(raw) {return {...validRecord(),canonicalJson:raw,contentHash:keccak256(raw)}}
function visibleLog(record,overrides={}) {
  const {targetChainId,adapterVersion,policyKey,contentHash}=record
  return {
    address:registry,removed:false,blockHash:blockHash(114n),blockNumber:114n,transactionHash:txHash,logIndex:0,
    args:{...key,targetChainId,adapterVersion,policyKey,contentHash},...overrides,
  }
}
function fake({chain=1952,bytecode=code,records=[validRecord()],latestVersion=1,logs,overrides={}}={}) {
  const calls=[]
  return {
    calls,getChainId:async()=>chain,
    getBlock:async({blockNumber=120n})=>({number:blockNumber,hash:blockHash(blockNumber)}),
    getCode:async request=>{calls.push(request);return bytecode},
    getLogs:async request=>{calls.push(request);return logs??[visibleLog(records[0])]},
    readContract:async request=>{
      calls.push(request)
      if(request.functionName==='latestVersion')return latestVersion
      assert.equal(request.functionName,'readVersion')
      const [owner,series,version]=request.args
      assert.equal(owner,creator)
      assert.equal(series,seriesId)
      const {targetChainId,adapterVersion,policyKey,contentHash,canonicalJson}=records[version-1]
      return [targetChainId,adapterVersion,policyKey,contentHash,canonicalJson]
    },
    ...overrides,
  }
}
const page={fromBlock:100n,toBlock:118n}

test('the SDK exposes exactly the generated callable and event interface, including indexed topics',()=>{
  const parameters=params=>params.map(p=>({name:p.name??'',type:p.type,indexed:p.indexed??false}))
  const surface=abi=>abi.filter(x=>x.type==='function'||x.type==='event').map(x=>({
    type:x.type,name:x.name,mutability:x.stateMutability,anonymous:x.anonymous??false,
    inputs:parameters(x.inputs),outputs:parameters(x.outputs??[]),
  })).sort((a,b)=>a.name.localeCompare(b.name))
  assert.deepEqual(surface(registryAbi),surface(compiledAbi))
})
test('both supported publications use original canonical hashes and only public template fields',()=>{
  for(const item of publications){
    const result=verifyStrategyPublication(validRecord(item))
    assert.deepEqual(result.template,item.template)
    assert.equal(result.hash,item.hash)
    assert.equal(result.canonical,item.canonical)
    assert.equal(result.topics.targetChainId,1952n)
    assert.equal(result.template.agentInstructions,item.template.agentInstructions)
    assert.equal('transactions' in result,false)
  }
})
test('raw hash mismatch rejects before UTF-8, JSON and validator, even if the registered hash is a valid template hash',()=>{
  const record=validRecord()
  assert.throws(()=>verifyStrategyPublication({...record,canonicalJson:'0xff'}),/content hash mismatch/)
  assert.throws(()=>verifyStrategyPublication({...record,canonicalJson:validRecord(publications[1]).canonicalJson}),/content hash mismatch/)
  for(const canonicalJson of ['0xa','0x','0x'+'ff'.repeat(8193)]) {
    assert.throws(()=>verifyStrategyPublication({...record,canonicalJson}),/byte length or encoding/)
  }
})
test('matching hash cannot authorize noncanonical JSON, invalid UTF-8, duplicated keys, unknown profiles or hidden grants',()=>{
  const item=publications[0]
  const raw=item.canonical
  for(const encoded of [stringToHex(raw+' '),stringToHex(JSON.stringify(item.template)),stringToHex(raw.replace('"Debt protection"','"Debt\\u0020protection"'))]){
    assert.throws(()=>verifyStrategyPublication(recordWithBytes(encoded)),/not canonical/)
  }
  const duplicate=raw.replace('"name":','"name":"Debt protection","name":')
  const unknownAdapter={...item.template,deployment:{...item.template.deployment,adapter:'unreviewed-v3'}}
  for(const encoded of ['0xff','0xefbbbf'+stringToHex(raw).slice(2),stringToHex(duplicate),
    stringToHex(JSON.stringify({...item.template,operator})),stringToHex(JSON.stringify(unknownAdapter))]) {
    assert.throws(()=>verifyStrategyPublication(recordWithBytes(encoded)),/UTF-8 or peridot.strategy\/v1 validation/)
  }
})
test('registry labels are recomputed from canonical adapter, target chain and on-chain policy identity',()=>{
  const valid=validRecord()
  for(const change of [{targetChainId:31337n},{adapterVersion:seriesId},{policyKey:seriesId}]) {
    assert.throws(()=>verifyStrategyPublication({...valid,...change}),/topics differ/)
  }
})
test('publisher preview derives transaction labels and content from validated input and checks next immutable version',async()=>{
  const client=fake({latestVersion:0})
  const item=publications[1]
  const request={creator,seriesId,expectedVersion:1,json:JSON.stringify(item.template,null,2)}
  const plan=await buildStrategyPublication(client,pin,request)
  assert.equal(plan.from,creator)
  assert.equal(plan.to,registry)
  assert.equal(plan.value,0n)
  assert.equal(plan.contentHash,item.hash)
  const record=validRecord(item)
  assert.deepEqual(decodeFunctionData({abi:registryAbi,data:plan.data}),{
    functionName:'publish',args:[seriesId,1,1952n,record.adapterVersion,record.policyKey,record.canonicalJson],
  })
  assert.deepEqual(client.calls.at(-1).args,[creator,seriesId])
  assert.ok(client.calls.every(r=>r.address===registry && r.blockNumber===118n))
  await assert.rejects(buildStrategyPublication(client,pin,{...request,expectedVersion:2}),/version differs/)
  await assert.rejects(buildStrategyPublication(client,pin,{...request,creator:zeroAddress}),/creator/)
  await assert.rejects(buildStrategyPublication(client,pin,{...request,json:JSON.stringify({...item.template,operator})}),/Unsupported strategy data/)
})
test('known publication read pins runtime, chain, block before and after fetching and minimum confirmation depth',async()=>{
  const client=fake()
  const result=await readPublishedStrategy(client,pin,key)
  assert.equal(result.hash,publications[0].hash)
  assert.equal(result.blockNumber,118n)
  assert.equal(result.blockHash,blockHash(118n))
  assert.ok(client.calls.every(call=>call.address===registry && call.blockNumber===118n))
  for(const [changed,options,reason] of [
    [{chainId:31337},{},/chain mismatch/],[{runtimeCodeHash:seriesId},{},/runtime code hash/],
    [{address:zeroAddress},{},/deployment pin/],[{deploymentBlock:119n},{},/confirmed deployment range/],
    [{},{blockNumber:119n},/confirmed deployment range/],[{confirmations:0},{},/confirmation depth/],
  ])await assert.rejects(readPublishedStrategy(client,{...pin,...changed},key,options),reason)
  let reads=0
  const reorganized=fake({overrides:{getBlock:async({blockNumber=120n})=>({
    number:blockNumber,hash:blockNumber===118n && ++reads===2?seriesId:blockHash(blockNumber),
  })}})
  await assert.rejects(readPublishedStrategy(reorganized,pin,key),/review block changed/)
})
test('discovery filters one confirmed 100-block page and keeps invalid posts out of adoptable results',async()=>{
  const good=validRecord()
  const bad=recordWithBytes(stringToHex('{"operator":"untrusted"}'))
  const logs=[visibleLog(good),visibleLog(bad,{args:{...visibleLog(bad).args,version:2},logIndex:1})]
  const client=fake({records:[good,bad],logs})
  const result=await discoverPublishedStrategies(client,pin,{...page,targetChainId:1952n,policyKey:good.policyKey})
  assert.equal(result.accepted.length,1)
  assert.equal(result.accepted[0].hash,publications[0].hash)
  assert.equal(result.accepted[0].transactionHash,txHash)
  assert.equal(result.accepted[0].publishedBlock,114n)
  assert.equal(result.rejected.length,1)
  assert.equal(result.rejected[0].version,2)
  assert.match(result.rejected[0].reason,/validation/)
  assert.equal('template' in result.rejected[0],false)
  const getLogs=client.calls.find(r=>'fromBlock' in r)
  assert.equal(getLogs.address,registry)
  assert.deepEqual(getLogs.args,{targetChainId:1952n,adapterVersion:undefined,policyKey:good.policyKey})
  await assert.rejects(discoverPublishedStrategies(client,pin,{fromBlock:100n,toBlock:200n}),/1–100 blocks/)
  await assert.rejects(discoverPublishedStrategies(client,pin,{fromBlock:99n,toBlock:100n}),/1–100 blocks/)
})
test('discovery rejects inconsistent event provenance, filters, state mismatch and unavailable logs',async()=>{
  const record=validRecord()
  for(const [logs,filter,reason] of [
    [[visibleLog(record,{removed:true})],{},/provenance/],
    [[visibleLog(record,{address:creator})],{},/provenance/],
    [[visibleLog(record,{blockHash:seriesId})],{},/block hash mismatch/],
    [[visibleLog(record),visibleLog(record)],{},/Duplicate/],
    [[visibleLog(record)],{policyKey:seriesId},/requested filter/],
    [[visibleLog({...record,contentHash:seriesId})],{},/record disagree/],
  ])await assert.rejects(discoverPublishedStrategies(fake({logs}),pin,{...page,...filter}),reason)
  const failed=fake({overrides:{getLogs:async()=>{throw new Error('history unavailable')}}})
  await assert.rejects(discoverPublishedStrategies(failed,pin,page),/history unavailable/)
})

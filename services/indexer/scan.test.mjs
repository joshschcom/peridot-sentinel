import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { MarketFactoryAbi, IsolatedControllerAbi } from '@peridot/chain-config'
import { mergeEvents, scanGroup, windows } from './scan.mjs'
import { digest, resume } from './refresh.mjs'

const address = n => '0x' + n.toString(16).padStart(40,'0')
const hash = n => '0x' + n.toString(16).padStart(64,'0')
const factory=address(1), controller=address(2), col=address(3), debt=address(4), owner=address(5)
const root={address:factory,contract:'MarketFactory',fromBlock:'100'}
const block = h => ({number:'0x'+h.toString(16),timestamp:'0x2',hash:hash(h),parentHash:hash(BigInt(h)-1n)})
function event(abi,name,emitter,args,idx) {
  const e=abi.find(x=>x.type==='event' && x.name===name)
  const nonIndexed=e.inputs.filter(x=>!x.indexed)
  return {address:emitter, topics:encodeEventTopics({abi,eventName:name,args}), data:encodeAbiParameters(nonIndexed,nonIndexed.map(x=>args[x.name])),
    blockNumber:'0x64',transactionIndex:'0x0',logIndex:'0x'+idx.toString(16),blockHash:hash(100),transactionHash:hash(9),removed:false}
}
const created=event(MarketFactoryAbi,'MarketCreated',factory,{marketId:0n,owner,controller,policyId:hash(9),collateralMarket:col,debtMarket:debt},3)
const allowed=event(IsolatedControllerAbi,'PolicyAllowed',controller,{policyId:hash(9),account:owner,op:2,postLtvBps:5000n,oracleFresh:true,cashOk:true},1)
function backend(rows) {
  return async(method,params)=>{
    if(method==='eth_getBlockByNumber') return block(BigInt(params[0]))
    const [query]=params
    return rows.filter(r=>query.address.includes(r.address) && BigInt(r.blockNumber)>=BigInt(query.fromBlock) && BigInt(r.blockNumber)<=BigInt(query.toBlock))
  }
}

test('pages are inclusive, bounded and contiguous',()=>{
  assert.deepEqual(windows(7n,207n),[[7n,106n],[107n,206n],[207n,207n]])
})
test('same-transaction constructor events on verified children and their integer units survive discovery',async()=>{
  const data=await scanGroup(backend([allowed,created,{...allowed,address:address(7)}]),[root],100n,201n,null)
  assert.deepEqual(data.events.map(e=>e.eventName),['PolicyAllowed','MarketCreated'])
  assert.equal(data.events[0].args.op,'2')
  assert.equal(data.events[0].args.postLtvBps,'5000')
  assert.equal(data.sources.length,4)
})
test('identical canonical events deduplicate by transaction hash and log index',async()=>{
  const {events}=await scanGroup(backend([created,created]),[root],100n,100n,null)
  assert.equal(events.length,1)
  assert.equal(mergeEvents(events,events).length,1)
  assert.throws(()=>mergeEvents(events,[{...events[0],blockHash:hash(7)}]),/Conflicting log/)
})
test('removed, conflicting and noncanonical events stop coverage advancement',async()=>{
  for (const rows of [[{...created,removed:true}],[created,{...created,transactionHash:hash(8)}],[{...created,blockHash:hash(7)}]]) {
    await assert.rejects(scanGroup(backend(rows),[root],100n,100n,null))
  }
})
test('checkpoint mismatch rebuilds; stale head cannot shorten a valid snapshot',async()=>{
  const s={schemaVersion:1,kind:'indexed-event-snapshot',chainId:1952,scopeDigest:'v1',sources:[],coverage:{fromBlock:'100',toBlock:'101',toBlockHash:hash(101)}}
  const cfg={scopeDigest:'v1',first:100n}
  assert.equal(await resume(s,cfg,120n,backend([])),s)
  assert.equal(await resume(s,{...cfg,scopeDigest:'v2'},120n,backend([])),null)
  assert.equal(await resume({...s,coverage:{...s.coverage,toBlockHash:hash(8)}},cfg,120n,backend([])),null)
  await assert.rejects(resume(s,cfg,100n,backend([])),/behind/)
})

test('requires parent hash ancestry at saved checkpoint',async()=>{
  const fetch=backend([])
  const split=async(m,p)=>m==='eth_getBlockByNumber' && p[0]==='0x64'?{...block(100),parentHash:hash(8)}:fetch(m,p)
  await assert.rejects(scanGroup(split,[root],100n,100n,hash(99)),/descend/)
})

test('new roots preserve the common prefix and replay all overlapping blocks',async()=>{
  const abi={MarketFactory:[],SentinelAccountFactoryV2:[]}
  const extra={address:address(8),contract:'SentinelAccountFactoryV2',fromBlock:'110'}
  const prior={schemaVersion:1,kind:'indexed-event-snapshot',chainId:1952,scopeDigest:digest([root],abi),
    coverage:{fromBlock:'100',toBlock:'109',toBlockHash:hash(109)},sources:[root],events:[{blockNumber:'100'}]}
  const config={first:100n,roots:[root,extra],abiEvents:abi,scopeDigest:digest([root,extra],abi)}
  assert.deepEqual((await resume(prior,config,130n,backend([]))).sources,[root,extra])
  const overlap={...prior,coverage:{...prior.coverage,toBlock:'120',toBlockHash:hash(120)},
    events:[...prior.events,{blockNumber:'110'}],sources:[...prior.sources,{...extra,contract:'MarketFactory',fromBlock:'110'}]}
  const rewound=await resume(overlap,config,130n,backend([]))
  assert.deepEqual(rewound.coverage,prior.coverage)
  assert.deepEqual(rewound.sources,[root,extra])
  assert.deepEqual(rewound.events,prior.events)
  assert.equal(await resume(prior,{...config,abiEvents:{...abi,MarketFactory:[{changed:true}]}},130n,backend([])),null)
})

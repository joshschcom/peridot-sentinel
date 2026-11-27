import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {encodeEventTopics,encodeAbiParameters} from 'viem'
import {IsolatedControllerAbi} from '@peridot/chain-config'
import {HistoryUnavailable} from './history.mjs'
import {outputOptions,writeSnapshot} from './output.mjs'
import {refreshShared,reader} from './refresh.mjs'
import {refresh as refreshJudge} from '../judge-activity/refresh.mjs'

const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0')
const hex=n=>'0x'+BigInt(n).toString(16)
const stamp=1795770000
const clock=()=>stamp*1000
const judgeManifest=JSON.parse(readFileSync(new URL('../../deployments/session7/1952/judge-01/manifest.json',import.meta.url)))
const emitter=judgeManifest.markets.A.controller
const root={address:emitter,contract:'IsolatedController',fromBlock:'100'}
const config={first:100n,roots:[root],scopeDigest:'synthetic-session9',
  metadata:{schemaVersion:1,kind:'indexed-event-snapshot',chainId:1952}}
const abiEvent=IsolatedControllerAbi.find(i=>i.type==='event' && i.name==='PolicyAllowed')
function log(n) {
  const args={policyId:h(1000),account:judgeManifest.owner,op:2,postLtvBps:3000n,oracleFresh:true,cashOk:true}
  const values=abiEvent.inputs.filter(i=>!i.indexed)
  return {address:emitter,topics:encodeEventTopics({abi:[abiEvent],args}),data:encodeAbiParameters(values,values.map(i=>args[i.name])),
    blockNumber:hex(n),blockHash:h(n),transactionHash:h(1000n+n),transactionIndex:'0x0',logIndex:'0x0',removed:false}
}

// Inject explicit pruning, silent loss, reorgs and transport errors into a real log scan.
// Receipt material and getLogs have independent paths so the anchor proof can disagree.
function rpc(state, options={}) {
  return async(method,params)=>{
    if (method==='eth_chainId') return '0x7a0'
    if (method==='eth_getBlockByNumber') {
      const n=params[0]==='latest'?state.head:BigInt(params[0])
      if (options.prunedHeader===n) throw new HistoryUnavailable('synthetic header pruned')
      if (options.transport===n) throw Error('HTTP 429')
      return {number:hex(n),hash:h(n+(options.conflict===n?10n:0n)),parentHash:h(n-1n),timestamp:hex(stamp),
        transactions:state.events.has(n)?[h(n+1000n)]:[]}
    }
    if (method==='eth_getTransactionReceipt') {
      const n=BigInt(params[0])-1000n
      if (options.missingReceipt===n) return null
      return {transactionHash:h(1000n+n),transactionIndex:'0x0',blockNumber:hex(n),blockHash:h(n),logs:[log(n)]}
    }
    assert.equal(method,'eth_getLogs')
    const q=params[0],lo=BigInt(q.fromBlock),hi=BigInt(q.toBlock)
    if (options.prunedLogs>=lo && options.prunedLogs<=hi) throw new HistoryUnavailable('synthetic historical log index pruned')
    return [...state.events].filter(n=>lo<=n && n<=hi && n!==options.omit && q.address.includes(emitter)).map(log)
  }
}

async function fixture(t,scope) {
  const dir=mkdtempSync(join(tmpdir(),'peridot-activity-test-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const canonical=join(dir,'activity.json'),out=join(dir,'candidate.json')
  const state={head:113n,events:new Set([100n,120n,124n])}
  const p={mode:'testnet',m:{...judgeManifest,deploymentBlock:'100'},campaign:judgeManifest.campaign,dir}
  const deps={input:canonical,config,clock,verifyBindings:async()=>{}}
  async function run(optionsA={},optionsB=optionsA) {
    deps.clients=[rpc(state,optionsA),rpc(state,optionsB)]
    if(scope==='shared') return refreshShared({output:out},deps)
    return refreshJudge(p,{output:out},deps)
  }
  await run()
  const old=readFileSync(out)
  writeFileSync(canonical,old)
  state.head=132n
  return {state,out,canonical,old,run,get:()=>JSON.parse(readFileSync(out)),published:()=>JSON.parse(readFileSync(canonical))}
}

for (const scope of ['shared','judge']) {
  test(scope+' retains every prior row and anchors a confirmed segment when checkpoint header is pruned',async t=>{
    const f=await fixture(t,scope)
    const {coverage}=await f.run({prunedHeader:101n})
    const prior=f.published()
    const r=f.get()
    assert.deepEqual(readFileSync(f.canonical),f.old)
    assert.deepEqual(r.events.slice(0,prior.events.length),prior.events)
    assert.deepEqual(coverage.segments[0],prior.coverage.segments[0])
    assert.deepEqual(coverage.segments[1],{fromBlock:'120',toBlock:'120',fromBlockHash:h(120),toBlockHash:h(120),
      sourceCoverage:scope==='shared'?'known-emitters':'configured'})
    assert.deepEqual(coverage.gaps,[{fromBlock:'102',toBlock:'119',reason:'history-unavailable'},
      {fromBlock:'121',toBlock:'132',reason:'confirmation-depth'}])
    assert.equal(r.events.at(-1).blockHash,h(120))
    assert.equal(r.events.at(-1).transactionHash,h(1120))
    if (process.env.ACTIVITY_FIXTURE_DIR) {
      await writeSnapshot(f.canonical,{output:join(process.env.ACTIVITY_FIXTURE_DIR,'pruned-'+scope+'.json')},
        async()=>({...r,fixture:'SYNTHETIC pruning RPC demonstration; all heights, hashes, receipts and operations in this file are simulated'}))
    }
    writeFileSync(f.canonical,readFileSync(f.out))
    f.state.head=136n
    await f.run({prunedHeader:101n})
    const after=f.get()
    assert.deepEqual(after.coverage.gaps[0],coverage.gaps[0])
    assert.deepEqual(after.events.slice(0,2),r.events)
    assert.equal(after.coverage.segments.length,2)
    assert.equal(after.coverage.segments[1].toBlock,'124')
  })
  test(scope+' classifies both explicit missing logs and omitted previously recorded events',async t=>{
    const f=await fixture(t,scope)
    // Exercise upgrade from the legacy unsegmented version 1 file.
    const legacy=f.published()
    delete legacy.coverage.segments
    writeFileSync(f.canonical,JSON.stringify(legacy))
    for(const faults of [{prunedLogs:101n},{prunedLogs:105n},{omit:100n}]) {
      await f.run(faults)
      assert.equal(f.get().coverage.gaps[0].reason,'history-unavailable')
      assert.deepEqual(f.get().events[0],legacy.events[0])
    }
  })
  test(scope+' refuses an incomplete anchor, contradictions, generic outages and an empty gap',async t=>{
    const f=await fixture(t,scope)
    for(const [primary,peer] of [
      [{prunedHeader:101n,missingReceipt:120n},undefined],
      [{prunedHeader:101n,omit:120n},undefined],
      [{prunedHeader:101n},{conflict:101n}],
      [{transport:101n},undefined],
      [{omit:120n},{}],
    ]) {
      await assert.rejects(f.run(primary,peer))
      assert.deepEqual(readFileSync(f.out),f.old)
      assert.deepEqual(readFileSync(f.canonical),f.old)
    }
    f.state.head=114n
    await assert.rejects(f.run({prunedHeader:101n}),/nonempty history gap/)
    assert.deepEqual(readFileSync(f.out),f.old)
  })
  test(scope+' preserves evidence when the trusted source scope changes incompatibly',async t=>{
    const f=await fixture(t,scope)
    const previous=f.published()
    previous.scopeDigest='unsupported-future-or-foreign-abi'
    writeFileSync(f.canonical,JSON.stringify(previous))
    await assert.rejects(f.run(),/Incompatible source scope/)
    assert.deepEqual(readFileSync(f.out),f.old)
    assert.deepEqual(f.published(),previous)
  })
  test(scope+' accepts matching empty recent results and refuses incomplete bootstrap',async t=>{
    const f=await fixture(t,scope)
    f.state.events.delete(120n)
    await f.run({prunedHeader:101n})
    assert.deepEqual(f.get().events,f.published().events)
    rmSync(f.canonical)
    rmSync(f.out)
    await assert.rejects(f.run({prunedLogs:100n}))
    assert(!existsSync(f.out))
  })
}

test('malformed segment boundaries and anchor hashes cannot replace the saved candidate',async t=>{
  const f=await fixture(t,'shared')
  const baseline=f.published()
  const original=baseline.coverage.segments[0]
  const adjacent=[{...original,toBlock:'100',toBlockHash:h(100)},{...original,fromBlock:'101',fromBlockHash:h(101)}]
  const gap={fromBlock:'101',toBlock:'101',reason:'history-unavailable'}
  const first={...original,toBlock:'100',toBlockHash:h(100)}
  const anchor={fromBlock:'102',toBlock:'102',toBlockHash:h(102),sourceCoverage:'known-emitters'}
  for (const [segments,gaps] of [
    [adjacent,[]],
    [[{...original,fromBlockHash:'0xbad'}],[]],
    [[first,anchor],[gap]],
    [[first,{...anchor,fromBlockHash:'0xbad'}],[gap]],
  ]) {
    const malformed=structuredClone(baseline)
    Object.assign(malformed.coverage,{segments,gaps,toBlock:segments.at(-1).toBlock,toBlockHash:segments.at(-1).toBlockHash})
    writeFileSync(f.canonical,JSON.stringify(malformed))
    await assert.rejects(f.run(),/gap|anchor hash/i)
    assert.deepEqual(readFileSync(f.out),f.old)
    assert.deepEqual(f.published(),malformed)
  }
})

test('explicit output selection prevents accidental replacement of protected data',async()=>{
  for(const args of [[],['--output='],['--publish','--output=x'],['--output=x','--output=y']]) {
    assert.throws(()=>outputOptions(args))
  }
  for(const path of ['packages/chain-config/activity/1952.json','deployments/session7/1952/judge-01/activity.json',
    'packages/chain-config/expansion/tapeout-196.json']) {
    await assert.rejects(writeSnapshot(path,{output:path},()=>assert.fail('would have written')),/separate candidate/)
  }
})

test('pruning classification retries historical RPC errors and keeps transport errors distinct',async t=>{
  const original=globalThis.fetch
  t.after(()=>{globalThis.fetch=original})
  let replies=0, fault='pruned'
  globalThis.fetch=async (_url,request)=>{
    replies++
    const id=JSON.parse(request.body).id
    if (fault==='rate-limited') return new Response('',{status:429})
    return Response.json({jsonrpc:'2.0',id,...(fault==='pruned'?{error:{code:-32000,message:'historical logs pruned'}}:{result:null})})
  }
  const client=reader('https://synthetic.invalid')
  await assert.rejects(client('eth_getLogs',[{}]),HistoryUnavailable)
  assert.equal(replies,4)
  fault='missing-block'
  await assert.rejects(client('eth_getBlockByNumber',['0xa',false]),HistoryUnavailable)
  fault='rate-limited'
  await assert.rejects(client('eth_getLogs',[{}]),e=>!(e instanceof HistoryUnavailable) && /429/.test(e.message))
})

test('shared CLI loads judge dispatch and rejects a bad campaign before any RPC',()=>{
  const proc=spawnSync(process.execPath,['services/indexer/refresh.mjs','--judge=../invalid','--output=evidence/session9-activity/unused.json'],{encoding:'utf8'})
  assert.equal(proc.status,1)
  assert.match(proc.stderr,/Invalid campaign name/)
})

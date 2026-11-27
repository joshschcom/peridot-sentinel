// Shared segmented refresh for the app and judge snapshots. All heights are inclusive.
import assert from 'node:assert/strict'
import {GROUP, header, mergeEvents, scanGroup} from './scan.mjs'

export class HistoryUnavailable extends Error {}

// Settle all witnesses: a pruned peer cannot conceal a conflicting hash on another peer.
async function witnesses(clients, read) {
  const results = await Promise.allSettled(clients.map(read))
  const failure = results.find(r => r.status === 'rejected' && !(r.reason instanceof HistoryUnavailable))
  if (failure) throw failure.reason
  const missing = results.find(r => r.status === 'rejected')
  if (missing) throw missing.reason
  const [first, ...rest] = results.map(r => r.value)
  for (const result of rest) assert.deepEqual(result, first, 'RPC witnesses disagree')
  return first
}

function segmentsOf(snapshot, first) {
  if (!snapshot) return []
  const {coverage} = snapshot
  const segments = coverage.segments ?? [{
    fromBlock: coverage.fromBlock, toBlock: coverage.toBlock, toBlockHash: coverage.toBlockHash, sourceCoverage: 'configured'
  }]
  assert(Array.isArray(segments) && segments.length, 'Missing verified segments')
  const hashPattern = /^0x[0-9a-f]{64}$/i
  const gaps = []
  let end = first - 1n
  for (const [index, segment] of segments.entries()) {
    const from = BigInt(segment.fromBlock), to = BigInt(segment.toBlock)
    assert(from > end && to >= from && hashPattern.test(segment.toBlockHash), 'Invalid verified segment')
    assert(['configured','known-emitters'].includes(segment.sourceCoverage), 'Unknown emitter scope')
    if (index > 0 || segment.fromBlockHash !== undefined) {
      assert(typeof segment.fromBlockHash === 'string' && hashPattern.test(segment.fromBlockHash), 'Invalid segment anchor hash')
    }
    if (index === 0) {
      assert.equal(from,first)
    } else {
      assert(from > end+1n, 'Independent segments require a nonempty history gap')
      gaps.push({fromBlock:String(end+1n), toBlock:String(from-1n), reason:'history-unavailable'})
    }
    end = to
  }
  assert.equal(end,BigInt(coverage.toBlock))
  assert.equal(segments.at(-1).toBlockHash,coverage.toBlockHash)
  assert.deepEqual(gaps,coverage.gaps.filter(g=>BigInt(g.fromBlock)<=end),'Historical gaps do not match segments')
  return segments.map(s=>({...s}))
}

// Verify a recovery anchor independently of getLogs. Two endpoints silently returning []
// can be wrong: use the complete transaction list and each mined receipt for this block.
async function anchorGroup(rpc, sources, height, expectedHash) {
  const hex = '0x'+height.toString(16)
  const block = await rpc('eth_getBlockByNumber',[hex,false])
  assert(block && BigInt(block.number)===height && block.hash===expectedHash && Array.isArray(block.transactions),'Invalid anchor block')
  const logs = []
  const seen = new Set()
  for (const [index,hash] of block.transactions.entries()) {
    assert(/^0x[0-9a-f]{64}$/i.test(hash) && !seen.has(hash),'Invalid anchor transaction list')
    seen.add(hash)
    const receipt=await rpc('eth_getTransactionReceipt',[hash])
    assert(receipt && receipt.transactionHash===hash && receipt.blockHash===expectedHash &&
      BigInt(receipt.blockNumber)===height && BigInt(receipt.transactionIndex)===BigInt(index) &&
      Array.isArray(receipt.logs),'Missing or inconsistent anchor receipt')
    for (const log of receipt.logs) {
      assert(log.blockHash===expectedHash && BigInt(log.blockNumber)===height && log.transactionHash===hash &&
        BigInt(log.transactionIndex)===BigInt(index) && !log.removed,'Invalid anchor receipt log')
      logs.push(log)
    }
  }
  const fromReceipts=(method,params)=>method==='eth_getLogs'
    ? logs.filter(row=>params[0].address.some(a=>a.toLowerCase()===row.address.toLowerCase()))
    : rpc(method,params)
  const actual=await scanGroup(rpc,sources,height,height,null)
  assert.deepEqual(actual,await scanGroup(fromReceipts,sources,height,height,null),'Anchor logs disagree with receipts')
  assert.equal(actual.toBlockHash,expectedHash)
  return {group:actual,transactions:block.transactions}
}

export function retainEvents(previous, candidate) {
  const all=mergeEvents(candidate.events,previous.events)
  assert.deepEqual(all,candidate.events,'Earlier verified events missing from candidate')
}

async function checkRecordedBlock(rpc, previous, height, hash) {
  const block = await header(rpc,height)
  assert.equal(block.hash,hash,'Checkpoint hash conflict; retain evidence and investigate')
  const expected = previous.events.filter(e=>BigInt(e.blockNumber)===height)
  for (let attempt=0; attempt<2; attempt++) {
    const replay=await scanGroup(rpc,previous.sources,height,height,null)
    assert.equal(replay.toBlockHash,hash,'Recorded block changed during log check')
    // Missing rows on an otherwise matching block can mean a pruned log index.
    // Changed/additional rows or altered fields are contradictions and require review.
    const combined=mergeEvents(expected,replay.events)
    assert.deepEqual(combined,expected,'Unexpected historical event at an already verified height')
    if (replay.events.length===expected.length) return block
    if (!attempt) await new Promise(resolve=>setTimeout(resolve,150))
  }
  throw new HistoryUnavailable('RPC omitted previously recorded logs at '+String(height))
}

// One atomic candidate per invocation. Do not persist provisional scope replays or partial anchors.
export async function advance({previous, config, clients, depth=12, dynamic=false, clock=Date.now, prepare}) {
  const {first,metadata,roots,scopeDigest}=config
  assert(clients.length>=1 && (depth===0 || clients.length>=2),'Independent public witnesses required')
  for (const rpc of clients) assert.equal(BigInt(await rpc('eth_chainId',[])),1952n)
  const tips=await Promise.all(clients.map(rpc=>header(rpc,'latest')))
  if (depth>0) assert(tips.every(t=>Math.abs(clock()/1000-Number(t.timestamp))<180),'RPC head is stale')
  const head=tips.reduce((h,b)=>b.number<h?b.number:h,tips[0].number)
  const safe=head-BigInt(depth)
  assert(safe>=first,'Target behind deployment')
  const target=await witnesses(clients,rpc=>header(rpc,safe))
  let snapshot=previous
  let recover=false
  if (previous) {
    for (const [k,v] of Object.entries(metadata)) assert.equal(previous[k],v,'Unexpected snapshot '+k)
    assert.equal(BigInt(previous.coverage.fromBlock),first)
    const oldEnd=BigInt(previous.coverage.toBlock)
    assert(oldEnd<=safe,'RPC tip behind saved checkpoint')
    segmentsOf(previous,first)
    try {
      await witnesses(clients,async rpc=>{
        const b=await checkRecordedBlock(rpc,previous,oldEnd,previous.coverage.toBlockHash)
        const last=previous.events.at(-1)
        const start=BigInt(previous.coverage.segments?.at(-1)?.fromBlock ?? first)
        if (last && BigInt(last.blockNumber)>=start && BigInt(last.blockNumber)<oldEnd) {
          await checkRecordedBlock(rpc,previous,BigInt(last.blockNumber),last.blockHash)
        }
        return b
      })
      if (prepare) snapshot=await witnesses(clients,async rpc=>{
        const compatible=await prepare(previous,config,safe,rpc)
        assert(compatible,'Incompatible source scope or conflicting checkpoint')
        return compatible
      })
      else assert.equal(previous.scopeDigest,scopeDigest,'Incompatible source scope')
    } catch (e) {
      if (!(e instanceof HistoryUnavailable) || previous.scopeDigest!==scopeDigest) throw e
      recover=true
    }
  }
  let segments=segmentsOf(previous,first)
  let gaps=previous?.coverage.gaps.filter(g=>g.reason==='history-unavailable')??[]
  if (snapshot && previous && snapshot.coverage.toBlock!==previous.coverage.toBlock) {
    assert(segments.length===1,'Overlapping scope replay with a prior gap requires archive review')
    segments=[{...segments[0],toBlock:snapshot.coverage.toBlock,toBlockHash:snapshot.coverage.toBlockHash}]
  }
  let end=snapshot?BigInt(snapshot.coverage.toBlock):first-1n
  let priorHash=snapshot?.coverage.toBlockHash??null
  let sources=snapshot?.sources??roots
  let events=snapshot?.events??[]
  // Only an established checkpoint with unchanged scope can authorize a discontinuous append.
  const canRecover=previous && previous.scopeDigest===scopeDigest
  while (end<safe || recover) {
    const from=end+1n,to=from+GROUP-1n<safe?from+GROUP-1n:safe
    let group
    if (!recover) {
      try {
        group=await witnesses(clients,rpc=>scanGroup(rpc,sources,from,to,priorHash))
      } catch (e) {
        if (!(e instanceof HistoryUnavailable) || !canRecover) throw e
        recover=true
      }
    }
    if (recover) {
      assert(canRecover && safe>from,'No independently confirmed anchor beyond a nonempty history gap')
      const anchor=await witnesses(clients,rpc=>anchorGroup(rpc,sources,safe,target.hash))
      group=anchor.group
      gaps=[...gaps,{fromBlock:String(from),toBlock:String(safe-1n),reason:'history-unavailable'}]
      segments.push({fromBlock:String(safe),fromBlockHash:target.hash,toBlock:String(safe),toBlockHash:target.hash,
        sourceCoverage:dynamic?'known-emitters':'configured'})
      end=safe
      recover=false
    } else {
      const last=segments.at(-1)??{fromBlock:String(first),sourceCoverage:'configured'}
      const extended={...last,toBlock:String(to),toBlockHash:group.toBlockHash}
      if (segments.length) segments[segments.length-1]=extended
      else segments.push(extended)
      end=to
    }
    priorHash=group.toBlockHash
    sources=group.sources
    events=mergeEvents(events,group.events)
  }
  assert.equal(priorHash,target.hash,'Pinned target changed')
  assert.deepEqual(await witnesses(clients,rpc=>header(rpc,safe)),target,'Target changed during refresh')
  const candidate={...metadata,scopeDigest,updatedAt:new Date(clock()).toISOString(),coverage:{
    fromBlock:String(first),toBlock:String(safe),toBlockHash:priorHash,headAtRefresh:String(head),confirmations:depth,
    ...(dynamic?{status:'caught-up'}:{}),segments,gaps:[...gaps,...(depth?[{fromBlock:String(safe+1n),toBlock:String(head),reason:'confirmation-depth'}]:[])]
  },sources,events}
  if (previous) retainEvents(previous,candidate)
  return candidate
}

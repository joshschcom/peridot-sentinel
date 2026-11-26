import assert from 'node:assert/strict'
import { decodeEventLog, getAddress, toEventSelector } from 'viem'
import * as v1 from '@peridot/chain-config'
import { existsSync, readFileSync } from 'node:fs'

const abiFile = name => new URL('../../packages/chain-config/expansion/abi/' + name + '.json', import.meta.url)
const v2Abi = name => JSON.parse(readFileSync(abiFile(name)))
const namesV1 = ['MarketFactory', 'SentinelAccountFactory', 'PolicyRegistry', 'DevelopmentReferenceProcessor',
  'TestnetOracle', 'IsolatedController', 'MarketPToken', 'SentinelAccount']
const namesV2 = ['SentinelAccountFactoryV2', 'SentinelAccountV2', 'SinglePoolSwapAdapter']
export const catalog = Object.fromEntries([
  ...namesV1.map(name => [name, v1[name + 'Abi']]),
  ...namesV2.map(name => [name, v2Abi(name)]),
  ...['VaultSentinelAccountFactoryV2','VaultSentinelAccountV2','TestnetSavingsVault']
    .filter(name=>existsSync(abiFile(name))).map(name=>[name,v2Abi(name)]),
].map(([name,abi]) => [name, new Map(abi.filter(x => x.type === 'event').map(e => [toEventSelector(e),e]))]))

const hash = /^0x[0-9a-fA-F]{64}$/
const dec = n => String(BigInt(n))
const hex = n => '0x' + n.toString(16)
const min = (a,b) => a < b ? a : b
export const PAGE = 100n
export const GROUP = 2400n

export function windows(from, to) {
  const result = []
  for (let i = from; i <= to; i += PAGE) result.push([i, min(i+PAGE-1n,to)])
  return result
}

function normalize(v) {
  if (typeof v === 'bigint' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]))
  return v
}

function decode(row, source) {
  const event = catalog[source.contract].get(row.topics[0])
  if (!event) return null
  const {eventName,args} = decodeEventLog({abi:[event], topics:row.topics, data:row.data, strict:true})
  return {blockNumber:dec(row.blockNumber), blockHash:row.blockHash, transactionHash:row.transactionHash,
    transactionIndex:dec(row.transactionIndex), logIndex:dec(row.logIndex), address:source.address,
    contract:source.contract, eventName, args:normalize(args)}
}

function byLog(a,b) {
  const diff = BigInt(a.blockNumber)-BigInt(b.blockNumber) || BigInt(a.logIndex)-BigInt(b.logIndex)
  return diff < 0n ? -1 : diff > 0n ? 1 : 0
}

export function mergeEvents(existing, incoming) {
  const indexed = new Map()
  for (const event of [...existing,...incoming]) {
    const key = event.transactionHash.toLowerCase()+':'+event.logIndex
    const previous = indexed.get(key)
    if (previous) assert.deepEqual(previous,event,'Conflicting log at the same transaction hash and log index')
    else indexed.set(key,event)
  }
  const sorted = [...indexed.values()].sort(byLog)
  for (let i=1;i<sorted.length;i++) {
    assert(byLog(sorted[i-1],sorted[i])!==0,'Conflicting log position')
  }
  return sorted
}

export function addSource(sources, address, contract, block) {
  const key = getAddress(address).toLowerCase()
  assert(key !== '0x'+'0'.repeat(40), 'Zero source address')
  const old = sources.get(key)
  if (old) {
    assert(old.contract === contract && old.fromBlock === dec(block), 'Conflicting emitter identity: ' + address)
    return false
  }
  sources.set(key,{address:getAddress(address),contract,fromBlock:dec(block)})
  return true
}

function discover(sources, event) {
  const {contract, eventName, args, blockNumber} = event
  if (contract === 'MarketFactory' && eventName === 'MarketCreated') {
    addSource(sources,args.controller,'IsolatedController',blockNumber)
    addSource(sources,args.collateralMarket,'MarketPToken',blockNumber)
    addSource(sources,args.debtMarket,'MarketPToken',blockNumber)
  }
  if (contract === 'SentinelAccountFactory' && eventName === 'AccountCreated') {
    addSource(sources,args.account,'SentinelAccount',blockNumber)
  }
  if (contract === 'VaultSentinelAccountFactoryV2' && eventName === 'AccountCreated') {
    addSource(sources,args.account,'VaultSentinelAccountV2',blockNumber)
  }
  if (contract === 'SentinelAccountFactoryV2' && eventName === 'AccountCreated') {
    addSource(sources,args.account,'SentinelAccountV2',blockNumber)
  }
}

async function mapLimited(list, fn) {
  const slots = new Array(list.length)
  let cursor = 0
  await Promise.all(Array.from({length:Math.min(6,list.length)}, async () => {
    while (cursor < list.length) {
      const i = cursor++
      slots[i] = await fn(list[i])
    }
  }))
  return slots
}

async function fetchRows(rpc, from, to, sources) {
  const jobs = []
  for (const [lo,hi] of windows(from,to)) {
    const active = sources.filter(s => BigInt(s.fromBlock) <= hi)
    for (let i = 0; i < active.length; i += 20) jobs.push({lo,hi,group:active.slice(i,i+20)})
  }
  const batches = await mapLimited(jobs, async ({lo,hi,group}) => {
    const addresses = group.map(s => s.address)
    const allowed = new Map(group.map(s => [s.address.toLowerCase(),s]))
    const rows = await rpc('eth_getLogs',[{fromBlock:hex(lo),toBlock:hex(hi),address:addresses}])
    assert(Array.isArray(rows),'RPC did not return a complete array')
    return rows.flatMap(row => {
      const source = allowed.get(row.address.toLowerCase())
      assert(source && !row.removed && hash.test(row.blockHash) && hash.test(row.transactionHash),
        'Malformed, removed or unrequested log')
      const block = BigInt(row.blockNumber)
      assert(block >= lo && block <= hi && block >= BigInt(source.fromBlock),'Out-of-range event')
      const decoded = decode(row,source)
      return decoded ? [decoded] : []
    })
  })
  return batches.flat()
}

export async function header(rpc,height) {
  const b = await rpc('eth_getBlockByNumber',[height==='latest'?'latest':hex(height),false])
  assert(b && hash.test(b.hash) && (height==='latest' || BigInt(b.number)===height),'Missing or wrong RPC block')
  return {number:BigInt(b.number), hash:b.hash, parentHash:b.parentHash, timestamp:dec(b.timestamp)}
}

// Discover children only through manifest-bound factory emitters. Their constructors can
// emit logs earlier in the creation transaction, so query their entire creation block.
export async function scanGroup(rpc, previousSources, from, to, previousHash) {
  assert(to >= from && to-from < GROUP)
  const startTip = await header(rpc,to)
  if (previousHash !== null) {
    const [prior,first] = await Promise.all([header(rpc,from-1n),header(rpc,from)])
    assert.equal(prior.hash,previousHash,'Previous checkpoint changed')
    assert.equal(first.parentHash,previousHash,'First new block does not descend from the saved checkpoint')
  }
  const sources = new Map(previousSources.map(s=>[s.address.toLowerCase(),s]))
  const primary = await fetchRows(rpc,from,to,previousSources)
  for (const event of primary) discover(sources,event)
  const original = new Set(previousSources.map(s=>s.address.toLowerCase()))
  const children = [...sources].filter(([key])=>!original.has(key)).map(([,s])=>s)
  const events = mergeEvents(primary,await fetchRows(rpc,from,to,children))
  const heights = [...new Set(events.map(e=>e.blockNumber))]
  const blocks = new Map(await mapLimited(heights,async h=>[h,await header(rpc,BigInt(h))]))
  for (const event of events) {
    const block = blocks.get(event.blockNumber)
    assert.equal(event.blockHash,block.hash,'Log does not match canonical block')
    event.timestamp = block.timestamp
  }
  assert.equal((await header(rpc,to)).hash,startTip.hash,'Range changed during scan')
  return {sources:[...sources.values()],events,toBlockHash:startTip.hash}
}

// Separate historical activity for a judge campaign. Never overwrites the M4/public app snapshot.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { addSource, header, mergeEvents, scanGroup, GROUP } from '../indexer/scan.mjs'
import { reader } from '../indexer/refresh.mjs'
import { openProfile, checkBindings, observation } from '../judge-connect/profile.mjs'
import { writeJson } from '../../contracts/expansion/script/session6-transactions.mjs'

export function judgeSources(m) {
  const sources = new Map()
  const add = (address, name) => addSource(sources, address, name, m.deploymentBlock)
  for (const market of Object.values(m.markets)) {
    add(market.controller, 'IsolatedController')
    add(market.collateralMarket, 'MarketPToken')
    add(market.debtMarket, 'MarketPToken')
    add(market.account, 'SentinelAccount')
  }
  add(m.contracts.account, 'SentinelAccountV2')
  add(m.contracts.swap, 'SinglePoolSwapAdapter')
  return [...sources.values()]
}

export async function refresh(p) {
  await observation(p, ctx => checkBindings(p, ctx))
  const first = BigInt(p.m.deploymentBlock)
  const snapshotPath = resolve(p.dir, 'activity.json')
  const readers = p.urls.map(reader)
  const heads = await Promise.all(readers.map(rpc => header(rpc, 'latest')))
  const head = heads.reduce((n, b) => b.number < n ? b.number : n, heads[0].number)
  const depth = p.mode === 'fork' ? 0n : 12n
  const safe = head - depth
  assert(safe >= first, 'Waiting for the first confirmed campaign block')
  const sources = judgeSources(p.m)
  const scope = createHash('sha256').update(JSON.stringify({campaign: p.campaign, sources})).digest('hex')
  const agreed = async block => {
    const results = await Promise.all(readers.map(rpc => header(rpc, block)))
    assert(results.every(b => b.hash === results[0].hash), 'RPC witnesses disagree')
    return results[0]
  }
  const end = await agreed(safe)
  let previous = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : null
  if (previous && previous.scopeDigest === scope) {
    assert(safe >= BigInt(previous.coverage.toBlock), 'RPC head behind the checkpoint')
    if ((await agreed(BigInt(previous.coverage.toBlock))).hash !== previous.coverage.toBlockHash) previous = null
  } else previous = null
  let from = previous ? BigInt(previous.coverage.toBlock) + 1n : first
  let prior = previous?.coverage.toBlockHash ?? null
  let events = previous?.events ?? []
  while (from <= safe) {
    const to = from + GROUP - 1n < safe ? from + GROUP - 1n : safe
    const groups = await Promise.all(readers.map(rpc => scanGroup(rpc, sources, from, to, prior)))
    for (const group of groups) assert.deepEqual(group, groups[0], 'RPC disagreement on decoded campaign events')
    if (to === safe) assert.equal(groups[0].toBlockHash, end.hash)
    events = mergeEvents(events, groups[0].events)
    prior = groups[0].toBlockHash
    previous = {schemaVersion: 1, kind: 'judge-event-snapshot', scopeDigest: scope, chainId: 1952, campaign: p.campaign, profile: p.m.profile,
      updatedAt: new Date().toISOString(), coverage: {fromBlock: String(first), toBlock: String(to), toBlockHash: prior,
        headAtRefresh: String(head), confirmations: Number(depth), gaps: [
          ...(to < safe ? [{fromBlock: String(to+1n), toBlock: String(safe), reason: 'awaiting-index'}] : []),
          ...(depth ? [{fromBlock: String(safe+1n), toBlock: String(head), reason: 'confirmation-depth'}] : []),
        ]}, sources, events}
    writeJson(snapshotPath, previous)
    from = to + 1n
  }
  return {file: snapshotPath, range: previous.coverage, events: previous.events.length}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const p = await openProfile(process.argv[2], process.argv[3])
  const lock = new DatabaseSync(resolve('.research', 'judge-activity-' + p.mode + '-' + p.campaign + '.sqlite'))
  try {
    lock.exec('BEGIN IMMEDIATE')
    console.log(JSON.stringify(await refresh(p)))
  } finally { lock.close() }
}

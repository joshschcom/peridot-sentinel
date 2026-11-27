// Separate historical activity for a judge campaign. Never overwrites the M4/public app snapshot.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addSource } from '../indexer/scan.mjs'
import { advance } from '../indexer/history.mjs'
import { outputOptions, writeSnapshot } from '../indexer/output.mjs'
import { reader } from '../indexer/rpc.mjs'
import { openProfile, checkBindings, observation } from '../judge-connect/profile.mjs'

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

export async function refresh(p, options, dependencies={}) {
  // All account, route and runtime bindings are checked at a recent common block.
  // The setup transaction history is never a prerequisite for reading current bindings.
  await (dependencies.verifyBindings ?? (()=>observation(p,ctx=>checkBindings(p,ctx))))()
  const roots=judgeSources(p.m)
  const config={first:BigInt(p.m.deploymentBlock),roots,
    metadata:{schemaVersion:1,kind:'judge-event-snapshot',chainId:1952,campaign:p.campaign,profile:p.m.profile},
    scopeDigest:createHash('sha256').update(JSON.stringify({campaign:p.campaign,sources:roots})).digest('hex')}
  return writeSnapshot(resolve(p.dir,'activity.json'),options,previous=>advance({previous,config,
    clients:dependencies.clients ?? p.urls.map(reader),depth:p.mode==='fork'?0:12,clock:dependencies.clock}))
}

export async function runJudge(mode,campaign,options) {
  return refresh(await openProfile(mode,campaign),options)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await runJudge(process.argv[2],process.argv[3],outputOptions(process.argv.slice(4))),null,2))
}

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { advance } from './history.mjs'
import { reader } from './rpc.mjs'
export { reader } from './rpc.mjs'
import { outputOptions, writeSnapshot } from './output.mjs'
import { addSource, catalog, header } from './scan.mjs'

const repo = new URL('../../',import.meta.url)
const json = file => JSON.parse(readFileSync(new URL(file,repo),'utf8'))
const out = new URL('packages/chain-config/activity/1952.json',repo)
const endpoints = ['https://testrpc.xlayer.tech','https://xlayertestrpc.okx.com']
const confirmations = 12

export function configuration() {
  const m4 = json('packages/chain-config/deployments/1952.json')
  assert(m4.chainId===1952 && m4.status==='deployed' && m4.profile==='testnet')
  const first = BigInt(m4.deploymentBlock)
  const sources = new Map()
  for (const name of ['MarketFactory','SentinelAccountFactory','PolicyRegistry','DevelopmentReferenceProcessor','TestnetOracle']) {
    addSource(sources,m4.contracts[name],name,first)
  }
  const expansion = 'packages/chain-config/expansion/deployments/1952.json'
  if (existsSync(new URL(expansion,repo))) {
    const v2 = json(expansion)
    assert(v2.chainId===1952 && v2.profile==='1952' && v2.journal==='deployments/expansion/1952/journal.json')
    const journal = json(v2.journal)
    assert(journal.chainId===1952)
    const roots = {factory:'SentinelAccountFactoryV2',swap:'SinglePoolSwapAdapter',cpu:'DevelopmentReferenceProcessor',mockOracle:'TestnetOracle'}
    for (const [key,name] of Object.entries(roots)) {
      const block = BigInt(journal.steps['deploy-'+key].block)
      assert(block>=first)
      addSource(sources,v2.contracts[key],name,block)
    }
  }
  const vaultPath = 'packages/chain-config/expansion/deployments/vault-1952.json'
  if (existsSync(new URL(vaultPath,repo))) {
    const vault = json(vaultPath)
    assert(vault.chainId===1952 && vault.deploymentBlock)
    for (const [key,name] of Object.entries({vaultFactory:'VaultSentinelAccountFactoryV2',mockVault:'TestnetSavingsVault'})) {
      assert(catalog[name] && catalog.VaultSentinelAccountV2,'Export the vault ABI with its public manifest')
      addSource(sources,vault.contracts[key],name,BigInt(vault.deploymentBlock))
    }
  }
  const roots = [...sources.values()]
  const abiEvents = Object.fromEntries(Object.entries(catalog).map(([name,events])=>[name,[...events.values()]]))
  return {first,roots,abiEvents,scopeDigest:digest(roots,abiEvents),metadata:{schemaVersion:1,kind:'indexed-event-snapshot',chainId:1952}}
}

export function digest(roots,abiEvents) {
  return createHash('sha256').update(JSON.stringify({roots,abiEvents})).digest('hex')
}

// Match historical coverage only against an exact prefix of the current roots and ABI.
function addedRoots(previous,config) {
  if (previous.scopeDigest===config.scopeDigest) return []
  const roots=config.roots??[]
  const catalogs=[config.abiEvents]
  // Optional vault ABIs may have been exported along with their deployment manifest.
  if (config.abiEvents?.VaultSentinelAccountV2) {
    catalogs.push(Object.fromEntries(Object.entries(config.abiEvents).filter(([name])=>
      !['VaultSentinelAccountFactoryV2','VaultSentinelAccountV2','TestnetSavingsVault'].includes(name))))
  }
  for (let i=roots.length;i>=1;i--) {
    const prefix=roots.slice(0,i)
    if (!catalogs.some(abi=>abi && previous.sources.every(s=>abi[s.contract]) && digest(prefix,abi)===previous.scopeDigest)) continue
    return roots.slice(i)
  }
  return null
}

export async function resume(previous, config, safe, rpc) {
  if (!previous) return null
  const additions=addedRoots(previous,config)
  if (!additions) return null
  assert(previous.schemaVersion===1 && previous.kind==='indexed-event-snapshot' && previous.chainId===1952)
  assert.equal(BigInt(previous.coverage.fromBlock),config.first)
  const to = BigInt(previous.coverage.toBlock)
  assert(to>=config.first && to<=safe,'RPC tip behind the saved snapshot')
  if ((await header(rpc,to)).hash!==previous.coverage.toBlockHash) return null
  if (!additions.length) return previous
  const next=additions.reduce((lowest,s)=>BigInt(s.fromBlock)<lowest?BigInt(s.fromBlock):lowest,to+1n)
  if (next<=config.first) return null
  // The old branch is canonical. Rewind only the overlapping suffix and rediscover all
  // children created there, including constructor logs from the newly added roots.
  const checkpoint=next===to+1n?previous.coverage.toBlockHash:(await header(rpc,next-1n)).hash
  const sources=new Map(previous.sources.filter(s=>BigInt(s.fromBlock)<next).map(s=>[s.address.toLowerCase(),s]))
  for (const root of config.roots) addSource(sources,root.address,root.contract,root.fromBlock)
  return {...previous,sources:[...sources.values()],events:previous.events.filter(e=>BigInt(e.blockNumber)<next),
    coverage:{...previous.coverage,toBlock:String(next-1n),toBlockHash:checkpoint}}
}

export async function refreshShared(options, dependencies={}) {
  const clients=dependencies.clients ?? endpoints.map(reader)
  return writeSnapshot(dependencies.input ?? fileURLToPath(out),options,previous=>advance({
    previous,clients,config:dependencies.config ?? configuration(),depth:confirmations,dynamic:true,prepare:resume,
    clock:dependencies.clock
  }))
}

export async function run(args) {
  const judges=args.filter(arg=>arg.startsWith('--judge='))
  assert(judges.length<=1,'Choose one campaign')
  const output=outputOptions(args.filter(arg=>!arg.startsWith('--judge=')))
  if (judges.length) {
    const {runJudge}=await import('../judge-activity/refresh.mjs')
    return runJudge('testnet',judges[0].slice(8),output)
  }
  return refreshShared(output)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  console.log(JSON.stringify(await run(process.argv.slice(2)),null,2))
}

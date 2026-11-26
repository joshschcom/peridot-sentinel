import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { addSource, catalog, GROUP, header, mergeEvents, scanGroup } from './scan.mjs'

const repo = new URL('../../',import.meta.url)
const json = file => JSON.parse(readFileSync(new URL(file,repo),'utf8'))
const out = new URL('packages/chain-config/activity/1952.json',repo)
const endpoints = ['https://testrpc.xlayer.tech','https://xlayertestrpc.okx.com']
const confirmations = 12

function configuration() {
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
  return {first,roots,abiEvents,scopeDigest:digest(roots,abiEvents)}
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

export function reader(url) {
  let id = 0
  return async (method,params) => {
    let last
    for (let attempt=0; attempt<4; attempt++) {
      try {
        const n = ++id
        const res = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:n,method,params}),signal:AbortSignal.timeout(10000)})
        if (!res.ok) throw Error('HTTP '+res.status)
        const body = await res.json()
        if (body.error) throw Error(body.error.message)
        assert(body.id===n && body.result!=null,'Incomplete RPC reply')
        return body.result
      } catch(error) {
        last=error
        if (attempt<3) await new Promise(resolve=>setTimeout(resolve,250*2**attempt))
      }
    }
    throw Error(url+' '+method+' failed: '+last.message)
  }
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

function publish(snapshot) {
  const temporary = new URL('1952.json.'+process.pid+'.tmp',out)
  writeFileSync(temporary,JSON.stringify(snapshot,null,2)+'\n')
  renameSync(temporary,out)
}

async function refresh() {
  const config = configuration()
  const clients = endpoints.map(reader)
  for (const rpc of clients) assert.equal(BigInt(await rpc('eth_chainId',[])),1952n)
  const tips = await Promise.all(clients.map(rpc=>header(rpc,'latest')))
  const head = tips[0].number < tips[1].number ? tips[0].number : tips[1].number
  assert(tips.every(t=>Math.abs(Date.now()/1000-Number(t.timestamp))<180),'RPC head is stale')
  const safe = head-BigInt(confirmations)
  // Both official endpoints must identify the same target and saved checkpoint.
  const tipsAtSafe = await Promise.all(clients.map(rpc=>header(rpc,safe)))
  assert.equal(tipsAtSafe[0].hash,tipsAtSafe[1].hash,'RPC endpoints disagree on target')
  const prior = existsSync(out)?JSON.parse(readFileSync(out,'utf8')):null
  const choices = await Promise.all(clients.map(rpc=>resume(prior,config,safe,rpc)))
  assert.deepEqual(choices[0]?.coverage??null,choices[1]?.coverage??null,'RPC endpoints disagree on saved checkpoint')
  let snapshot = choices[0]
  let next = snapshot ? BigInt(snapshot.coverage.toBlock)+1n : config.first
  if (next>safe) { console.log('Already covers confirmed target',String(safe)); return }
  while(next<=safe) {
    const to = next+GROUP-1n < safe ? next+GROUP-1n : safe
    let group, failure, peerRpc
    for (const [index,rpc] of clients.entries()) {
      try {
        group = await scanGroup(rpc,snapshot?.sources??config.roots,next,to,snapshot?.coverage.toBlockHash??null)
        peerRpc=clients[1-index]
        break
      } catch(e) { failure=e }
    }
    if (!group) throw failure
    // Verify the group endpoint on the independent transport before extending public coverage.
    const peer = await header(peerRpc,to)
    assert.equal(peer.hash,group.toBlockHash,'Public RPCs disagree about indexed range')
    if (to===safe) {
      assert.equal(group.toBlockHash,tipsAtSafe[0].hash,'Pinned target changed')
      const independent=await scanGroup(peerRpc,snapshot?.sources??config.roots,next,to,snapshot?.coverage.toBlockHash??null)
      assert.deepEqual(group,independent,'Public RPCs disagree about recent logs or emitters')
    }
    snapshot = {schemaVersion:1,kind:'indexed-event-snapshot',chainId:1952,updatedAt:new Date().toISOString(),
      scopeDigest:config.scopeDigest,coverage:{fromBlock:String(config.first),toBlock:String(to),toBlockHash:group.toBlockHash,
        headAtRefresh:String(head),confirmations,status:to===safe?'caught-up':'catching-up',
        gaps:[
          ...(to<safe?[{fromBlock:String(to+1n),toBlock:String(safe),reason:'awaiting-index'}]:[]),
          {fromBlock:String(safe+1n),toBlock:String(head),reason:'confirmation-depth'},
        ]},sources:group.sources,events:mergeEvents(snapshot?.events??[],group.events)}
    publish(snapshot)
    next=to+1n
  }
  console.log('1952 snapshot',snapshot.coverage.fromBlock,'through',snapshot.coverage.toBlock,'events',snapshot.events.length)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  mkdirSync(new URL('packages/chain-config/activity/',repo),{recursive:true})
  mkdirSync(new URL('.research/',repo),{recursive:true})
  const lock = new DatabaseSync(fileURLToPath(new URL('.research/activity-1952-refresh.sqlite',repo)))
  try { lock.exec('BEGIN IMMEDIATE'); await refresh() } finally { lock.close() }
}

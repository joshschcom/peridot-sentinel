// CLI outputs are relative to this checkout. A rehearsal can never select an app-visible file.
import assert from 'node:assert/strict'
import {lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createPublicClient, http} from 'viem'
import {mainnet, stringify} from '../../../../evidence/session6-d8b/checks.mjs'

export const root=fileURLToPath(new URL('../../../../',import.meta.url))
export const configPath='packages/chain-config/expansion/tapeout-196.json'
export const publicUrl='https://rpc.xlayer.tech'
export const forkUrl='http://127.0.0.1:19709'
export const forkReader=createPublicClient({transport:http(forkUrl,{retryCount:1,timeout:90000}),cacheTime:0})
export const publicWitness=createPublicClient({transport:http('https://xlayerrpc.okx.com',{retryCount:2,timeout:15000}),cacheTime:0})
export const forkStatus='verified-fork-rehearsal'

export function checkedPath(path,{canonical=false}={}) {
  assert(typeof path==='string' && (canonical && path===configPath ||
    /^(evidence\/session9-[a-z0-9-]+|\.research\/session9-[a-z0-9-]+)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/.test(path)),
    'Use a repository-relative JSON output under evidence/session9-* or .research/session9-*')
  let current=resolve(root)
  for(const part of path.split('/')){
    current=join(current,part)
    const stat=lstatSync(current,{throwIfNoEntry:false})
    assert(!stat?.isSymbolicLink(),'Symlink in publication path')
    if(current!==resolve(root,path))assert(!stat || stat.isDirectory(),'Non-directory in publication path')
    else assert(!stat || stat.isFile(),'Expected regular JSON file')
  }
  return current
}

export const loadData=(path,options)=>JSON.parse(readFileSync(checkedPath(path,options),'utf8'))
export function saveData(path,value,options) {
  const destination=checkedPath(path,options)
  mkdirSync(dirname(destination),{recursive:true})
  const temporary=destination+'.'+randomUUID()+'.tmp'
  try {
    writeFileSync(temporary,stringify(value),{flag:'wx'})
    renameSync(temporary,destination)
  } finally {rmSync(temporary,{force:true})}
}

// Check a real fork identity and its public origin. The loopback URL is fixed in code.
export async function publicationFork() {
  assert.equal(await forkReader.getChainId(),31337)
  const info=await forkReader.request({method:'anvil_nodeInfo'})
  assert.equal(info.forkConfig?.forkUrl,publicUrl)
  const block=BigInt(info.forkConfig.forkBlockNumber)
  const [local,origin,meta]=await Promise.all([forkReader.getBlock({blockNumber:block}),mainnet.getBlock({blockNumber:block}),forkReader.request({method:'anvil_metadata'})])
  assert.equal(await mainnet.getChainId(),196)
  assert.equal(BigInt(meta.forkedNetwork.forkBlockNumber),block)
  assert.equal(meta.forkedNetwork.forkBlockHash,origin.hash)
  assert.equal(local.hash,origin.hash)
  return {url:forkUrl,chainId:31337,instanceId:meta.instanceId,originChainId:196,originRpc:publicUrl,originBlock:String(block),originBlockHash:origin.hash}
}

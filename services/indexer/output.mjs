// The canonical snapshot is the input for every preview. Publish only on an explicit
// coordinator request. Atomic replacement preserves the saved evidence on RPC failure.
import assert from 'node:assert/strict'
import {existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, resolve, sep} from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../../',import.meta.url))
function destination(path) {
  if (existsSync(path)) return realpathSync(path)
  return join(destination(dirname(path)),basename(path))
}

export function outputOptions(flags) {
  const result={}
  for (const flag of flags) {
    if (flag==='--publish' && !result.publish) result.publish=true
    else if (flag.startsWith('--output=') && !result.output && flag.slice(9)) result.output=flag.slice(9)
    else throw Error('Invalid or repeated option: '+flag)
  }
  assert(Boolean(result.publish)!==Boolean(result.output),'Pass --output=<candidate.json> for a preview, or --publish for a requested refresh')
  return result
}

export async function writeSnapshot(canonical, options, build) {
  const original=resolve(canonical)
  assert(Boolean(options.publish)!==Boolean(options.output),'Select --output or --publish')
  const target=options.publish?original:resolve(options.output)
  if (!options.publish) {
    for (const dir of ['packages/chain-config','deployments/session7']) {
      const protectedRoot=resolve(root,dir)
      for (const path of [target,destination(target)]) {
        assert(path!==protectedRoot && !path.startsWith(protectedRoot+sep),'Use a separate candidate output outside deployment data')
      }
    }
    assert(destination(target)!==destination(original),'Preview cannot replace its input')
  }
  const locks=resolve(root,'.research')
  mkdirSync(locks,{recursive:true})
  const lock=new DatabaseSync(join(locks,'snapshot-'+createHash('sha256').update(destination(target)).digest('hex')+'.sqlite'))
  const tmp=target+'.'+randomUUID()+'.tmp'
  try {
    lock.exec('BEGIN IMMEDIATE')
    const previous=existsSync(original)?JSON.parse(readFileSync(original,'utf8')):null
    const result=await build(previous)
    mkdirSync(dirname(target),{recursive:true})
    writeFileSync(tmp,JSON.stringify(result,null,2)+'\n',{flag:'wx'})
    renameSync(tmp,target)
    return {file:target,events:result.events.length,coverage:result.coverage}
  } finally {
    lock.close()
    rmSync(tmp,{force:true})
  }
}

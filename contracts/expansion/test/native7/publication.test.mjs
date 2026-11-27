import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdirSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs'
import {resolve} from 'node:path'
import {destinations} from '../../../../docs/coordination/D8b-postpublish.mjs'
import {config,inputMode} from '../../script/native7/fork.mjs'
import {checkedPath,configPath,forkStatus} from '../../script/native7/publication-io.mjs'

const hashes=['1','2','3','4'].map(d=>'0x'+d.repeat(64))
test('receipt verification requires an explicit mode and a fork output cannot select a committed profile',()=>{
  assert.throws(()=>destinations(hashes))
  assert.throws(()=>destinations(['--published','--fork',...hashes]))
  assert.throws(()=>destinations(['--fork',...hashes]))
  for(const path of [configPath,'packages/chain-config/activity/1952.json','packages/chain-config/deployments/1952.json',
    'deployments/session7/1952/judge-01/activity.json','evidence/session9-native/../../'+configPath,
    'evidence/session7-native/rehearsal-fork.json','/tmp/tapeout.json','evidence/session9-native/verified-receipts.json']){
    assert.throws(()=>destinations(['--fork','--out',path,...hashes]))
  }
  assert.equal(destinations(['--published',...hashes]).output,configPath)
  assert.equal(destinations(['--fork','--out','evidence/session9-native/proof/config.json',...hashes]).evidence,'evidence/session9-native/proof/verified-receipts.json')
})
test('isolated outputs cannot follow a symbolic link to shared configuration',()=>{
  mkdirSync('.research',{recursive:true})
  mkdirSync('.research/session9-native-tests',{recursive:true})
  const dir=mkdtempSync('.research/session9-native-tests/guard-')
  try {
    symlinkSync(resolve(configPath),dir+'/config.json')
    assert.throws(()=>checkedPath(dir+'/config.json'),/Symlink/)
    symlinkSync(resolve('packages/chain-config/expansion'),dir+'/alias')
    assert.throws(()=>checkedPath(dir+'/alias/tapeout-196.json'),/Symlink/)
  } finally {rmSync(dir,{recursive:true})}
})
test('public publication mode rejects a verified private config and origin mismatch',()=>{
  const example=structuredClone(config)
  Object.assign(example,{chainId:31337,mode:'fork-only',status:forkStatus,origin:{instanceId:'fork-a'},verifiedBlock:'20',verifiedBlockHash:'0x'+'a'.repeat(64)})
  example.circuits.forEach((c,i)=>Object.assign(c,{publishedId:String(i+2),publicReceipt:hashes[i+1]}))
  assert.throws(()=>inputMode('--published',example))
  assert.throws(()=>inputMode('--published',example,{instanceId:'fork-b'}))
  assert.equal(inputMode('--published',example,example.origin).number,20n)
})

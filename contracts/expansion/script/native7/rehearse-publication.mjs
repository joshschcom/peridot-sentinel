// One disposable publication fork and a second disposable financial-consumer fork.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {mainnet,packet,verifyBindings,verifyCalls} from '../../../../evidence/session6-d8b/checks.mjs'
import {checkedPath,loadData,publicationFork,publicUrl,saveData} from './publication-io.mjs'
import {withFork} from './fork.mjs'

const {values}=parseArgs({options:{'out-dir':{type:'string'}}})
assert(values['out-dir'],'Specify --out-dir evidence/session9-native/RUN')
const output=name=>values['out-dir']+'/'+name+'.json'
for(const file of ['publication-transactions','tapeout-196','verified-receipts','financial-fork']){
  assert(!existsSync(checkedPath(output(file))),'Select a fresh run directory')
}
const head=await mainnet.getBlock({blockTag:'finalized'})
await verifyBindings(head.number)
const pin={number:head.number,hash:head.hash}
const cli=(...args)=>execFileSync(process.execPath,args,{stdio:'inherit'})
await withFork(pin,async ctx=>{
  const origin=await publicationFork()
  for(const call of verifyCalls(packet.proposedMainnetCalls)){
    await ctx.send('FORK '+call.label,{to:call.to,data:call.data,value:BigInt(call.value),gas:BigInt(call.gas),
      maxFeePerGas:BigInt(call.maxFeePerGas),maxPriorityFeePerGas:BigInt(call.maxPriorityFeePerGas),type:'eip1559',accessList:[]})
  }
  await ctx.node.request({method:'anvil_mine',params:['0xc']})
  saveData(output('publication-transactions'),{mode:'FORK: local 31337 publication envelope, no public signature or transaction',origin,receipts:ctx.receipts})
  cli('docs/coordination/D8b-postpublish.mjs','--fork','--out',output('tapeout-196'),...ctx.receipts.map(r=>r.hash))
  cli('contracts/expansion/script/native7/run.mjs','--published','--fork','--config',output('tapeout-196'),'--out',output('financial-fork'))
  const d=loadData(output('financial-fork'))
  assert.equal(d.publicCircuitIds,null)
  assert(d.programs.every(p=>p.publication==='fork-only'))
  assert.equal(d.responseTest.passed,12)
  execFileSync(process.execPath,['--test','contracts/expansion/test/native7/run.test.mjs'],{
    stdio:'inherit',env:{...process.env,NATIVE7_FORK_PROOF:output('financial-fork')}
  })
  console.log('FORK ONLY: completed publication and financial rehearsal in '+values['out-dir'])
},mainnet,publicUrl,19709)

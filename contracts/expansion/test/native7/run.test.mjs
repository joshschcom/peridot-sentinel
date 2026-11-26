import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {keccak256} from 'viem'
import {config,inputMode} from '../../script/native7/fork.mjs'

const d=JSON.parse(readFileSync(new URL('../../../../evidence/session7-native/rehearsal-fork.json',import.meta.url)))
test('rehearsal evidence can never populate publication mode',()=>{
  assert.equal(d.chainId,31337)
  assert.equal(d.publicCircuitIds,null)
  assert.equal(d.upstream.chainId,196)
  assert(d.programs.every(p=>p.publication==='fork-only'))
  if(config.status!=='published')assert.throws(()=>inputMode('--published'),/has not verified public IDs/)
  assert.throws(()=>inputMode(undefined),/Choose/)
})
test('all three financial boundaries go through CPU 410, and the development processor is only a parity control',()=>{
  assert.equal(d.bindings.cpuIndex,410)
  assert.equal(d.programs.reduce((n,p)=>n+p.vectors.length,0),23)
  for(const p of d.programs)assert(p.vectors.every(v=>v.native===v.dev && BigInt(v.gasEstimate)>21000n))
  for(const name of ['ACCOUNT 5500','MARKET 6500','EXECUTION 100','ACCOUNT 5501','MARKET 6501','EXECUTION 101']){
    const op=d.operations.find(o=>o.label.startsWith(name));assert(op)
    const denied=['ACCOUNT 5501','MARKET 6501','EXECUTION 101'].includes(name)
    assert.equal(op.status,denied?'reverted':'success')
    assert.equal(op.native.at(-1).decision,denied?'0x00':'0x01')
    assert.equal(op.referenceCalls,0)
    if(denied)assert.deepEqual(op.before,op.after)
  }
})
test('risk increases fail with each injected fault, and ordinary repayment still works during the outage',()=>{
  assert.equal(d.injectedFaults.length,3)
  for(const f of d.injectedFaults){
    const legs=d.operations.filter(o=>o.label.startsWith('Fail closed') && o.label.endsWith(f.label))
    assert.equal(legs.length,3)
    for(const op of legs){assert.equal(op.status,'reverted');assert.equal(op.referenceCalls,0);assert.deepEqual(op.before,op.after);assert.equal(op.native.length,0)}
  }
  const repay=d.operations.find(o=>o.label.startsWith('Owner repay while'))
  assert.equal(repay.status,'success');assert(BigInt(repay.before.accountDebt)>BigInt(repay.after.accountDebt))
  assert.equal(d.responseTest.passed,12)
})
test('zero-value witness proposal uses fixed initcode and three read-only example calls',()=>{
  const p=d.witnessProposal
  assert.equal(p.transaction.to,null);assert.equal(p.transaction.value,'0x0')
  assert.equal(keccak256(p.transaction.data),p.creationDataHash)
  assert(BigInt(p.transaction.gas)>BigInt(p.observedGas))
  assert.equal(BigInt(p.totalUpperWei),BigInt(p.transaction.gas)*BigInt(p.transaction.maxFeePerGas)+BigInt(p.l1UpperWei)+BigInt(p.operatorUpperWei))
  assert.equal(p.verificationCalls.length,3)
})

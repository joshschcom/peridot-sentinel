import assert from 'node:assert/strict'
import {after,test} from 'node:test'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import { keccak256, toHex } from 'viem'
import {catalog,validate} from '../server.mjs'
import {calldata,campaign,loadProposal,maximumInput,operator,proposalId,raw,store,submitted} from '../policy.mjs'
import {permitted} from '../state.mjs'

mkdirSync('.research',{recursive:true})
const dir=mkdtempSync('.research/s6-mcp-v2-test-')
after(()=>rmSync(dir,{recursive:true,force:true}))
const m={contracts:{account:'0x0000000000000000000000000000000000000011',mockWokb:'0x0000000000000000000000000000000000000022'},source:{expansionCommit:'a'.repeat(40)}}
function body(op,input='1000'){
  const args=op==='swap'?{amountInRaw:input,minOutRaw:'1'}:{}
  return {chainId:1952,operator,account:m.contracts.account,campaign:campaign(m),operation:op,
    commit:m.source.expansionCommit,valueWei:'0',deadline:'100',args,calldata:calldata(m,op,args,'100')}
}
test('seven typed tools; unknown actions, targets, keys and calldata rejected',()=>{
  assert.equal(catalog.length,7)
  for(const [op,args] of [['read_account',{account:m.contracts.account}],['withdraw',{}],['execute_swap',{data:'0x'}],
    ['simulate_and_propose_swap',{amountInRaw:1,minOutRaw:'1'}],['mine_denied_borrow',{proposalId:'0x1'}],
    ['read_market',{amountInRaw:'1',privateKey:'redacted'}]])
    assert.throws(()=>validate(op,args))
  validate('simulate_and_propose_swap',{amountInRaw:'1',minOutRaw:'1'})
  assert.throws(()=>raw('1e18'));assert.throws(()=>raw('0'));assert.throws(()=>raw((2n**256n).toString()))
})
test('per-call, cumulative, expiry, idle balance and independent campaign limits',()=>{
  const view={swapGrant:{maxPerCallRaw:100n,remainingRaw:120n,expiry:90n},idle:{inputRaw:119n}}
  permitted(view,100n,89n)
  for(const [field,value] of [['maxPerCallRaw',99n],['remainingRaw',99n],['expiry',89n],['maxPerCallRaw',maximumInput+1n],
    ['remainingRaw',2n*maximumInput+1n]]){
    assert.throws(()=>permitted({...view,swapGrant:{...view.swapGrant,[field]:value}},100n,89n))
  }
  assert.throws(()=>permitted({...view,idle:{inputRaw:99n}},100n,89n))
})
test('proposal binds type, target, parameters, deadline and immutable deployment',()=>{
  const db=store(dir+'/p.sqlite',dir+'/k.sqlite')
  try{
    const b=body('swap'),id=proposalId(b)
    db.propose(id,b)
    assert.equal(loadProposal(db,m,id,'swap').body.calldata,b.calldata)
    assert.throws(()=>loadProposal(db,m,id,'deniedBorrow'))
    assert.throws(()=>loadProposal(db,{...m,source:{expansionCommit:'b'.repeat(40)}},id,'swap'))
    for(const change of [{deadline:'101'},{args:{amountInRaw:'9',minOutRaw:'1'}},{calldata:'0x'},{valueWei:'1'}]){
      db.db.prepare('UPDATE proposal SET body=? WHERE id=?').run(JSON.stringify({...b,...change}),id)
      assert.throws(()=>loadProposal(db,m,id,'swap'))
    }
  }finally{db.close()}
})
test('two persistent campaign slots share the same D9 keeper nonce lane; restart cannot spend again',()=>{
  const keeper=dir+'/shared.sqlite',file=dir+'/campaign.sqlite'
  const db=store(file,keeper), other=store(dir+'/other.sqlite',keeper)
  const a=body('swap','10'),b=body('swap','20'),n=body('deniedBorrow')
  const [i,j,k]=[a,b,n].map(proposalId)
  const h=x=>keccak256(toHex(x))
  try{
    for(const p of [a,b,n])db.propose(proposalId(p),p)
    db.reserve(i,h('swap'),7,m.contracts.account)
    assert.equal(db.reserve(i,h('other'),8,m.contracts.account),false)
    other.propose(k,n)
    assert.throws(()=>other.reserve(k,h('other'),8,m.contracts.account))
    db.settle(i,h('swap'),{status:'confirmed-swap'})
    assert.throws(()=>db.reserve(j,h('repeat'),8,m.contracts.account))
    assert.equal(submitted(db,m,'swap').id,i)
    assert(db.reserve(k,h('deny'),8,m.contracts.account))
    db.settle(k,h('deny'),{status:'mined-revert'})
    const resumed=store(file,keeper)
    try{assert.equal(submitted(resumed,m,'deniedBorrow').hash,h('deny'));assert.equal(submitted(resumed,m,'swap').hash,h('swap'))}
    finally{resumed.close()}
  }finally{db.close();other.close()}
})

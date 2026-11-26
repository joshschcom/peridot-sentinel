// Independently reconcile all judge-setup transaction intents on both public RPCs without signing.
import assert from 'node:assert/strict'
import {getAddress,keccak256} from 'viem'
import {open,readJson,retryRead,writeJson} from './transport.mjs'
import {readiness} from './operations.mjs'
const [mode,campaign='judge-01']=process.argv.slice(2)
if(mode==='testnet' && !process.env.JUDGE_OWNER && /^[a-z][a-z0-9-]{0,39}$/.test(campaign))
  process.env.JUDGE_OWNER=readJson('deployments/session7/1952/'+campaign+'/manifest.json').owner
const s=await open(mode,campaign,'verify')
try{
  const m=readJson(s.dir+'/manifest.json')
  const results=[]
  for(const rpc of new Set([s.client,s.witness])){
    const receipts=Object.entries(m.setupReceipts)
    for(let i=0;i<receipts.length;i+=4){
      await Promise.all(receipts.slice(i,i+4).map(async ([label,hash])=>{
        await retryRead(async()=>{
          const step=s.state.steps[label]
          const [r,t]=await Promise.all([rpc.getTransactionReceipt({hash}),rpc.getTransaction({hash})])
          const b=await rpc.getBlock({blockNumber:r.blockNumber})
          assert.equal(b.hash,r.blockHash);assert.equal(step.blockHash,b.hash);assert.equal(String(b.number),step.blockNumber)
          assert.equal(r.status,'success');assert.equal(t.nonce,step.nonce);assert.equal(getAddress(t.from),step.intent.account)
          assert.equal(t.to?getAddress(t.to):null,step.intent.to);assert.equal(String(t.value),step.intent.value)
          assert.equal(keccak256(t.input),step.intent.dataHash)
        })
      }))
    }
    results.push({url:rpc.transport.url,verifiedReceipts:receipts.length})
  }
  const prepared=await readiness(s,m,BigInt(m.preparedBlock))
  assert.equal(prepared.blockHash,m.preparedBlockHash)
  assert(prepared.repayReady && prepared.swapReady)
  const current=await readiness(s,m)
  const result={chainId:1952,campaign:s.campaign,profile:s.profile,results,prepared,current}
  writeJson(s.dir+'/verified.json',result)
  console.log(JSON.stringify({block:current.blockNumber.toString(),repayReady:current.repayReady,swapReady:current.swapReady,results}))
}finally{s.close()}

import assert from 'node:assert/strict'
import test from 'node:test'
import {discoverV1} from './revocation.mjs'

test('v1 grant discovery includes both accounts and every later operator in capped pages',async()=>{
  const a='0x0000000000000000000000000000000000000001',b='0x0000000000000000000000000000000000000002'
  const x='0x0000000000000000000000000000000000000003',y='0x0000000000000000000000000000000000000004'
  const m={markets:{A:{account:a,creationBlock:'100'},B:{account:b,creationBlock:'160'}}}
  const logs=[[100n,a,x],[101n,a,x],[250n,a,y],[301n,b,y]]
  const pages=[]
  const rpc={getBlock:async({blockNumber})=>({hash:'block-'+blockNumber}),getLogs:async({address,event,fromBlock,toBlock})=>{
    assert.deepEqual(address,[a,b]);assert.equal(event.name,'OperatorSet');assert(toBlock-fromBlock<100n)
    pages.push([fromBlock,toBlock])
    return logs.filter(([h])=>h>=fromBlock&&h<=toBlock).map(([h,address,operator])=>({address,args:{operator},removed:false,blockHash:'block-'+h,transactionHash:'tx-'+h,logIndex:0}))
  }}
  const s={state:{plan:{}},client:rpc,witness:rpc,live:false,save(){}}
  assert.deepEqual(await discoverV1(s,m,{number:300n,hash:'block-300'}),{[a]:[x,y],[b]:[]})
  assert.deepEqual(pages,[[100n,199n],[200n,299n],[300n,300n]])
  pages.length=0
  assert.deepEqual(await discoverV1(s,m,{number:400n,hash:'block-400'}),{[a]:[x,y],[b]:[y]})
  assert.deepEqual(pages,[[301n,400n]])
})

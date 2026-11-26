// Independently check the committed snapshot against public receipts and factory state.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { getAddress, toFunctionSelector } from 'viem'
import { reader } from '../../services/indexer/refresh.mjs'
import { header, mergeEvents } from '../../services/indexer/scan.mjs'

const rpc = reader('https://xlayertestrpc.okx.com')
const bytes = readFileSync(new URL('../../packages/chain-config/activity/1952.json',import.meta.url))
const s = JSON.parse(bytes)
const coverage = s.coverage
assert.equal(BigInt(await rpc('eth_chainId',[])),1952n)
const end = BigInt(coverage.toBlock)
assert.equal((await header(rpc,end)).hash,coverage.toBlockHash)
assert.deepEqual(mergeEvents([],s.events),s.events)
const sources = new Map(s.sources.map(src=>[src.address.toLowerCase(),src]))
const hashes=[...new Set(s.events.map(e=>e.transactionHash))]
const allReceipts=new Map()
for(let i=0;i<hashes.length;i+=5){
  await Promise.all(hashes.slice(i,i+5).map(async h=>{
    const receipt=await rpc('eth_getTransactionReceipt',[h])
    assert.equal(receipt.transactionHash,h)
    assert.equal(BigInt(receipt.status),1n)
    allReceipts.set(h,receipt)
  }))
}
for (const e of s.events) {
  const source=sources.get(e.address.toLowerCase())
  assert(source && BigInt(e.blockNumber)>=BigInt(source.fromBlock) && BigInt(e.blockNumber)<=end)
  const receipt=allReceipts.get(e.transactionHash)
  assert.equal(receipt.blockHash,e.blockHash)
  assert.equal(BigInt(receipt.blockNumber),BigInt(e.blockNumber))
  const log=receipt.logs.find(l=>BigInt(l.logIndex)===BigInt(e.logIndex))
  assert(log && getAddress(log.address)===e.address && log.blockHash===e.blockHash)
}
const factory=s.sources.find(src=>src.contract==='MarketFactory')
const expectedCount=BigInt(await rpc('eth_call',[{to:factory.address,data:toFunctionSelector('marketCount()')},'0x'+end.toString(16)]))
const markets=s.events.filter(e=>e.contract==='MarketFactory' && e.eventName==='MarketCreated')
assert.equal(BigInt(markets.length),expectedCount,'Factory state disagrees with discovered markets')
const connect='0xc5daaf3401cde7a7b1e8f93c97290f8d9711825ba871097af074304340569b0f'
assert(s.events.some(e=>e.transactionHash===connect && e.eventName==='AutoRepayExecuted'))
const expansion=JSON.parse(readFileSync(new URL('../../packages/chain-config/expansion/deployments/1952.json',import.meta.url)))
if (BigInt(expansion.swap.block)<=end) {
  assert(s.events.some(e=>e.transactionHash===expansion.swap.receipt && e.address.toLowerCase()===expansion.contracts.account.toLowerCase()))
  assert(s.events.some(e=>e.transactionHash===expansion.swap.receipt && e.address.toLowerCase()===expansion.contracts.swap.toLowerCase()))
}
const vaultProfile=new URL('../../packages/chain-config/expansion/deployments/vault-1952.json',import.meta.url)
const vaultReceipts=[]
if (existsSync(vaultProfile)) {
  const vault=JSON.parse(readFileSync(vaultProfile))
  for (const r of Object.values(vault.demo.receipts)) {
    if (BigInt(r.block)>end) continue
    const event=s.events.find(e=>e.transactionHash===r.hash && e.eventName==='VaultSettled')
    assert(event && event.address===getAddress(vault.contracts.vaultAccount))
    assert.equal(event.args.operation,String(r.operation))
    assert.equal(event.args.assets,r.assets)
    assert.equal(event.args.shares,r.shares)
    vaultReceipts.push(r.hash)
  }
}
assert.equal((await header(rpc,end)).hash,coverage.toBlockHash)
console.log(JSON.stringify({chainId:1952,method:'Public receipt and marketCount reads',snapshotSHA256:createHash('sha256').update(bytes).digest('hex'),
  coverage,sourceCount:s.sources.length,verifiedLogs:s.events.length,successfulReceiptCount:hashes.length,factoryMarketCount:String(expectedCount),
  markets:markets.map(m=>({id:m.args.marketId,controller:m.args.controller,receipt:m.transactionHash})),
  connectReceipt:connect,vaultReceipts,swapReceipt:BigInt(expansion.swap.block)<=end?expansion.swap.receipt:null},null,2))

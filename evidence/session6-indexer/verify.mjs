// Independently check the committed snapshot against public receipts and factory state.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { decodeEventLog, getAddress, toFunctionSelector } from 'viem'
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
const account=getAddress(expansion.contracts.account)
const accountAbi=JSON.parse(readFileSync(new URL('../../packages/chain-config/expansion/abi/SentinelAccountV2.json',import.meta.url)))
const inCoverage=block=>BigInt(block)>=BigInt(coverage.fromBlock) && BigInt(block)<=end

function settledEvent(evidence,name,sender) {
  assert.equal(evidence.status,'success')
  const receipt=allReceipts.get(evidence.hash)
  assert(receipt,'Missing successful transaction '+evidence.hash)
  assert.equal(getAddress(receipt.from),getAddress(sender))
  assert.equal(getAddress(receipt.to),account)
  assert.equal(receipt.blockHash,evidence.blockHash)
  assert.equal(BigInt(receipt.blockNumber),BigInt(evidence.blockNumber??evidence.block))
  const matches=s.events.filter(e=>e.transactionHash===evidence.hash && e.address===account && e.eventName===name)
  assert.equal(matches.length,1,'Expected one '+name+' from the pinned v2 account')
  const event=matches[0]
  const log=receipt.logs.find(l=>BigInt(l.logIndex)===BigInt(event.logIndex))
  const decoded=decodeEventLog({abi:accountAbi,data:log.data,topics:log.topics,strict:true})
  assert.equal(decoded.eventName,name)
  for (const [key,value] of Object.entries(decoded.args)) assert.equal(event.args[key],String(value))
  return event
}

async function confirmAbsent(evidence,sender) {
  const receipt=await rpc('eth_getTransactionReceipt',[evidence.hash])
  assert.equal(evidence.status,'reverted')
  assert.equal(receipt.transactionHash,evidence.hash)
  assert.equal(getAddress(receipt.from),getAddress(sender))
  assert.equal(getAddress(receipt.to),account)
  assert.equal(receipt.blockHash,evidence.blockHash)
  assert.equal(BigInt(receipt.blockNumber),BigInt(evidence.blockNumber??evidence.block))
  assert.equal((await header(rpc,BigInt(receipt.blockNumber))).hash,receipt.blockHash)
  assert.equal(BigInt(receipt.status),0n)
  assert.deepEqual(receipt.logs,[],'Reverted receipt unexpectedly has logs')
  assert(!s.events.some(e=>e.transactionHash===evidence.hash),'Reverted transaction surfaced as activity')
  return receipt.transactionHash
}

const demo=JSON.parse(readFileSync(new URL('../session6-v2/1952.json',import.meta.url)))
assert(demo.chainId===1952 && demo.public && getAddress(demo.account)===account)
if (demo.operatorSwap && inCoverage(demo.operatorSwap.block)) {
  settledEvent(demo.operatorSwap,'SwapSettled',demo.operator)
}
if (demo.denial && inCoverage(demo.denial.block)) await confirmAbsent(demo.denial,demo.denial.from)
const d21={swapReceipt:null,deniedBorrowReceiptWithZeroLogs:null}
const campaignPath=new URL('../session6-mcp-v2/verified.json',import.meta.url)
if (existsSync(campaignPath)) {
  const campaign=JSON.parse(readFileSync(campaignPath))
  assert.equal(getAddress(campaign.account),account)
  assert.equal(getAddress(campaign.operator),getAddress(demo.operator))
  const swap=campaign.swap.canonical, denial=campaign.rejection.canonical
  assert.equal(swap.chainId,1952)
  assert.equal(denial.chainId,1952)
  assert.equal(swap.status,'confirmed-swap')
  assert.equal(denial.status,'mined-revert')
  assert.equal(denial.replay.error,'OperatorNotAuthorized')
  assert(BigInt(denial.borrowAmountRaw)===1n)
  if (inCoverage(swap.receipt.blockNumber)) {
    const event=settledEvent(swap.receipt,'SwapSettled',campaign.operator)
    assert.equal(getAddress(event.args.operator),getAddress(campaign.operator))
    assert.equal(event.args.amountIn,campaign.swap.chosenArgs.amountInRaw)
    assert.equal(event.args.amountOut,swap.outputBalanceGainedRaw)
    d21.swapReceipt=event.transactionHash
  }
  if (inCoverage(denial.receipt.blockNumber)) {
    d21.deniedBorrowReceiptWithZeroLogs=await confirmAbsent(denial.receipt,campaign.operator)
  }
}

let emergencyRevokeReceipt=null
const revoke=demo.emergencyRevoke
if (revoke && inCoverage(revoke.block)) {
  const owner=await rpc('eth_call',[{to:account,data:toFunctionSelector('owner()')},'0x'+BigInt(revoke.block).toString(16)])
  const event=settledEvent(revoke,'AllOperatorsRevoked','0x'+owner.slice(-40))
  assert.equal(event.args.newEpoch,String(revoke.newEpoch))
  emergencyRevokeReceipt=event.transactionHash
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
  connectReceipt:connect,d21,emergencyRevokeReceipt,vaultReceipts,swapReceipt:BigInt(expansion.swap.block)<=end?expansion.swap.receipt:null},null,2))

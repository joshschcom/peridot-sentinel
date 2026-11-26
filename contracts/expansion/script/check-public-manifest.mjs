// Independently verify published 1952 addresses and every creation/setup receipt at a canonical block.
import assert from 'node:assert/strict'
import {createPublicClient,getAddress,http,keccak256,parseAbi} from 'viem'
import {deployer,readJson,retryRead,writeJson} from './session6-transactions.mjs'

const source=readJson('packages/chain-config/expansion/deployments/1952.json')
assert.equal(source.profile,'1952')
assert.equal(source.chainId,1952)
assert.equal(source.journal,'deployments/expansion/1952/journal.json')
const journal=readJson(source.journal)
const client=createPublicClient({transport:http('https://xlayertestrpc.okx.com',{retryCount:0}),cacheTime:0})
assert.equal(await retryRead(()=>client.getChainId()),1952)
const height=BigInt(source.swap.block)
const anchor=await retryRead(()=>client.getBlock({blockNumber:height}))
const steps=Object.entries(journal.steps)
const receipts=[]
for(const [name,step] of steps) {
  const [r,tx,header]=await retryRead(()=>Promise.all([client.getTransactionReceipt({hash:step.hash}),
    client.getTransaction({hash:step.hash}),client.getBlock({blockNumber:BigInt(step.block)})]))
  assert.equal(r.status,'success')
  assert.equal(r.blockHash,header.hash);assert.equal(header.hash,step.blockHash)
  assert.equal(getAddress(tx.from),getAddress(deployer))
  assert.equal(tx.value,0n);assert.equal(tx.nonce,step.nonce)
  assert.equal(keccak256(tx.input),step.dataHash)
  if(name.startsWith('deploy-')) assert.equal(getAddress(r.contractAddress),getAddress(source.contracts[name.slice(7)]))
  receipts.push({name,hash:step.hash,block:step.block,nonce:step.nonce})
}
assert.equal(new Set(receipts.map(r=>r.nonce)).size,steps.length)
const abi=parseAbi(['function owner() view returns(address)','function accountOf(address) view returns(address)',
  'function executionPolicy() view returns(address)','function swapAdapter() view returns(address)','function lendingAdapter() view returns(address)',
  'function netlist(uint256) view returns(bytes)','function pool() view returns(address)'])
const read=(address,functionName,args=[])=>retryRead(()=>client.readContract({address,abi,functionName,args,blockNumber:height}))
const a=source.contracts
for(const [name,address] of Object.entries(a)) {
  const code=await retryRead(()=>client.getCode({address,blockNumber:height}),Boolean)
  assert.equal(keccak256(code),source.runtimeCodeHashes[name],name+' runtime changed')
}
for(const [name,key] of [['swapAdapter','swap'],['lendingAdapter','lending'],['executionPolicy','execution']]) {
  assert.equal(getAddress(await read(a.account,name)),getAddress(a[key]))
}
assert.equal(getAddress(await read(a.factory,'accountOf',[deployer])),getAddress(a.account))
assert.equal(getAddress(await read(a.account,'owner')),getAddress(deployer))
assert.equal(getAddress(await read(a.swap,'pool')),getAddress(a.venue))
assert.equal(keccak256(await read(a.cpu,'netlist',[BigInt(source.execution.circuitId)])),source.execution.netlistHash)
assert.equal((await retryRead(()=>client.getBlock({blockNumber:height}))).hash,anchor.hash)
assert.equal(source.swap.receipt,journal.steps['swap-exact-input'].hash)
if(process.argv.includes('--record')) writeJson('evidence/session6-v2/manifest-check.json',{
  chainId:1952,endpoint:'https://xlayertestrpc.okx.com',sourceCommit:source.source.expansionCommit,
  block:height,blockHash:anchor.hash,contracts:a,runtimeCodeHashes:source.runtimeCodeHashes,receipts})
console.log('Verified '+steps.length+' public 1952 receipts and '+Object.keys(a).length+' runtime hashes at block '+height)

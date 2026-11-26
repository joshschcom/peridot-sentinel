// Read-only independent verification, pinned to the public manifest's own settlement block.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPublicClient,getAddress,http,keccak256,parseAbi,parseEventLogs} from 'viem'

const load=path=>JSON.parse(readFileSync(path))
const manifest=load('packages/chain-config/expansion/deployments/vault-1952.json')
const j=load(manifest.journal)
assert(manifest.public && manifest.chainId===1952 && manifest.profile==='1952')
const {mockVault,vaultAdapter,vaultFactory,vaultAccount}=manifest.contracts
const abi=load('packages/chain-config/expansion/abi/VaultSentinelAccountV2.json')
const tokenAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'])
const tip=BigInt(manifest.demo.block)
const steps=Object.values(j.steps)
assert.equal(steps.length,9)
assert.equal(new Set(steps.map(s=>s.nonce)).size,9)
async function retry(fn) {
  let error
  for(let i=0;i<8;i++){
    try {return await fn()}catch(e){error=e}
    await new Promise(r=>setTimeout(r,200*(i+1)))
  }
  throw error
}
const hosts=['https://testrpc.xlayer.tech','https://xlayertestrpc.okx.com']
const results=[]
for(const host of hosts){
  const c=createPublicClient({transport:http(host,{retryCount:0}),cacheTime:0})
  await retry(async()=>{
    assert.equal(await c.getChainId(),1952)
    assert((await c.getBlockNumber())>=tip+2n)
    assert.equal((await c.getBlock({blockNumber:tip})).hash,manifest.demo.blockHash)
  })
  const call=(address,abi,functionName,args=[])=>c.readContract({address,abi,functionName,args,blockNumber:tip})
  for(const [name,address] of Object.entries(manifest.contracts)){
    await retry(async()=>assert.equal(keccak256(await c.getCode({address,blockNumber:tip})),manifest.runtimeCodeHashes[name]))
  }
  for(const s of steps)await retry(async()=>{
    const r=await c.getTransactionReceipt({hash:s.hash})
    assert.equal(r.status,'success')
    assert.equal(r.blockHash,s.blockHash)
    assert.equal((await c.getBlock({blockNumber:r.blockNumber})).hash,s.blockHash)
  })
  const events=[]
  for(const [name,record] of Object.entries(manifest.demo.receipts)){
    const r=await retry(()=>c.getTransactionReceipt({hash:record.hash}))
    const logs=r.logs.filter(l=>getAddress(l.address)===getAddress(vaultAccount))
    const [event]=parseEventLogs({abi,logs,eventName:'VaultSettled'})
    assert.equal(getAddress(event.args.operator),getAddress(manifest.demo.owner))
    assert.equal(getAddress(event.args.vault),getAddress(mockVault))
    assert.equal(event.args.operation,record.operation)
    assert.equal(event.args.shares,BigInt(record.shares))
    assert.equal(event.args.assets,BigInt(record.assets))
    events.push({name,hash:r.transactionHash,block:r.blockNumber.toString(),...record})
  }
  const position=await retry(async()=>{
    const p=await call(vaultAccount,abi,'vaultPosition')
    assert.deepEqual(p,[4_000_000n,4_000_000n,4_000_000n,4_000_000n])
    assert.equal(await call(manifest.asset,tokenAbi,'balanceOf',[vaultAccount]),8_000_000n)
    assert.equal(await call(manifest.asset,tokenAbi,'balanceOf',[mockVault]),4_000_000n)
    assert.equal(await call(manifest.asset,tokenAbi,'allowance',[vaultAccount,mockVault]),0n)
    assert.equal(await call(manifest.asset,tokenAbi,'allowance',[vaultAccount,vaultAdapter]),0n)
    assert.equal(getAddress(await call(vaultFactory,parseAbi(['function accountOf(address) view returns(address)']),'accountOf',[manifest.demo.owner])),getAddress(vaultAccount))
    assert.equal((await c.getBlock({blockNumber:tip})).hash,manifest.demo.blockHash)
    return p.map(String)
  })
  results.push({host,checkedReceipts:steps.length,checkedRuntimeHashes:4,events,position})
}
console.log(JSON.stringify({label:'Public X Layer testnet 1952. Inventory-backed mock ERC-4626 vault and test tokens.',block:tip.toString(),
  hash:manifest.demo.blockHash,source:manifest.build.sourceCommit,contracts:manifest.contracts,results},null,2))

// Wallet-free read-only diagnostic. Supply the three actual public fabrication receipts to verify Peridot publication.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPublicClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256} from 'viem'

const evidence=JSON.parse(readFileSync(new URL('./proposal-and-fork.json',import.meta.url),'utf8'))
const cpu=evidence.bindings.cpu
const abi=evidence.readOnlyAbi
const client=createPublicClient({transport:http('https://rpc.xlayer.tech')})
const hashes=process.argv.slice(2)
assert.equal(await client.getChainId(),196)
assert(hashes.length===0 || (hashes.length===3 && hashes.every(h=>/^0x[0-9a-f]{64}$/i.test(h)) && new Set(hashes).size===3),
  'Use no arguments for the public vendor diagnostic or pass three distinct confirmed 196 receipt hashes in policy order')
const block=hashes.length ? await client.getBlock({blockTag:'finalized'}) :
  await client.getBlock({blockNumber:BigInt(evidence.pin.number)})
const read=(functionName,args)=>client.readContract({abi,address:cpu,functionName,args,blockNumber:block.number})
assert.equal(keccak256(await client.getCode({address:cpu,blockNumber:block.number})),evidence.bindings.targetHashes[cpu])
const results=[]
if (hashes.length===0) {
  assert.equal(block.hash,evidence.pin.hash)
  const id=1n
  const dimensions=await read('circuitInfo',[id])
  assert.deepEqual(dimensions,[5,42,0,163])
  const owner=await read('ownerOf',[id])
  const netlistHash=keccak256(await read('netlist',[id]))
  const vectors=[]
  for (const inputs of ['0x00','0x01']) {
    const output=await read('eval',[id,inputs])
    vectors.push({inputs,output,data:encodeFunctionData({abi,functionName:'eval',args:[id,inputs]})})
  }
  assert.notEqual(vectors[0].output,vectors[1].output)
  results.push({classification:'Third-party TapeReel circuit; public connectivity example',id,owner,dimensions,netlistHash,vectors})
} else {
  let publisher
  for (const [index,hash] of hashes.entries()) {
    const fixture=evidence.evaluations[index]
    const receipt=await client.getTransactionReceipt({hash})
    const tx=await client.getTransaction({hash})
    const blockAtReceipt=await client.getBlock({blockNumber:receipt.blockNumber})
    assert(receipt.blockNumber<=block.number,'Wait for the receipt to finalize')
    assert.equal(blockAtReceipt.hash,receipt.blockHash)
    assert.equal(receipt.status,'success')
    assert.equal(getAddress(receipt.to),cpu)
    assert.equal(tx.input,evidence.proposedMainnetCalls[index+1].data)
    publisher ??= getAddress(tx.from)
    assert.equal(getAddress(tx.from),publisher)
    const events=receipt.logs.filter(l=>getAddress(l.address)===cpu).flatMap(l=>{
      try { return [decodeEventLog({abi,eventName:'TapedOut',data:l.data,topics:l.topics})] } catch { return [] }
    })
    assert.equal(events.length,1)
    const id=events[0].args.id
    assert.equal(getAddress(events[0].args.owner),publisher)
    const dimensions=await read('circuitInfo',[id])
    assert.deepEqual(dimensions,fixture.dimensions)
    const netlistHash=keccak256(await read('netlist',[id]))
    assert.equal(netlistHash,fixture.netlistHash)
    const owner=await read('ownerOf',[id])
    const vectors=[]
    for (const v of fixture.vectors) {
      const output=await read('eval',[id,v.inputs])
      assert.equal(output,v.output)
      vectors.push({inputs:v.inputs,output,data:encodeFunctionData({abi,functionName:'eval',args:[id,v.inputs]})})
    }
    results.push({label:fixture.label,classification:'Public X Layer 196',transactionHash:hash,receiptBlock:receipt.blockNumber,
      receiptBlockHash:receipt.blockHash,id,publisher,owner,dimensions,netlistHash,vectors})
  }
}
console.log(JSON.stringify({chainId:196,rpc:'https://rpc.xlayer.tech',processor:cpu,block:block.number,blockHash:block.hash,
  mode:hashes.length?'verified public policy publications':'existing third-party diagnostic',results},(_,v)=>typeof v==='bigint'?v.toString():v,2))

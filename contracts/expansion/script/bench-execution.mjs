// Fresh isolated fork only. All transaction transports use this literal loopback URL.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPublicClient,createWalletClient,decodeFunctionResult,encodeFunctionData,http,keccak256,parseAbi} from 'viem'
import {executionCircuit as fixture,encodeSwap} from '../policy/compile.mjs'

const rpc = createPublicClient({transport:http('http://127.0.0.1:19625',{retryCount:0})})
const wallet = createWalletClient({transport:http('http://127.0.0.1:19625',{retryCount:0})})
const publicUrl='https://rpc.xlayer.tech'
const remote=createPublicClient({transport:http(publicUrl,{retryCount:3})})
const fork=await rpc.request({method:'anvil_nodeInfo'})
const pin=76846436n
const block=await remote.getBlock({blockNumber:pin})
assert.equal(await remote.getChainId(),196)
assert.equal(await rpc.getChainId(),31337)
assert.equal(fork.forkConfig.forkUrl,publicUrl)
assert.equal(fork.forkConfig.forkBlockNumber,Number(pin))
assert.equal((await rpc.getBlock()).hash,block.hash,'requires a fresh fork at the canonical block')
const accounts=await wallet.getAddresses()
let actor
for (const address of accounts) {
  if (!await rpc.getCode({address})) { actor=address; break }
}
assert(actor,'fork requires an unlocked ordinary EOA')
const cpu='0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5'
const transistors='0x3896076be165d6a7ec2a70ccf6876673fe245007'
const abi=parseAbi(['function mint(uint256,uint256) payable','function protocolFee() view returns(uint256)','function mintPrice() view returns(uint256)','function TAPEOUT_FEE() view returns(uint256)','function nextId() view returns(uint256)','function tapeout(bytes,uint32,uint32) payable','function netlist(uint256) view returns(bytes)','function eval(uint256,bytes) view returns(bytes)','function circuitInfo(uint256) view returns(uint32,uint32,uint32,uint32)'])
const read=(address,functionName,args=[])=>rpc.readContract({address,abi,functionName,args})
const receipts=[]
async function send(label, request) {
  const estimate=await rpc.estimateGas({account:actor,...request})
  const hash=await wallet.sendTransaction({account:actor,chain:null,...request,gas:estimate+estimate/3n+30_000n})
  const receipt=await rpc.waitForTransactionReceipt({hash,timeout:60_000})
  assert.equal(receipt.status,'success')
  assert.equal((await rpc.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash)
  receipts.push({label,hash,gas:receipt.gasUsed,block:receipt.blockNumber,blockHash:receipt.blockHash})
  return receipt
}
await send('mint NAND on fork',{to:transistors,data:encodeFunctionData({abi,functionName:'mint',args:[0n,BigInt(fixture.gateCount)]}),value:await read(transistors,'protocolFee')+BigInt(fixture.gateCount)*await read(transistors,'mintPrice')})
await send('fabricate EXECUTION on fork',{to:cpu,data:encodeFunctionData({abi,functionName:'tapeout',args:[fixture.netlist,20,1]}),value:await read(cpu,'TAPEOUT_FEE')})
const id=await read(cpu,'nextId')
assert.equal(keccak256(await read(cpu,'netlist',[id])),fixture.netlistHash)
assert.deepEqual(await read(cpu,'circuitInfo',[id]),[20,1,0,fixture.gateCount])
const binding=JSON.parse(readFileSync(new URL('../out/ExecutionPolicy.sol/ExecutionPolicy.json',import.meta.url)))
const {encodeDeployData}=await import('viem')
const bound=(await send('deploy Solidity caller on fork',{data:encodeDeployData({abi:binding.abi,bytecode:binding.bytecode.object,args:[cpu,id]})})).contractAddress
const vectors=[]
for (const [flags,loss,allowed] of [[15,0,true],[15,100,true],[15,101,false],[7,0,false],[15,500,false]]) {
  const context=encodeSwap(flags,loss)
  const tx={to:cpu,account:actor,data:encodeFunctionData({abi,functionName:'eval',args:[id,context]})}
  const output=decodeFunctionResult({abi,functionName:'eval',data:(await rpc.call(tx)).data})
  assert.equal(output,allowed?'0x01':'0x00')
  const call={to:bound,account:actor,data:encodeFunctionData({abi:binding.abi,functionName:'enforceSwap',args:[flags,loss]})}
  if (allowed) await rpc.call(call)
  else await assert.rejects(()=>rpc.call(call),e=>e.message.includes('0x'+keccak256(new TextEncoder().encode('ExecutionPolicyDenied()')).slice(2,10)))
  vectors.push({flags,loss,context,output,evalGas:await rpc.estimateGas(tx),enforceGas:allowed?await rpc.estimateGas(call):null})
}
console.log(JSON.stringify({label:'Anvil 31337 fork of X Layer 196; simulated transactions',pin,pinHash:block.hash,cpu,circuitId:id,...fixture,receipts,vectors},(_,v)=>typeof v==='bigint'?v.toString():v,2))

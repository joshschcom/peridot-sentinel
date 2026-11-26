// Public and testnet transports are read-only. Output files require finalized public receipts.
import assert from 'node:assert/strict'
import {existsSync, renameSync, writeFileSync} from 'node:fs'
import {createPublicClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256, parseAbi} from 'viem'
import {pathToFileURL} from 'node:url'
import {binding,mainnet,packet,readJson,stringify,verifyBindings,verifyCalls} from '../../evidence/session6-d8b/checks.mjs'

const repo=new URL('../../',import.meta.url)
const configPath='packages/chain-config/expansion/tapeout-196.json'
const evidencePath='evidence/session6-d8b/published-196.json'
const cpu=binding.cpu,abi=packet.readOnlyAbi
// The rehearsed packet named the last two event fields incorrectly. The signature is identical.
const tapedOutAbi=parseAbi(['event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)'])
const testnet=createPublicClient({transport:http('https://testrpc.xlayer.tech',{retryCount:3,timeout:12000})})

async function readCircuit(client,address,id,blockNumber,fixture) {
  const read=(functionName,args)=>client.readContract({address,abi,functionName,args,blockNumber})
  const dims=await read('circuitInfo',[id])
  assert.deepEqual(dims,fixture.dimensions,'Circuit shape differs')
  assert.equal(keccak256(await read('netlist',[id])),fixture.netlistHash,'Unexpected instructions')
  const outputs=[]
  for(const {inputs,output} of fixture.vectors){
    const observed=await read('eval',[id,inputs])
    assert((observed==='0x00'||observed==='0x01') && observed===output,'Boundary/parity vector failed')
    outputs.push({inputs,output:observed})
  }
  return outputs
}

async function devReference() {
  const base=readJson('packages/chain-config/deployments/1952.json')
  const v2=readJson('packages/chain-config/expansion/deployments/1952.json')
  assert(base.chainId===1952 && base.profile==='testnet' && base.tapeout.mode==='development-reference')
  assert(v2.chainId===1952 && v2.profile==='1952' && v2.execution.mode==='development-reference')
  assert.equal(await testnet.getChainId(),1952)
  const latest=await testnet.getBlock({blockTag:'latest'})
  const pin=await testnet.getBlock({blockNumber:latest.number-12n})
  const processors=[...['MARKET','ACCOUNT'].map(kind=>{
    const c=base.tapeout.circuits.find(c=>c.kind===kind)
    return {processor:base.tapeout.processor,id:BigInt(c.circuitId),hash:c.netlistHash}
  }),{processor:v2.contracts.cpu,id:BigInt(v2.execution.circuitId),hash:v2.execution.netlistHash}]
  assert.equal(keccak256(await testnet.getCode({address:v2.contracts.cpu,blockNumber:pin.number})),v2.runtimeCodeHashes.cpu)
  const programs=[]
  for(const [i,p] of processors.entries()){
    assert.equal(p.hash,packet.evaluations[i].netlistHash)
    programs.push({...p,vectors:await readCircuit(testnet,p.processor,p.id,pin.number,packet.evaluations[i])})
  }
  assert.equal((await testnet.getBlock({blockNumber:pin.number})).hash,pin.hash)
  return {chainId:1952,mode:'development-reference',block:pin.number,blockHash:pin.hash,programs}
}

export function receiptEvent(receipt,signer,expectedGates) {
  const events=receipt.logs.filter(l=>getAddress(l.address)===cpu).flatMap(l=>{
    try{return [decodeEventLog({abi:tapedOutAbi,eventName:'TapedOut',data:l.data,topics:l.topics,strict:true})]}catch{return []}
  })
  assert.equal(events.length,1,'Expected one CPU TapedOut event')
  const {circuitId,author,gateCount,nState}=events[0].args
  assert.equal(getAddress(author),getAddress(signer),'Wrong circuit author')
  assert.equal(gateCount,expectedGates,'Wrong gate count')
  assert.equal(nState,0,'Expected stateless program')
  return circuitId
}

function save(path,data) {
  const dest=new URL(path,repo)
  const temporary=new URL(path+'.'+process.pid+'.tmp',repo)
  writeFileSync(temporary,stringify(data))
  renameSync(temporary,dest)
}

async function run(hashes) {
  assert([0,3,4].includes(hashes.length) && hashes.every(x=>/^0x[a-f0-9]{64}$/i.test(x)) &&
    new Set(hashes.map(x=>x.toLowerCase())).size===hashes.length,
    'Use [mint-receipt] market-receipt account-receipt execution-receipt, or no arguments for development parity only')
  assert.equal(await mainnet.getChainId(),196)
  const calls=verifyCalls(packet.proposedMainnetCalls)
  const reference=await devReference()
  if(!hashes.length){
    const config=readJson(configPath)
    console.log(stringify({mode:'Development parity only; no public receipts supplied or configuration written',
      publicConfigStatus:config.status,development:reference}))
    return
  }

  const final=await mainnet.getBlock({blockTag:'finalized'})
  const receipts=await Promise.all(hashes.map(hash=>mainnet.getTransactionReceipt({hash})))
  const pinnedNumber=receipts.at(-1).blockNumber
  assert(pinnedNumber<=final.number,'Wait for all publication receipts to finalize')
  const pin=await mainnet.getBlock({blockNumber:pinnedNumber})
  const bindings=await verifyBindings(pin.number)
  const config=readJson(configPath)
  assert.equal(config.chainId,196);assert.equal(getAddress(config.processor),cpu)
  assert.equal(config.circuits.length,3)
  const sender=getAddress(receipts[0].from)
  const skip=4-hashes.length
  const programs=[]
  for(const [i,receipt] of receipts.entries()){
    const tx=await mainnet.getTransaction({hash:hashes[i]})
    const call=calls[i+skip]
    assert.equal(tx.chainId,196);assert.equal(receipt.status,'success')
    assert.equal(receipt.transactionHash.toLowerCase(),hashes[i].toLowerCase())
    assert.equal(getAddress(receipt.to),getAddress(call.to));assert.equal(getAddress(tx.to),getAddress(call.to))
    assert.equal(getAddress(tx.from),sender);assert.equal(getAddress(receipt.from),sender)
    assert.equal(tx.input,call.data);assert.equal(tx.value,BigInt(call.value))
    assert.equal(tx.type,'eip1559');assert.equal(tx.gas,BigInt(call.gas))
    assert.equal(tx.maxFeePerGas,BigInt(call.maxFeePerGas));assert.equal(tx.maxPriorityFeePerGas,BigInt(call.maxPriorityFeePerGas))
    assert.deepEqual(tx.accessList,[])
    assert.equal(receipt.blockHash,(await mainnet.getBlock({blockNumber:receipt.blockNumber})).hash)
    if(i) assert(receipt.blockNumber>receipts[i-1].blockNumber ||
      (receipt.blockNumber===receipts[i-1].blockNumber && receipt.transactionIndex>receipts[i-1].transactionIndex),'Receipt order differs')
    assert(!receipt.logs.some(l=>getAddress(l.address)===binding.factoryState.bem),'Unexpected BEM event')
    if(i+skip===0) continue
    const n=i+skip-1,fixture=packet.evaluations[n]
    const id=receiptEvent(receipt,sender,fixture.dimensions[3])
    assert(!programs.some(p=>p.id===id),'Repeated circuit ID')
    assert.equal(config.circuits[n].netlistHash,fixture.netlistHash)
    const native=await readCircuit(mainnet,cpu,id,pin.number,fixture)
    assert.deepEqual(native,reference.programs[n].vectors,'Native and development processors differ')
    const vectors=[]
    for(const v of native){
      const data=encodeFunctionData({abi,functionName:'eval',args:[id,v.inputs]})
      const estimate=await mainnet.estimateGas({to:cpu,data,blockNumber:pin.number,account:sender})
      vectors.push({...v,evalGasEstimate:estimate,calldata:data})
    }
    programs.push({kind:config.circuits[n].kind,id,netlistHash:fixture.netlistHash,dimensions:fixture.dimensions,
      publisher:sender,ownerAtPin:await mainnet.readContract({address:cpu,abi,functionName:'ownerOf',args:[id],blockNumber:pin.number}),
      transactionHash:receipt.transactionHash,receiptBlock:receipt.blockNumber,receiptBlockHash:receipt.blockHash,
      gasUsed:receipt.gasUsed,vectors})
    const existing=config.circuits[n]
    assert(existing.publicReceipt===null || existing.publicReceipt===receipt.transactionHash,'Different publication is already pinned')
    assert(existing.publishedId===null || String(existing.publishedId)===String(id),'Different circuit ID is already pinned')
    existing.publishedId=String(id);existing.publicReceipt=receipt.transactionHash
  }
  assert.equal((await mainnet.getBlock({blockNumber:pin.number})).hash,pin.hash)
  const evidence={mode:'Finalized public X Layer 196 publication',chainId:196,processor:cpu,block:pin.number,blockHash:pin.hash,
    finalizedThroughAtVerification:final.number,mintReceipt:skip===0?hashes[0]:null,binding:bindings,programs,development:reference}
  if(existsSync(new URL(evidencePath,repo))){
    const previous=readJson(evidencePath)
    assert.deepEqual(previous.programs.map(p=>p.transactionHash),programs.map(p=>p.transactionHash),'Conflicting existing evidence')
  } else save(evidencePath,evidence)
  Object.assign(config,{status:'published',verifiedBlock:String(pin.number),verifiedBlockHash:pin.hash,evidence:evidencePath})
  save(configPath,config)
  console.log(stringify({publicConfig:configPath,evidence:evidencePath,block:pin.number,circuits:config.circuits}))
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) await run(process.argv.slice(2))

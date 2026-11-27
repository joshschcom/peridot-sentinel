// Public writes to disk require finalized receipts from both public hosts. Fork output is isolated.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {dirname} from 'node:path'
import {parseArgs} from 'node:util'
import {checkedPath,configPath,forkReader,forkStatus,loadData,publicationFork,publicWitness,saveData} from '../../contracts/expansion/script/native7/publication-io.mjs'
import {createPublicClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256, parseAbi} from 'viem'
import {pathToFileURL} from 'node:url'
import {abi as sponsorAbi,binding,mainnet,packet,readJson,stringify,verifyBindings,verifyCalls} from '../../evidence/session6-d8b/checks.mjs'

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

export function destinations(args) {
  const {values,positionals:hashes}=parseArgs({args,allowPositionals:true,options:{
    published:{type:'boolean'},fork:{type:'boolean'},out:{type:'string'}
  }})
  if(!hashes.length){
    assert(!values.published && !values.fork && !values.out,'Supply receipts for publication verification')
    return {hashes}
  }
  assert(Boolean(values.published)!==Boolean(values.fork),'Select exactly one of --published or --fork')
  const output=values.out ?? (values.published?configPath:undefined)
  checkedPath(output,{canonical:values.published===true})
  const evidence=output===configPath?'evidence/session9-native/publication-196.json':dirname(output)+'/verified-receipts.json'
  checkedPath(evidence)
  assert.notEqual(output,evidence,'Config and evidence destinations must differ')
  return {hashes,fork:values.fork===true,output,evidence}
}

async function run(options) {
  const {hashes,fork,output,evidence:evidencePath}=options
  const client=fork?forkReader:mainnet
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

  const origin=fork?await publicationFork():null
  const final=await client.getBlock({blockTag:fork?'latest':'finalized'})
  const receipts=await Promise.all(hashes.map(hash=>client.getTransactionReceipt({hash})))
  const pinnedNumber=receipts.at(-1).blockNumber
  assert(pinnedNumber<=final.number,'Wait for all publication receipts to finalize')
  const pin=await client.getBlock({blockNumber:pinnedNumber})
  if(fork)assert(BigInt(origin.originBlock)<receipts[0].blockNumber && final.number>=pin.number+12n,'Expected local receipts with twelve successors')
  else {
    assert.equal(await publicWitness.getChainId(),196)
    const witnessHead=await publicWitness.getBlock({blockTag:'finalized'})
    assert(witnessHead.number>=pin.number && (await publicWitness.getBlock({blockNumber:pin.number})).hash===pin.hash,'Public witnesses disagree on finalized publication')
  }
  const bindings=await verifyBindings(fork?BigInt(origin.originBlock):pin.number)
  if(fork){
    const read=(address,functionName,args=[])=>client.readContract({address,abi:sponsorAbi,functionName,args,blockNumber:pin.number})
    const observed=await Promise.all([read(binding.factory,'isCPU',[cpu]),read(binding.factory,'cpuAt',[410n]),
      read(cpu,'transistors'),read(binding.beacon,'implementation'),read(binding.beacon,'owner'),read(binding.factory,'owner'),read(binding.factory,'isSealed'),
      client.getStorageAt({address:binding.factory,slot:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',blockNumber:pin.number}),
      client.getStorageAt({address:cpu,slot:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',blockNumber:pin.number})])
    assert.deepEqual(observed,[true,cpu,bindings.components,bindings.beaconImpl,bindings.beaconOwner,bindings.factoryOwner,bindings.sealed,
      binding.erc1967FactoryImplementationWord,binding.erc1967CpuBeaconWord],'Private publication changed sponsor bindings')
    for(const [address,hash] of Object.entries(bindings.codeHashes)){
      assert.equal(keccak256(await client.getCode({address,blockNumber:pin.number})),hash)
    }
  }
  const config=readJson(configPath)
  if(fork)for(const c of config.circuits){c.publishedId=null;c.publicReceipt=null}
  assert.equal(config.chainId,196);assert.equal(getAddress(config.processor),cpu)
  assert.equal(config.circuits.length,3)
  const sender=getAddress(receipts[0].from)
  const skip=4-hashes.length
  const programs=[]
  for(const [i,receipt] of receipts.entries()){
    const tx=await client.getTransaction({hash:hashes[i]})
    if(!fork){
      const witness=await publicWitness.getTransactionReceipt({hash:hashes[i]})
      assert.equal(witness.status,'success')
      assert.equal(witness.blockHash,receipt.blockHash)
      assert.equal(witness.transactionHash,receipt.transactionHash)
      assert.deepEqual(witness.logs.map(l=>[l.address,l.topics,l.data]),receipt.logs.map(l=>[l.address,l.topics,l.data]))
    }
    const call=calls[i+skip]
    assert.equal(tx.chainId,fork?31337:196);assert.equal(receipt.status,'success')
    assert.equal(receipt.transactionHash.toLowerCase(),hashes[i].toLowerCase())
    assert.equal(getAddress(receipt.to),getAddress(call.to));assert.equal(getAddress(tx.to),getAddress(call.to))
    assert.equal(getAddress(tx.from),sender);assert.equal(getAddress(receipt.from),sender)
    assert.equal(tx.input,call.data);assert.equal(tx.value,BigInt(call.value))
    assert.equal(tx.type,'eip1559');assert.equal(tx.gas,BigInt(call.gas))
    assert.equal(tx.maxFeePerGas,BigInt(call.maxFeePerGas));assert.equal(tx.maxPriorityFeePerGas,BigInt(call.maxPriorityFeePerGas))
    assert.deepEqual(tx.accessList,[])
    assert.equal(receipt.blockHash,(await client.getBlock({blockNumber:receipt.blockNumber})).hash)
    if(i) assert(receipt.blockNumber>receipts[i-1].blockNumber ||
      (receipt.blockNumber===receipts[i-1].blockNumber && receipt.transactionIndex>receipts[i-1].transactionIndex),'Receipt order differs')
    assert(!receipt.logs.some(l=>getAddress(l.address)===binding.factoryState.bem),'Unexpected BEM event')
    if(i+skip===0) continue
    const n=i+skip-1,fixture=packet.evaluations[n]
    const id=receiptEvent(receipt,sender,fixture.dimensions[3])
    assert(!programs.some(p=>p.id===id),'Repeated circuit ID')
    assert.equal(config.circuits[n].netlistHash,fixture.netlistHash)
    const native=await readCircuit(client,cpu,id,pin.number,fixture)
    assert.deepEqual(native,reference.programs[n].vectors,'Native and development processors differ')
    const vectors=[]
    for(const v of native){
      const data=encodeFunctionData({abi,functionName:'eval',args:[id,v.inputs]})
      const estimate=await client.estimateGas({to:cpu,data,blockNumber:pin.number,account:sender})
      vectors.push({...v,evalGasEstimate:estimate,calldata:data})
    }
    const ownerAtPin=await client.readContract({address:cpu,abi,functionName:'ownerOf',args:[id],blockNumber:pin.number})
    assert.equal(getAddress(ownerAtPin),sender,'Expected publisher to own circuit at publication block')
    programs.push({kind:config.circuits[n].kind,id,netlistHash:fixture.netlistHash,dimensions:fixture.dimensions,
      publisher:sender,ownerAtPin,
      transactionHash:receipt.transactionHash,receiptBlock:receipt.blockNumber,receiptBlockHash:receipt.blockHash,
      gasUsed:receipt.gasUsed,vectors})
    const existing=config.circuits[n]
    assert(existing.publicReceipt===null || existing.publicReceipt===receipt.transactionHash,'Different publication is already pinned')
    assert(existing.publishedId===null || String(existing.publishedId)===String(id),'Different circuit ID is already pinned')
    existing.publishedId=String(id);existing.publicReceipt=receipt.transactionHash
  }
  assert.equal((await client.getBlock({blockNumber:pin.number})).hash,pin.hash)
  const evidence={mode:fork?'FORK ONLY: simulated publication on a private Anvil fork of X Layer':'Finalized public X Layer 196 publication',chainId:fork?31337:196,...(fork?{origin}:{}),processor:cpu,block:pin.number,blockHash:pin.hash,
    ...(fork?{observedForkHead:final.number,localSuccessors:final.number-pin.number}:{finalizedThroughAtVerification:final.number}),mintReceipt:skip===0?hashes[0]:null,binding:bindings,programs,development:reference}
  if(existsSync(checkedPath(evidencePath))){
    const previous=loadData(evidencePath)
    assert.equal(previous.mode,evidence.mode)
    assert.deepEqual(previous.programs.map(p=>p.transactionHash),programs.map(p=>p.transactionHash),'Conflicting existing evidence; select a fresh run directory')
    assert.equal(previous.blockHash,pin.hash)
  } else saveData(evidencePath,evidence)
  Object.assign(config,{status:fork?forkStatus:'published',verifiedBlock:String(pin.number),verifiedBlockHash:pin.hash,evidence:evidencePath})
  if(fork)Object.assign(config,{chainId:31337,mode:'fork-only',rpcUrl:origin.url,origin})
  if(output!==configPath && existsSync(checkedPath(output))){
    assert.deepEqual(loadData(output),config,'Output already holds different content; select a fresh run directory')
  } else saveData(output,config,{canonical:!fork})
  console.log(stringify({config:output,evidence:evidencePath,mode:evidence.mode,block:pin.number,circuits:config.circuits}))
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) await run(destinations(process.argv.slice(2)))

// Run against a fresh fork on port 19627. The public transport has no wallet client.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatEther,
  formatUnits, getAddress, http, keccak256, numberToHex, parseAbi, size,
} from 'viem'
import { encodeSwap, executionCircuit } from '../../contracts/expansion/policy/compile.mjs'

const upstream = 'https://rpc.xlayer.tech'
const loopback = 'http://127.0.0.1:19627'
const pin = 76931874n
const pinHash = '0x69209f9c7d765066eef82ee9bb53ba50eaea6d29ee33ff521908d2c81f0da16b'
const local = createPublicClient({transport: http(loopback)})
const wallet = createWalletClient({transport: http(loopback)})
const remote = createPublicClient({transport: http(upstream)})
const info = await local.request({method:'anvil_nodeInfo'})
const client = await local.request({method:'web3_clientVersion'})
assert.match(client,/^anvil\//)
assert.equal(await local.getChainId(),31337)
assert.equal(info.forkConfig.forkUrl,upstream)
assert.equal(BigInt(info.forkConfig.forkBlockNumber),pin)
assert.equal(BigInt(info.currentBlockNumber),pin)
assert.equal(info.currentBlockHash,pinHash)
assert.equal(await remote.getChainId(),196)
const header = await remote.getBlock({blockNumber:pin})
assert.equal(header.hash,pinHash)

const cpu = getAddress('0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5')
const components = getAddress('0x3896076be165d6a7ec2a70ccf6876673fe245007')
const factory = getAddress('0x1f09daefa827f02cbb40967cc91b259763760761')
const beacon = getAddress('0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c')
const oracle = getAddress('0x420000000000000000000000000000000000000f')
const priceFeed = getAddress('0x4ff345b18a2bf894f8627f41501fbf30d5c5e7be')
const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const beaconSlot = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
const readAbi = [
  'function circuitInfo(uint256 id) view returns (uint32 nIn,uint32 nOut,uint32 nState,uint32 gateCount)',
  'function netlist(uint256 id) view returns (bytes)', 'function eval(uint256 id,bytes inputs) view returns (bytes)',
  'function ownerOf(uint256 id) view returns (address)',
  'event TapedOut(uint256 indexed id,address indexed owner,uint32 nIn,uint32 nOut)',
]
const abi = parseAbi([...readAbi,
  'function cpuAt(uint256) view returns (address)', 'function isCPU(address) view returns (bool)',
  'function transistors() view returns (address)', 'function name() view returns (string)',
  'function bem() view returns (address)', 'function isSealed() view returns (bool)',
  'function implementation() view returns (address)', 'function owner() view returns (address)',
  'function NAND() view returns (uint256)', 'function mintPrice() view returns (uint256)',
  'function protocolFee() view returns (uint256)', 'function supplyCap() view returns (uint256)',
  'function minted() view returns (uint256)', 'function nextId() view returns (uint256)',
  'function balanceOf(address,uint256) view returns (uint256)', 'function TAPEOUT_FEE() view returns (uint256)',
  'function mint(uint256,uint256) payable', 'function tapeout(bytes,uint32,uint32) payable',
  'function baseFeeScalar() view returns (uint32)', 'function blobBaseFeeScalar() view returns (uint32)',
  'function getL1FeeUpperBound(uint256) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)',
  'function decimals() view returns (uint8)', 'function description() view returns (string)',
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
])
const read = (address,functionName,args=[]) => local.readContract({address,abi,functionName,args})
const atPin = (address,functionName,args=[]) => remote.readContract({address,abi,functionName,args,blockNumber:pin})
const data = (functionName,args) => encodeFunctionData({abi,functionName,args})
const readJson = relative => JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'))
const lending = readJson('../../packages/circuit-sdk/fixtures/policies-v1.json').policies
const execution = readJson('../../contracts/expansion/policy/execution.json')
assert.deepEqual(execution,executionCircuit)
const programs = [
  {...lending[0],label:'Market Policy V1',limit:520000n},
  {...lending[1],label:'Sentinel Policy V1',limit:580000n},
  {...execution,label:'Expanded Sentinel Policy V2 (EXECUTION)',limit:520000n,vectors:[
    ...[[15,0,true],[15,99,true],[15,100,true],[15,101,false],[15,500,false],
      [14,0,false],[13,0,false],[11,0,false],[7,0,false]].map(([checks,lossBps,allow])=>({
        context:{checks,lossBps}, inputs:encodeSwap(checks,lossBps), output:allow?'0x01':'0x00'})),
    {context:{reason:'reserved bit 18 set'},inputs:'0xf50004',output:'0x00'},
    {context:{reason:'wrong operation'},inputs:'0xf40000',output:'0x00'},
  ]},
]
assert.deepEqual(programs.map(p=>p.gateCount),[63,87,59])
const gates = programs.reduce((sum,p)=>sum+BigInt(p.gateCount),0n)
for (const p of programs) {
  assert.equal(keccak256(p.netlist),p.netlistHash)
  assert.equal(size(p.netlist),p.gateCount*7)
}

const inspect = async (address,names) => Object.fromEntries(await Promise.all(names.map(async name=>[name,await atPin(address,name)])))
const factoryState = await inspect(factory,['isSealed','owner','bem'])
const componentState = await inspect(components,['NAND','mintPrice','protocolFee','supplyCap','minted'])
const cpuState = await inspect(cpu,['TAPEOUT_FEE','name','nextId','transistors'])
assert.equal(await atPin(factory,'cpuAt',[410n]),cpu)
assert.equal(await atPin(factory,'isCPU',[cpu]),true)
assert.equal(cpuState.transistors,components)
assert.equal(componentState.NAND,0n)
assert(componentState.supplyCap-componentState.minted>=gates)
const [factoryImpl,cpuBeacon,beaconState,oracleState,feedState] = await Promise.all([
  remote.getStorageAt({address:factory,slot:implementationSlot,blockNumber:pin}),
  remote.getStorageAt({address:cpu,slot:beaconSlot,blockNumber:pin}),
  inspect(beacon,['owner','implementation']),inspect(oracle,['baseFeeScalar','blobBaseFeeScalar']),
  inspect(priceFeed,['description','decimals','latestRoundData']),
])
assert.equal(getAddress('0x'+cpuBeacon.slice(-40)),beacon)
const targetHashes = {}
for (const address of [factory,getAddress('0x'+factoryImpl.slice(-40)),cpu,beacon,beaconState.implementation,components,oracle,priceFeed]) {
  targetHashes[address] = keccak256(await remote.getCode({address,blockNumber:pin}))
}
const [,price,,updatedAt,answeredInRound] = feedState.latestRoundData
assert(feedState.latestRoundData[0]===answeredInRound && price>0n && updatedAt<=header.timestamp &&
       header.timestamp-updatedAt<=86400n && feedState.description==='OKB / USD' && feedState.decimals===8)

let actor
const erc20 = parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'])
for (const address of await wallet.getAddresses()) {
  if (await local.getCode({address})) continue
  if (await local.readContract({abi:erc20,address:factoryState.bem,functionName:'balanceOf',args:[address]})!==0n) continue
  if (await read(components,'balanceOf',[address,0n])!==0n) continue
  actor=address
  break
}
assert(actor,'fork requires an unlocked EOA with zero NAND and BEM')
async function bemState() {
  const check = (functionName,args)=>local.readContract({abi:erc20,address:factoryState.bem,functionName,args})
  return {balance:await check('balanceOf',[actor]),componentAllowance:await check('allowance',[actor,components]),
    cpuAllowance:await check('allowance',[actor,cpu])}
}
const bemBefore=await bemState()
assert.deepEqual(bemBefore,{balance:0n,componentAllowance:0n,cpuAllowance:0n})

const calls = [{label:'Mint 209 NAND',to:components,value:componentState.protocolFee+gates*componentState.mintPrice,
  data:data('mint',[componentState.NAND,gates]),limit:120000n},...programs.map(p=>({
    label:p.label,to:cpu,value:cpuState.TAPEOUT_FEE,data:data('tapeout',[p.netlist,20,1]),limit:p.limit,program:p,
  }))]
const priority = 1n
const maxFee = 50000000n
const quotedGasPrice = header.baseFeePerGas+priority
assert(quotedGasPrice<=maxFee)
const observedRpcPrice = await remote.getGasPrice()
const observedRpcTip = BigInt(await remote.request({method:'eth_maxPriorityFeePerGas'}))
const feeObservationHead = await remote.getBlockNumber()
const receipts=[], unsigned=[], evaluations=[]
let remaining=0n
let gasSum=0n, limitSum=0n, l1Sum=0n, operatorSum=0n, valueSum=0n, actualOperatorSum=0n
for (const c of calls) {
  // 200 bytes covers this EIP-1559 envelope, nonce, empty access list and signature.
  const bytesUpperBound=BigInt(size(c.data)+200)
  const [l1,operatorFee]=await Promise.all([atPin(oracle,'getL1FeeUpperBound',[bytesUpperBound]),atPin(oracle,'getOperatorFee',[c.limit])])
  const fields={to:c.to,data:c.data,value:c.value,gas:c.limit,maxFeePerGas:maxFee,maxPriorityFeePerGas:priority,accessList:[]}
  unsigned.push({label:c.label,chainId:'0xc4',type:'0x2',to:c.to,data:c.data,value:numberToHex(c.value),
    gas:numberToHex(c.limit),maxFeePerGas:numberToHex(maxFee),maxPriorityFeePerGas:numberToHex(priority),accessList:[]})
  const estimated=await local.estimateGas({account:actor,...fields})
  assert(estimated<=c.limit)
  const hash=await wallet.sendTransaction({account:actor,chain:null,type:'eip1559',...fields})
  const receipt=await local.waitForTransactionReceipt({hash,timeout:60000})
  assert.equal(receipt.status,'success')
  assert.equal((await local.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash)
  const nandAfter=await read(components,'balanceOf',[actor,componentState.NAND])
  const transfer=receipt.logs.filter(log=>log.address.toLowerCase()===factoryState.bem.toLowerCase())
  assert.equal(transfer.length,0)
  remaining+=c.program ? -BigInt(c.program.gateCount) : gates
  assert.equal(nandAfter,remaining)
  if (c.program) {
    const tape=receipt.logs.filter(l=>l.address.toLowerCase()===cpu.toLowerCase()).flatMap(l=>{
      try {return [decodeEventLog({abi:parseAbi([readAbi[4]]),data:l.data,topics:l.topics})]} catch {return []}
    })
    assert.equal(tape.length,1)
    const id=tape[0].args.id, owner=await read(cpu,'ownerOf',[id])
    assert.equal(getAddress(tape[0].args.owner),getAddress(actor))
    assert.equal(owner,getAddress(actor))
    const dimensions=await read(cpu,'circuitInfo',[id])
    assert.deepEqual(dimensions,[20,1,0,c.program.gateCount])
    assert.equal(await read(cpu,'netlist',[id]),c.program.netlist)
    const vectors=[]
    for (const v of c.program.vectors) {
      const call={to:cpu,data:data('eval',[id,v.inputs])}
      const result=await read(cpu,'eval',[id,v.inputs])
      assert.equal(result,v.output)
      vectors.push({...v,observedOutput:result,localEvalCalldata:call.data,
        localEvalGasEstimate:await local.estimateGas({account:actor,...call})})
    }
    evaluations.push({label:c.label,publicCircuitId:null,forkCircuitId:id,dimensions,owner,netlistHash:c.program.netlistHash,vectors})
  }
  const paidOperator=await atPin(oracle,'getOperatorFee',[receipt.gasUsed])
  receipts.push({label:c.label,simulation:'anvil fork 31337',hash,block:receipt.blockNumber,blockHash:receipt.blockHash,status:receipt.status,
    valueWei:c.value,gasUsed:receipt.gasUsed,estimatedGas:estimated,gasLimit:c.limit,l1UpperBoundBytes:bytesUpperBound,
    l1UpperBoundWei:l1,operatorFeeAtGasLimitWei:operatorFee,operatorFeeAtMeasuredGasWei:paidOperator,nandBalanceAfter:nandAfter,logs:receipt.logs})
  gasSum+=receipt.gasUsed; limitSum+=c.limit; l1Sum+=l1; operatorSum+=operatorFee; actualOperatorSum+=paidOperator; valueSum+=c.value
}
assert.equal(remaining,0n)
const bemAfter=await bemState()
assert.deepEqual(bemBefore,bemAfter)
const estimateWei=valueSum+gasSum*quotedGasPrice+l1Sum+actualOperatorSum
const ceilingWei=valueSum+limitSum*maxFee+l1Sum+operatorSum
const toUSD=wei=>formatUnits(wei*price,18+feedState.decimals)
const output={
  classification:'Unsigned 196 proposal; all transactions/evaluations below ran only on local chain 31337',
  pin:{upstream,chainId:196,number:pin,hash:pinHash,unix:header.timestamp,utc:new Date(Number(header.timestamp)*1000).toISOString(),
    baseFeeWei:header.baseFeePerGas,forkChainId:31337,anvilVersion:client,simulationSender:actor},
  bindings:{factory,index:410,cpu,components,beacon,gasOracle:oracle,priceFeed,erc1967FactoryImplementationWord:factoryImpl,
    erc1967CpuBeaconWord:cpuBeacon,targetHashes,factoryState,componentState,cpuState,beaconState,oracleState,feedState,
    priceAgeSeconds:header.timestamp-updatedAt,usdPerOkb:formatUnits(price,feedState.decimals),bemBefore,bemAfter},
  costs:{nativeProtocolValuesWei:valueSum,gasUsedTotal:gasSum,gasLimitTotal:limitSum,quotedExecutionGasPriceWei:quotedGasPrice,
    observedRpcPrice,observedRpcTip,feeObservationHead,maxFeePerGasWei:maxFee,priorityFeeWei:priority,
    l1UpperBoundTotalWei:l1Sum,operatorBoundTotalWei:operatorSum,estimatedTotalWei:estimateWei,estimatedOKB:formatEther(estimateWei),
    estimatedUSD:toUSD(estimateWei),conditionalMaximumWei:ceilingWei,conditionalMaximumOKB:formatEther(ceilingWei),conditionalUSD:toUSD(ceilingWei)},
  proposedMainnetCalls:unsigned,forkRehearsal:receipts,readOnlyAbi:parseAbi(readAbi),evaluations,
}
console.log(JSON.stringify(output,(_,v)=>typeof v==='bigint'?v.toString():v,2))

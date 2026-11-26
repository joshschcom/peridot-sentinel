// No wallet client or signer. Public reads are fixed to the X Layer endpoints below.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createPublicClient, encodeFunctionData, formatEther, getAddress, http, keccak256, parseAbi, size} from 'viem'

const repo=new URL('../../',import.meta.url)
export const readJson=path=>JSON.parse(readFileSync(new URL(path,repo),'utf8'))
const packetBytes=readFileSync(new URL('evidence/session5-d8b/proposal-and-fork.json',repo))
const packetHash=createHash('sha256').update(packetBytes).digest('hex')
assert.equal(packetHash,'af5ac98cb1c7ea91cada427a256d4fd7cfdcad972d1ed327bb05f772734ed074','Unexpected founder packet; re-review')
export const packet=JSON.parse(packetBytes)
export const binding=packet.bindings
export const stringify=o=>JSON.stringify(o,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n'
export const mainnet=createPublicClient({transport:http('https://rpc.xlayer.tech',{retryCount:3,timeout:12000})})
export const abi=parseAbi([
  'function cpuAt(uint256) view returns(address)','function isCPU(address) view returns(bool)',
  'function transistors() view returns(address)','function implementation() view returns(address)',
  'function owner() view returns(address)','function isSealed() view returns(bool)','function NAND() view returns(uint256)',
  'function minted() view returns(uint256)','function supplyCap() view returns(uint256)','function protocolFee() view returns(uint256)',
  'function mintPrice() view returns(uint256)','function TAPEOUT_FEE() view returns(uint256)',
  'function getL1FeeUpperBound(uint256) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)',
  'function mint(uint256,uint256) payable','function tapeout(bytes,uint32,uint32) payable',
])
const implementationSlot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const beaconSlot='0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
const ceilingWei=4647000000000000n
const templates=[...readJson('packages/circuit-sdk/fixtures/policies-v1.json').policies,readJson('contracts/expansion/policy/execution.json')]
const read=(blockNumber,address,functionName,args=[])=>mainnet.readContract({abi,blockNumber,address,functionName,args})

export async function verifyBindings(at) {
  const b=binding
  await Promise.all(Object.entries(b.targetHashes).map(async ([address,expected])=>{
    const code=await mainnet.getCode({address,blockNumber:at})
    assert(code && keccak256(code)===expected,'Code hash changed at '+address)
  }))
  const [factoryImpl,cpuBeacon,beaconImpl,beaconOwner,member,indexed,components,factoryOwner,sealed]=await Promise.all([
    mainnet.getStorageAt({address:b.factory,slot:implementationSlot,blockNumber:at}),
    mainnet.getStorageAt({address:b.cpu,slot:beaconSlot,blockNumber:at}),read(at,b.beacon,'implementation'),read(at,b.beacon,'owner'),
    read(at,b.factory,'isCPU',[b.cpu]),read(at,b.factory,'cpuAt',[410n]),read(at,b.cpu,'transistors'),read(at,b.factory,'owner'),read(at,b.factory,'isSealed'),
  ])
  assert.equal(factoryImpl,b.erc1967FactoryImplementationWord)
  assert.equal(cpuBeacon,b.erc1967CpuBeaconWord)
  assert.equal(beaconImpl,b.beaconState.implementation)
  assert.equal(beaconOwner,b.beaconState.owner)
  assert.equal(factoryOwner,b.factoryState.owner)
  assert.equal(sealed,b.factoryState.isSealed)
  assert(member && indexed===b.cpu && components===b.components,'CPU membership or component binding changed')
  return {factory:b.factory,cpuIndex:410,cpu:b.cpu,components,beacon:b.beacon,beaconImpl,beaconOwner,factoryImpl,factoryOwner,sealed,codeHashes:b.targetHashes}
}

export function verifyCalls(calls) {
  assert.equal(calls.length,4)
  const gas=[120000n,520000n,580000n,520000n]
  for (const [i,c] of calls.entries()) {
    assert.deepEqual(Object.keys(c).sort(),['label','chainId','type','to','data','value','gas','maxFeePerGas','maxPriorityFeePerGas','accessList'].sort())
    assert.equal(c.chainId,'0xc4');assert.equal(c.type,'0x2');assert.deepEqual(c.accessList,[])
    assert.equal(BigInt(c.maxFeePerGas),50_000_000n);assert.equal(BigInt(c.maxPriorityFeePerGas),1n)
    assert.equal(BigInt(c.gas),gas[i])
    assert.equal(getAddress(c.to),i===0?binding.components:binding.cpu)
    assert.equal(BigInt(c.value),i===0?660000000000000n:1300000000000000n)
    const program=templates[i-1]
    if(i>0){
      assert.equal(keccak256(program.netlist),packet.evaluations[i-1].netlistHash)
      assert.equal(size(program.netlist),[63,87,59][i-1]*7)
    }
    const expected=i===0?encodeFunctionData({abi,functionName:'mint',args:[0n,209n]}):
      encodeFunctionData({abi,functionName:'tapeout',args:[program.netlist,20,1]})
    assert.equal(c.data,expected,'Unexpected selector, ABI arguments or trailing data')
  }
  return calls
}

export async function preSign(senderAddress) {
  assert.equal(await mainnet.getChainId(),196)
  const block=await mainnet.getBlock({blockTag:'latest'})
  const now=BigInt(Math.floor(Date.now()/1000))
  assert(now>=block.timestamp-15n && now-block.timestamp<=120n,'RPC head is stale')
  const at=block.number
  const calls=verifyCalls(packet.proposedMainnetCalls)
  const checks=await verifyBindings(at)
  const b=binding
  const [nand,cap,minted,batchFee,unit,fabricationFee]=await Promise.all([
    read(at,b.components,'NAND'),read(at,b.components,'supplyCap'),read(at,b.components,'minted'),
    read(at,b.components,'protocolFee'),read(at,b.components,'mintPrice'),read(at,b.cpu,'TAPEOUT_FEE'),
  ])
  assert(nand===0n && cap-minted>=209n,'Insufficient NAND capacity or wrong component')
  assert.equal(batchFee+209n*unit,BigInt(calls[0].value),'Component fee changed')
  assert.equal(fabricationFee,BigInt(calls[1].value),'Fabrication fee changed')
  const rows=await Promise.all(calls.map(async c=>{
    const gas=BigInt(c.gas),maxFee=BigInt(c.maxFeePerGas)
    assert(block.baseFeePerGas!=null && block.baseFeePerGas+BigInt(c.maxPriorityFeePerGas)<=maxFee,'Base fee exceeds envelope')
    const [l1,operator]=await Promise.all([read(at,b.gasOracle,'getL1FeeUpperBound',[BigInt(size(c.data)+200)]),
      read(at,b.gasOracle,'getOperatorFee',[gas])])
    return {label:c.label,to:c.to,selector:c.data.slice(0,10),dataHash:keccak256(c.data),valueWei:BigInt(c.value),
      gas,executionUpperWei:gas*maxFee,l1UpperWei:l1,operatorUpperWei:operator,maxWei:BigInt(c.value)+gas*maxFee+l1+operator}
  }))
  const upperWei=rows.reduce((a,c)=>a+c.maxWei,0n)
  assert(upperWei<=ceilingWei,'Current fee bounds exceed the approved total ceiling')
  let sender=null
  if(senderAddress){
    assert(/^0x[0-9a-fA-F]{40}$/.test(senderAddress),'Use a public 20-byte sender address')
    const address=getAddress(senderAddress)
    assert(!await mainnet.getCode({address,blockNumber:at}),'Rehearsal requires ordinary EOA')
    const balance=await mainnet.getBalance({address,blockNumber:at})
    assert(balance>=ceilingWei,'Insufficient sender balance')
    sender={address,balanceWei:balance}
  }
  assert.equal((await mainnet.getBlock({blockNumber:at})).hash,block.hash,'Pinned block changed')
  return {mode:'read-only pre-sign verification; no transaction submitted',chainId:196,blockNumber:at,blockHash:block.hash,
    utc:new Date(Number(block.timestamp)*1000).toISOString(),reviewedPacketSha256:packetHash,sender,
    binding:checks,netlistHashes:packet.evaluations.map(x=>x.netlistHash),fees:{batchFee,unit,fabricationFee,baseFeePerGas:block.baseFeePerGas},
    components:{id:nand,cap,minted,available:cap-minted,needed:209},calls:rows,upperWei,ceilingWei,upperOKB:formatEther(upperWei)}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  assert(process.argv.length<=3,'Usage: D8b-presign-check.sh [public-sender-address]')
  console.log(stringify(await preSign(process.argv[2])))
}

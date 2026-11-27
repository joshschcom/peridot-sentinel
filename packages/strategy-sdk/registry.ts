import {
  encodeAbiParameters, encodeFunctionData, getAddress, getAbiItem, hexToBytes,
  isAddress, keccak256, parseAbi, stringToHex, zeroAddress, zeroHash,
} from 'viem'
import type {Address, Hex, PublicClient} from 'viem'
import {importStrategy} from './validate.ts'
import type {Strategy} from './validate.ts'

export const registryAbi = parseAbi([
  'function publish(bytes32 seriesId,uint32 expectedVersion,uint256 targetChainId,bytes32 adapterVersion,bytes32 policyKey,bytes canonicalJson)',
  'function latestVersion(address creator,bytes32 seriesId) view returns (uint32)',
  'function readVersion(address creator,bytes32 seriesId,uint32 version) view returns (uint256 targetChainId,bytes32 adapterVersion,bytes32 policyKey,bytes32 contentHash,bytes canonicalJson)',
  'event StrategyPublished(uint256 indexed targetChainId,bytes32 indexed adapterVersion,bytes32 indexed policyKey,address creator,bytes32 seriesId,uint32 version,bytes32 contentHash)',
])
const publishedEvent = getAbiItem({abi:registryAbi,name:'StrategyPublished'})

/** Supply this pin from the reviewed deployment, outside the strategy or publication. */
export type RegistryPin = {
  chainId:1952|31337
  address:Address
  runtimeCodeHash:Hex
  deploymentBlock:bigint
  /** Number of successor blocks required. Public clients default to 12. */
  confirmations?:number
}
export type PublicationKey = {creator:Address;seriesId:Hex;version:number}
export type PublicationTopics = {targetChainId:bigint;adapterVersion:Hex;policyKey:Hex}
export type PublishedRecord = PublicationTopics & {contentHash:Hex;canonicalJson:Hex}
type Reader = Pick<PublicClient,'getChainId'|'getBlock'|'getCode'|'readContract'>
type LogReader = Reader & Pick<PublicClient,'getLogs'>
type Checkpoint = {blockNumber:bigint;blockHash:Hex}

function check(ok:unknown,message:string): asserts ok {
  if (!ok) throw new Error(message)
}
function bytes32(value:unknown):value is Hex {
  return typeof value==='string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}
function same(a:Hex,b:Hex) {return a.toLowerCase()===b.toLowerCase()}
function validKey(key:PublicationKey) {
  check(isAddress(key.creator) && !same(key.creator,zeroAddress),'Invalid publication creator')
  check(bytes32(key.seriesId) && !same(key.seriesId,zeroHash),'Invalid strategy series')
  check(Number.isSafeInteger(key.version) && key.version>0 && key.version<=0xffffffff,'Invalid strategy version')
}
function topicsFor(template:Strategy):PublicationTopics {
  const {enforcer,processor,circuitId,netlistHash} = template.policy
  return {
    targetChainId:BigInt(template.chainId),
    adapterVersion:keccak256(stringToHex(template.deployment.adapter)),
    policyKey:keccak256(encodeAbiParameters(
      [{type:'address'},{type:'address'},{type:'uint256'},{type:'bytes32'}],
      [getAddress(enforcer),getAddress(processor),BigInt(circuitId),netlistHash as Hex],
    )),
  }
}

// Only deterministic content failures can be reported as rejected publications during discovery.
// An unavailable RPC or inconsistent block aborts the page instead.
class RejectedContent extends Error {}
function requireContent(ok:unknown,message:string): asserts ok {
  if (!ok) throw new RejectedContent(message)
}

/** Offline content validation. Deployment, creator and inclusion are checked by the read APIs. */
export function verifyStrategyPublication(record:PublishedRecord) {
  const raw = record.canonicalJson
  requireContent(typeof raw==='string' && raw.length<=2+8192*2 && /^0x(?:[a-fA-F0-9]{2})+$/.test(raw),'Invalid published byte length or encoding')
  requireContent(bytes32(record.contentHash) && same(keccak256(raw),record.contentHash),'Registered content hash mismatch')
  let imported:ReturnType<typeof importStrategy>
  try {
    // Preserve any BOM. JSON.parse or the exact canonical-byte comparison rejects it.
    const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(hexToBytes(raw))
    imported = importStrategy(text)
  } catch {
    throw new RejectedContent('Published content failed UTF-8 or peridot.strategy/v1 validation')
  }
  requireContent(same(stringToHex(imported.canonical),raw) && same(imported.hash,record.contentHash),'Published JSON is not canonical')
  const topics = topicsFor(imported.template)
  requireContent(record.targetChainId===topics.targetChainId && bytes32(record.adapterVersion) &&
    same(record.adapterVersion,topics.adapterVersion) && bytes32(record.policyKey) && same(record.policyKey,topics.policyKey),
    'Publication topics differ from validated strategy')
  return {...imported,topics}
}

async function read<T>(fn:()=>Promise<T>):Promise<T> {
  for (let attempt=1;;attempt++) {
    try {return await fn()} catch (error) {
      if (attempt>=3) throw error
      await new Promise(resolve=>setTimeout(resolve,200*attempt))
    }
  }
}

async function header(client:Reader,blockNumber:bigint):Promise<Checkpoint> {
  return read(async()=>{
    const block=await client.getBlock({blockNumber})
    check(block.number===blockNumber && bytes32(block.hash),'Registry block unavailable')
    return {blockNumber,blockHash:block.hash}
  })
}
async function openRegistry(client:Reader,pin:RegistryPin,height?:bigint):Promise<Checkpoint> {
  check((pin.chainId===1952 || pin.chainId===31337) && isAddress(pin.address) && !same(pin.address,zeroAddress) &&
    bytes32(pin.runtimeCodeHash) && !same(pin.runtimeCodeHash,zeroHash) && pin.deploymentBlock>=0n,'Invalid registry deployment pin')
  const depth=pin.confirmations??12
  check(Number.isSafeInteger(depth) && depth>=1,'Invalid registry confirmation depth')
  check(await read(()=>client.getChainId())===pin.chainId,'Registry chain mismatch')
  const latest=await read(()=>client.getBlock({blockTag:'latest'}))
  check(latest.number!==null && bytes32(latest.hash),'Registry head unavailable')
  const confirmed=latest.number-BigInt(depth)
  const blockNumber=height??confirmed
  check(blockNumber>=pin.deploymentBlock && blockNumber<=confirmed,'Registry block outside confirmed deployment range')
  const checkpoint=await header(client,blockNumber)
  await read(async()=>{
    const code=await client.getCode({address:pin.address,blockNumber})
    check(code && code!=='0x' && same(keccak256(code),pin.runtimeCodeHash),'Registry runtime code hash mismatch')
  })
  return checkpoint
}
async function verifyCheckpoint(client:Reader,pin:RegistryPin,at:Checkpoint) {
  const after=await header(client,at.blockNumber)
  check(same(after.blockHash,at.blockHash) && await read(()=>client.getChainId())===pin.chainId,'Registry chain or review block changed')
}
async function recordAt(client:Reader,pin:RegistryPin,key:PublicationKey,blockNumber:bigint):Promise<PublishedRecord> {
  const [targetChainId,adapterVersion,policyKey,contentHash,canonicalJson]=await read(()=>client.readContract({
    address:pin.address,abi:registryAbi,functionName:'readVersion',args:[key.creator,key.seriesId,key.version],blockNumber,
  }))
  return {targetChainId,adapterVersion,policyKey,contentHash,canonicalJson}
}

/** Inspects only immutable strategy data. Adoption separately requires the adopter's own reviewed account plan. */
export async function readPublishedStrategy(client:Reader,pin:RegistryPin,key:PublicationKey,options:{blockNumber?:bigint}={}) {
  validKey(key)
  const at=await openRegistry(client,pin,options.blockNumber)
  const item=verifyStrategyPublication(await recordAt(client,pin,key,at.blockNumber))
  await verifyCheckpoint(client,pin,at)
  return {...key,...item,...at,registry:pin.address,chainId:pin.chainId}
}

/** Validates input, canonicalizes it and prepares one unsigned zero-value publish transaction. */
export async function buildStrategyPublication(client:Reader,pin:RegistryPin,request:{
  creator:Address;seriesId:Hex;expectedVersion:number;json:string
}) {
  const {creator,seriesId,expectedVersion,json}=request
  validKey({creator,seriesId,version:expectedVersion})
  const imported=importStrategy(json)
  const canonicalJson=stringToHex(imported.canonical)
  check((canonicalJson.length-2)/2<=8192,'Strategy exceeds registry byte limit')
  const topics=topicsFor(imported.template)
  const at=await openRegistry(client,pin)
  const current=await read(()=>client.readContract({address:pin.address,abi:registryAbi,functionName:'latestVersion',args:[creator,seriesId],blockNumber:at.blockNumber}))
  check(expectedVersion===current+1,'Expected strategy version differs from registry')
  const data=encodeFunctionData({abi:registryAbi,functionName:'publish',
    args:[seriesId,expectedVersion,topics.targetChainId,topics.adapterVersion,topics.policyKey,canonicalJson]})
  await verifyCheckpoint(client,pin,at)
  return {chainId:pin.chainId,from:creator,to:pin.address,value:0n,data,seriesId,expectedVersion,contentHash:imported.hash,canonical:imported.canonical,topics,...at}
}

export type DiscoveryPage = Partial<PublicationTopics> & {fromBlock:bigint;toBlock:bigint}

/** Inspect one inclusive page (up to 100 blocks). Invalid posts are isolated, while incomplete RPC reads reject the page. */
export async function discoverPublishedStrategies(client:LogReader,pin:RegistryPin,query:DiscoveryPage) {
  const {fromBlock,toBlock,targetChainId,adapterVersion,policyKey}=query
  check(fromBlock>=pin.deploymentBlock && toBlock>=fromBlock && toBlock-fromBlock<100n,'Discovery requires 1–100 blocks from deployment onward')
  check((targetChainId===undefined || targetChainId===1952n) && (adapterVersion===undefined || bytes32(adapterVersion)) &&
    (policyKey===undefined || bytes32(policyKey)),'Invalid registry topic filter')
  const at=await openRegistry(client,pin,toBlock)
  const logs=await read(()=>client.getLogs({address:pin.address,event:publishedEvent,strict:true,
    args:{targetChainId,adapterVersion,policyKey},fromBlock,toBlock}))
  const accepted:Array<Awaited<ReturnType<typeof readPublishedStrategy>> & {transactionHash:Hex;publishedBlock:bigint;logIndex:number}>=[]
  const rejected:Array<PublicationKey & {transactionHash:Hex;publishedBlock:bigint;logIndex:number;reason:string}>=[]
  const blockHashes=new Map<bigint,Hex>([[toBlock,at.blockHash]])
  const seen=new Set<string>()
  for (const log of logs) {
    check(same(log.address,pin.address) && log.removed===false && bytes32(log.transactionHash) && bytes32(log.blockHash) &&
      log.logIndex!==null && log.logIndex>=0 && log.blockNumber!==null && log.blockNumber>=fromBlock && log.blockNumber<=toBlock,
      'Invalid registry event provenance')
    const id=log.transactionHash+':'+log.logIndex
    check(!seen.has(id),'Duplicate registry event')
    seen.add(id)
    let blockHash=blockHashes.get(log.blockNumber)
    if (!blockHash) {
      blockHash=(await header(client,log.blockNumber)).blockHash
      blockHashes.set(log.blockNumber,blockHash)
    }
    check(same(log.blockHash,blockHash),'Registry event block hash mismatch')
    const args=log.args
    check((targetChainId===undefined || args.targetChainId===targetChainId) &&
      (adapterVersion===undefined || same(args.adapterVersion,adapterVersion)) && (policyKey===undefined || same(args.policyKey,policyKey)),
      'Registry log violates requested filter')
    const key={creator:args.creator,seriesId:args.seriesId,version:args.version}
    validKey(key)
    const record=await recordAt(client,pin,key,toBlock)
    check(same(record.contentHash,args.contentHash) && args.targetChainId===record.targetChainId &&
      same(args.adapterVersion,record.adapterVersion) && same(args.policyKey,record.policyKey),'Registry event and immutable record disagree')
    const provenance={...key,transactionHash:log.transactionHash,publishedBlock:log.blockNumber,logIndex:log.logIndex}
    try {
      const item=verifyStrategyPublication(record)
      accepted.push({...provenance,...item,...at,registry:pin.address,chainId:pin.chainId})
    } catch (error) {
      if (!(error instanceof RejectedContent)) throw error
      rejected.push({...provenance,reason:error.message})
    }
  }
  await verifyCheckpoint(client,pin,at)
  return {registry:pin.address,chainId:pin.chainId,fromBlock,toBlock,...at,accepted,rejected}
}

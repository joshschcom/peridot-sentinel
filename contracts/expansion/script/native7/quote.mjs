// Read-only re-pricing for a separate founder decision after publication; no wallet or send method.
import assert from 'node:assert/strict'
import {parseArgs} from 'node:util'
import {loadData} from './publication-io.mjs'
import {encodeDeployData,formatEther,getAddress,keccak256,size,toHex} from 'viem'
import {abi,mainnet,packet,stringify,verifyBindings} from '../../../../evidence/session6-d8b/checks.mjs'
import {artifact,config,inputMode} from './fork.mjs'

const pin=inputMode('--published')
const {values,positionals}=parseArgs({allowPositionals:true,options:{proof:{type:'string'}}})
assert(positionals.length<=1,'Only an optional public sender address is accepted')
const d=loadData(values.proof ?? 'evidence/session9-native/public-financial-fork.json')
assert.equal(d.upstream.chainId,196)
assert.equal(d.upstream.hash,pin.hash)
assert.deepEqual(d.publicCircuitIds,config.circuits.map(c=>c.publishedId))
const witness=artifact('NativeCircuitWitness',true)
const data=encodeDeployData({abi:witness.abi,bytecode:witness.bytecode.object,args:d.publicCircuitIds.map(BigInt)})
assert.equal(keccak256(data),d.witnessProposal.creationDataHash)
assert.equal(await mainnet.getChainId(),196)
const head=await mainnet.getBlock()
const now=BigInt(Math.floor(Date.now()/1000))
assert(now>=head.timestamp-15n && now-head.timestamp<=120n,'Stale public head')
await verifyBindings(head.number)
const receipt=await mainnet.getTransactionReceipt({hash:config.circuits[2].publicReceipt})
const sender=getAddress(positionals[0]??receipt.from)
assert(!await mainnet.getCode({address:sender,blockNumber:head.number}),'Expected an ordinary EOA sender')
const gasEstimate=await mainnet.estimateGas({account:sender,data,value:0n,blockNumber:head.number})
const gas=gasEstimate+(gasEstimate+3n)/4n+30000n
const maxFeePerGas=50_000_000n
assert(head.baseFeePerGas!=null && head.baseFeePerGas+1n<=maxFeePerGas,'Current base fee exceeds the proposal cap')
const read=(functionName,args)=>mainnet.readContract({address:packet.bindings.gasOracle,abi,functionName,args,blockNumber:head.number})
const [l1,operator,balance]=await Promise.all([read('getL1FeeUpperBound',[BigInt(size(data)+300)]),read('getOperatorFee',[gas]),
  mainnet.getBalance({address:sender,blockNumber:head.number})])
const maxWei=gas*maxFeePerGas+l1+operator
assert.equal((await mainnet.getBlock({blockNumber:head.number})).hash,head.hash)
console.log(stringify({status:'Unsigned current proposal for founder review',block:head.number,blockHash:head.hash,sender,gasEstimate,
  transaction:{chainId:196,type:'0x2',to:null,data,value:'0x0',gas:toHex(gas),maxFeePerGas:toHex(maxFeePerGas),maxPriorityFeePerGas:'0x1',accessList:[]},
  l1UpperWei:l1,operatorUpperWei:operator,maxWei,maxOKB:formatEther(maxWei),balanceWei:balance,sufficientBalance:balance>=maxWei}))

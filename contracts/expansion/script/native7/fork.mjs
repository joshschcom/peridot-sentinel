// All write-capable calls use this process's disposable loopback node.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {readFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
import {createPublicClient,createWalletClient,encodeDeployData,encodeFunctionData,getAddress,http,keccak256,parseEventLogs,toHex} from 'viem'
import {forkStatus,publicUrl} from './publication-io.mjs'
import {mainnet,packet,readJson} from '../../../../evidence/session6-d8b/checks.mjs'

export const config=readJson('packages/chain-config/expansion/tapeout-196.json')
export const programs=[...readJson('packages/circuit-sdk/fixtures/policies-v1.json').policies,readJson('contracts/expansion/policy/execution.json')]
export const cpu=getAddress(packet.bindings.cpu)
export const inputMode=(arg,document=config,privateOrigin=null)=>{
  const config=document
  assert(['--published','--rehearse'].includes(arg),'Choose --published or --rehearse explicitly')
  assert.equal(config.chainId,privateOrigin?31337:196)
  assert.equal(getAddress(config.processor),cpu)
  assert.deepEqual(config.circuits.map(c=>c.kind),['MARKET','ACCOUNT','EXECUTION'])
  for(const [i,c] of config.circuits.entries()){
    assert.equal(c.netlistHash,programs[i].netlistHash)
    assert.equal(c.gates,programs[i].gateCount)
    assert.equal(c.schema,i===2?'sentinel-execution-swap-v1':'lending-v1')
  }
  if(arg==='--published'){
    if(privateOrigin){
      assert.equal(config.mode,'fork-only')
      assert.deepEqual(config.origin,privateOrigin,'Wrong private publication fork')
    }
    assert.equal(config.status,privateOrigin?forkStatus:'published','D8b-postpublish.mjs has not verified public IDs; publication mode stops here')
    assert(config.circuits.every(c=>/^[0-9]+$/.test(c.publishedId) && /^0x[0-9a-f]{64}$/i.test(c.publicReceipt)))
    assert.equal(new Set(config.circuits.map(c=>BigInt(c.publishedId))).size,3)
    return {published:true,number:BigInt(config.verifiedBlock),hash:config.verifiedBlockHash}
  }
  return {published:false,number:BigInt(packet.pin.number),hash:packet.pin.hash}
}
export function artifact(name,expansion=false) {
  const source=name==='TestnetSwapQuoteSource'?'TestnetInventoryVenue':name
  return JSON.parse(readFileSync(new URL((expansion?'../../out/':'../../../out/')+source+'.sol/'+name+'.json',import.meta.url)))
}
export function loggedEvent(receipt,abi,address,name) {
  const matching=parseEventLogs({abi,eventName:name,strict:true,logs:receipt.logs.filter(l=>getAddress(l.address)===getAddress(address))})
  assert.equal(matching.length,1,'Expected one '+name)
  return matching[0].args
}
export function flatten(trace) {return [trace,...(trace.calls??[]).flatMap(flatten)]}
export async function withFork(pin,body,upstream=mainnet,upstreamUrl=publicUrl,port=19710) {
  assert([19709,19710].includes(port))
  const url='http://127.0.0.1:'+port
  const node=createPublicClient({transport:http(url,{retryCount:0,timeout:90000}),cacheTime:0})
  const wallet=createWalletClient({transport:http(url,{retryCount:0,timeout:90000})})
  const busy=await fetch(url,{signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false)
  assert(!busy,'Port 19710 is already in use')
  assert.equal(await upstream.getChainId(),upstreamUrl===publicUrl?196:31337)
  const source=await upstream.getBlock({blockNumber:pin.number})
  assert.equal(source.hash,pin.hash,'Upstream block hash differs from the chosen pin')
  const child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--fork-url',upstreamUrl,'--fork-block-number',String(pin.number),'--no-storage-caching','--silent'],{stdio:['ignore','ignore','inherit']})
  const exited=once(child,'exit')
  const stop=()=>child.kill('SIGTERM')
  process.once('SIGTERM',stop)
  process.once('SIGINT',stop)
  try {
    let info
    for(let i=0;i<100 && !info;i++){
      assert(child.exitCode===null && child.signalCode===null,'Private Anvil exited')
      try{info=await node.request({method:'anvil_nodeInfo'})}catch{await delay(200)}
    }
    assert.equal(await node.getChainId(),31337)
    assert.equal(info?.forkConfig?.forkUrl,upstreamUrl)
    assert.equal(BigInt(info.forkConfig.forkBlockNumber),pin.number)
    assert.equal((await node.getBlock()).hash,pin.hash)
    const actors=[]
    for(const address of await wallet.getAddresses()){
      if(!await node.getCode({address}))actors.push(getAddress(address))
      if(actors.length===2)break
    }
    assert.equal(actors.length,2)
    const [owner,operator]=actors,receipts=[]
    const read=(address,abi,functionName,args=[])=>node.readContract({address,abi,functionName,args})
    const send=async(label,request,actor=owner,expected='success')=>{
      await node.request({method:'evm_setNextBlockTimestamp',params:[toHex(source.timestamp+BigInt(receipts.length)+1n)]})
      const hash=await wallet.sendTransaction({account:actor,chain:null,gas:15000000n,...request})
      let mined
      for(let i=0;i<200 && !mined;i++){
        mined=await node.request({method:'eth_getTransactionReceipt',params:[hash]})
        if(!mined)await delay(150)
      }
      assert(mined,'Missing private fork receipt '+hash)
      const r=await node.getTransactionReceipt({hash})
      assert.equal(r.status,expected,label+' '+hash)
      assert.equal((await node.getBlock({blockNumber:r.blockNumber})).hash,r.blockHash)
      receipts.push({label,hash,from:r.from,to:r.to,created:r.contractAddress,status:r.status,block:r.blockNumber,blockHash:r.blockHash,gasUsed:r.gasUsed})
      console.error(label,hash)
      return r
    }
    const call=(label,c,name,args=[],actor=owner,expected='success')=>send(label,{to:c.address,data:encodeFunctionData({abi:c.abi,functionName:name,args})},actor,expected)
    const contracts={}
    const deploy=async(label,name,args=[],expansion=false)=>{
      const {abi,bytecode}=artifact(name,expansion)
      const init=encodeDeployData({abi,bytecode:bytecode.object,args})
      const r=await send('Deploy '+label,{data:init})
      const address=getAddress(r.contractAddress),runtimeHash=keccak256(await node.getCode({address}))
      contracts[label]={type:name,address,runtimeHash}
      return {address,abi,init,receipt:r}
    }
    await body({node,source,owner,operator,receipts,contracts,send,call,read,deploy})
  } finally {
    process.off('SIGINT',stop);process.off('SIGTERM',stop)
    if(child.exitCode===null && child.signalCode===null)stop()
    const deadline=setTimeout(()=>child.kill('SIGKILL'),5000)
    try {await exited} finally {clearTimeout(deadline)}
  }
}

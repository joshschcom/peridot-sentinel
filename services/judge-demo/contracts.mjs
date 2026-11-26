import assert from 'node:assert/strict'
import {encodeDeployData,encodeFunctionData,getAddress,keccak256,parseEventLogs} from 'viem'
import {base,expansion,readJson,retryRead} from './transport.mjs'
const types=new Map()
const v2=new Set(['ExecutionPolicy','TestnetSwapQuoteSource','TestnetInventoryVenue','SinglePoolSwapAdapter','PeridotLendingAdapter','SentinelAccountFactoryV2','SentinelAccountV2'])
export const typeNames={mockWokb:'TestnetToken',mockUsdc:'TestnetToken',mockOracle:'TestnetOracle',source:'TestnetSwapQuoteSource',venue:'TestnetInventoryVenue',
  cpu:'DevelopmentReferenceProcessor',execution:'ExecutionPolicy',swap:'SinglePoolSwapAdapter',lending:'PeridotLendingAdapter',factory:'SentinelAccountFactoryV2',account:'SentinelAccountV2'}
export function artifact(type){
  if(!types.has(type)){
    const source=type==='TestnetSwapQuoteSource'?'TestnetInventoryVenue':type
    types.set(type,readJson('contracts/'+(v2.has(type)?'expansion/':'')+'out/'+source+'.sol/'+type+'.json'))
  }
  return types.get(type)
}
export const binding=(type,address)=>({type,address:getAddress(address),abi:artifact(type).abi})
export const data=(c,fn,args=[])=>encodeFunctionData({abi:c.abi,functionName:fn,args})
export const call=(s,label,role,c,fn,args=[],options={})=>s.send(label,role,c.address,data(c,fn,args),options)
export const read=(s,c,fn,args=[],at)=>s.view(c.address,c.abi,fn,args,at)
export function event(r,c,name){
  const logs=parseEventLogs({abi:c.abi,eventName:name,logs:r.logs.filter(l=>getAddress(l.address)===c.address),strict:true})
  assert.equal(logs.length,1,'Expected one '+name+' at '+c.address)
  return logs[0].args
}
export async function checkedCode(s,c,at) {
  const bytes=await retryRead(()=>s.client.getCode({address:c.address,blockNumber:at}),x=>x && x!=='0x')
  const deployed=artifact(c.type).deployedBytecode
  const mask=x=>{
    const b=Buffer.from(x.slice(2),'hex')
    for(const refs of Object.values(deployed.immutableReferences??{}))for(const {start,length} of refs)b.fill(0,start,start+length)
    return b
  }
  assert.deepEqual(mask(bytes),mask(deployed.object),'Runtime differs from pinned '+c.type)
  return keccak256(bytes)
}
export function checkArtifacts(){
  for(const [key,type] of Object.entries(typeNames))assert.equal(keccak256(artifact(type).bytecode.object),expansion.source.creationHashes[key],key+' creation bytecode differs from Session 6 pin')
}
export async function deploy(s,key,args=[]){
  const type=typeNames[key],a=artifact(type)
  const r=await s.send('deploy-'+key,'deployer',undefined,encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args}))
  const c=binding(type,r.contractAddress)
  await checkedCode(s,c,r.blockNumber)
  return c
}
export const m4=Object.fromEntries(Object.entries(base.contracts).map(([k,a])=>[k,binding(['MockCollateral','MockDebt'].includes(k)?'TestnetToken':k,a)]))
export function requireEqual(a,b){assert.equal(getAddress(a),getAddress(b))}

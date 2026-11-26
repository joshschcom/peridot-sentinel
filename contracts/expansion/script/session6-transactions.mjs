// Development-chain writer. Every public send reserves the signed hash before its single submission.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {dirname} from 'node:path'
import {createPublicClient,createWalletClient,decodeFunctionData,defineChain,getAddress,http,keccak256,parseAbi} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'

export const deployer='0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67'
export const operator='0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88'
export const publicRpc='https://testrpc.xlayer.tech'
export const readJson=path=>JSON.parse(readFileSync(path,'utf8'))
export function writeJson(path,value) {
  mkdirSync(dirname(path),{recursive:true})
  const tmp=path+'.'+process.pid+'.tmp'
  writeFileSync(tmp,JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n')
  renameSync(tmp,path)
}
export const gasWithHeadroom=estimate=>estimate+(estimate+2n)/3n+30_000n
export async function retryRead(fn,ok=()=>true) {
  let last
  for(let attempt=0;attempt<20;attempt++) {
    try { const result=await fn(); if(!ok(result)) throw Error('Stale RPC observation'); return result }
    catch(error){ last=error }
    if(attempt<19) await new Promise(r=>setTimeout(r,Math.min(150*(attempt+1),1500)))
  }
  throw last
}
export async function openSession({mode,slug,forkPort,role='deployer'}) {
  assert(['testnet','fork'].includes(mode) && /^[a-z0-9-]+$/.test(slug))
  assert(['deployer','operator'].includes(role) && Number.isInteger(forkPort) && forkPort>1024 && forkPort<65536)
  const live=mode==='testnet'
  const url=live?publicRpc:'http://127.0.0.1:'+forkPort
  const chain=defineChain({id:1952,name:'X Layer testnet',nativeCurrency:{name:'OKB',symbol:'OKB',decimals:18},rpcUrls:{default:{http:[url]}}})
  const transport=http(url,{retryCount:0,timeout:20000})
  const client=createPublicClient({chain,transport,cacheTime:0})
  const witness=live?createPublicClient({transport:http('https://xlayertestrpc.okx.com',{retryCount:0}),cacheTime:0}):client
  assert.equal(await retryRead(()=>client.getChainId()),1952)
  assert.equal(await retryRead(()=>witness.getChainId()),1952)
  const actor=getAddress(role==='operator'?operator:deployer)
  let instance='1952'
  if(!live) {
    const info=await client.request({method:'anvil_nodeInfo'})
    assert.equal(info.forkConfig.forkUrl,publicRpc)
    const meta=await client.request({method:'anvil_metadata'})
    instance='fork-'+meta.instanceId.slice(2,18)
    await client.request({method:'anvil_impersonateAccount',params:[actor]})
  }
  const anchor=readJson('evidence/testnet/keeper-auto-repay-1952.json')
  const historical=await retryRead(()=>client.getTransactionReceipt({hash:anchor.txHash}))
  assert.equal(historical.blockNumber,BigInt(anchor.block))
  const dir='deployments/session6/'+instance+'/'+slug
  const path=dir+'/'+role+'.json'
  mkdirSync(dir,{recursive:true})
  const fd=openSync(path+'.lock','wx')
  let state
  try {
    state=existsSync(path)?readJson(path):{profile:live?'public testnet':'private Anvil fork of testnet',chainId:1952,actor,steps:{},data:{}}
    assert.equal(state.actor,actor)
  } catch(e){closeSync(fd);unlinkSync(path+'.lock');throw e}
  const save=()=>writeJson(path,state)
  const wallet=createWalletClient({chain,transport})
  async function send(label,{to,data,value=0n,gas,expected='success'}) {
    assert(typeof label==='string' && label.length>0 && ['success','reverted'].includes(expected))
    if(expected==='reverted') assert(typeof gas==='bigint' && gas>0n,'Intentional rejection needs an explicit gas limit')
    if(live && role==='operator') {
      const manifest=readJson('packages/chain-config/expansion/deployments/1952.json')
      const swapAbi=parseAbi(['function swapExactIn(address,uint256,uint256,uint64) returns(uint256)'])
      const {args}=decodeFunctionData({abi:swapAbi,data})
      assert(slug==='v2-demo' && label==='operator-swap' && expected==='success' && value===0n)
      assert.equal(getAddress(to),getAddress(manifest.contracts.account))
      assert.equal(getAddress(args[0]),getAddress(manifest.contracts.mockWokb))
      assert.equal(args[1],10n**18n)
      assert.equal(args[2],79_200_000n)
      assert.equal(keccak256(await retryRead(()=>client.getCode({address:to}),Boolean)),manifest.runtimeCodeHashes.account)
    }
    const fingerprint={to:to?getAddress(to):null,dataHash:keccak256(data),value:String(value),expected}
    let step=state.steps[label]
    if(step) {
      for(const [key,val] of Object.entries(fingerprint)) assert.equal(step[key],val,'Journaled intent changed: '+label)
      if(!step.hash) throw Error('Uncertain fork submission; inspect reserved nonce '+step.nonce)
    } else {
      const last=Object.values(state.steps).at(-1)
      const nonce=await retryRead(async()=>{
        const [pending,current,other]=await Promise.all([client.getTransactionCount({address:actor,blockTag:'pending'}),client.getTransactionCount({address:actor}),witness.getTransactionCount({address:actor})])
        assert(pending===current && pending===other,'Nonce lane busy or witnesses disagree')
        return pending
      },n=>!last || n>last.nonce)
      const limit=gas??gasWithHeadroom(await retryRead(()=>client.estimateGas({account:actor,to,data,value})))
      const tx={account:actor,to,data,value,nonce,gas:limit}
      step={...fingerprint,nonce,gasLimit:String(limit)}
      if(live) {
        const variable=role==='deployer'?'PERIDOT_TESTNET_KEY':'SENTINEL_OPERATOR_KEY'
        const key=(process.env[variable]??'').trim().replace(/^0x/i,'')
        if(!/^[0-9a-f]{64}$/i.test(key)) throw Error('Missing dedicated '+role+' environment')
        const signer=privateKeyToAccount('0x'+key)
        assert.equal(signer.address,actor)
        const request=await retryRead(()=>wallet.prepareTransactionRequest({...tx,account:signer}))
        const signed=await signer.signTransaction(request)
        step.hash=keccak256(signed)
        state.steps[label]=step;save()
        try {assert.equal(await wallet.sendRawTransaction({serializedTransaction:signed}),step.hash)}
        catch {console.error('Reconciling recorded transaction',step.hash)}
      } else {
        state.steps[label]=step;save()
        step.hash=await wallet.sendTransaction(tx);save()
      }
    }
    const r=await retryRead(async()=>{
      const receipt=await client.getTransactionReceipt({hash:step.hash})
      const block=await client.getBlock({blockNumber:receipt.blockNumber})
      assert.equal(block.hash,receipt.blockHash)
      assert((await client.getBlockNumber())>=receipt.blockNumber+(live?2n:0n))
      return receipt
    })
    assert.equal(getAddress(r.from),actor)
    assert.equal(r.to?getAddress(r.to):null,fingerprint.to)
    step.status=r.status;step.block=String(r.blockNumber);step.blockHash=r.blockHash;step.gasUsed=String(r.gasUsed)
    save()
    assert.equal(r.status,expected,label+' '+step.hash)
    console.log(label,step.hash,step.status)
    return r
  }
  return {actor,client,dir,state,save,send,readContract:request=>retryRead(()=>client.readContract(request)),
    close(){closeSync(fd);unlinkSync(path+'.lock')}}
}

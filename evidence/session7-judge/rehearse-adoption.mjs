// A wallet script signs the three fork transactions independently of setup. No browser is involved.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createPublicClient,encodeFunctionData,getAddress,http,keccak256,parseEventLogs,toHex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {studioMarketTemplate} from '@peridot/circuit-sdk'
import {artifact} from '../../services/judge-demo/contracts.mjs'
import {adoptionFixture,base,readJson,retryRead,usd,wad,writeJson} from '../../services/judge-demo/transport.mjs'

const rpc=createPublicClient({transport:http('http://127.0.0.1:19752',{retryCount:0}),cacheTime:0})
assert.equal(await rpc.getChainId(),1952)
const node=await rpc.request({method:'anvil_nodeInfo'})
assert.equal(node.forkConfig.forkUrl,'https://testrpc.xlayer.tech')
const metadata=await rpc.request({method:'anvil_metadata'}),instance=metadata.instanceId.slice(2,18)
const signer=privateKeyToAccount(keccak256(toHex('Peridot judge adoption rehearsal, disposable private-fork signer')))
assert.equal(signer.address,adoptionFixture)
const campaign='scripted-adoption'
const env={PATH:process.env.PATH,JUDGE_FORK_PORT:'19752',JUDGE_OWNER:signer.address}
const directory='deployments/session7/fork-'+instance+'/'+campaign
const run=(command,...args)=>execFileSync(process.execPath,[command,'fork',...args],{env,stdio:['ignore','pipe','inherit'],encoding:'utf8'}).trim()
run('services/judge-demo/run.mjs','fund',campaign)
const fundingJournal=readJson(directory+'/journal.json'),path=directory+'/independent-wallet.json'
const records=existsSync(path)?readJson(path):{}
async function send(label,target,type,fn,args){
  const abi=artifact(type).abi,calldata=encodeFunctionData({abi,functionName:fn,args})
  let rec=records[label]
  if(!rec){
    const estimate=await rpc.estimateGas({account:signer.address,to:target,data:calldata})
    const nonce=await rpc.getTransactionCount({address:signer.address,blockTag:'pending'})
    const gasPrice=(await rpc.getBlock()).baseFeePerGas*2n+1n
    const serialized=await signer.signTransaction({type:'legacy',chainId:1952,to:target,data:calldata,value:0n,gas:estimate+estimate/3n+30_000n,gasPrice,nonce})
    rec=records[label]={hash:keccak256(serialized),to:getAddress(target),dataHash:keccak256(calldata),nonce}
    writeJson(path,records)
    try{assert.equal(await rpc.sendRawTransaction({serializedTransaction:serialized}),rec.hash)}
    catch{console.error('Reconciling independent wallet hash',rec.hash)}
  }
  assert.equal(rec.dataHash,keccak256(calldata))
  const r=await retryRead(()=>rpc.getTransactionReceipt({hash:rec.hash})),t=await rpc.getTransaction({hash:rec.hash})
  assert.equal(r.blockHash,(await rpc.getBlock({blockNumber:r.blockNumber})).hash)
  assert.equal(r.status,'success');assert.equal(getAddress(t.from),signer.address);assert.equal(t.input,calldata)
  assert.equal(getAddress(t.to),rec.to);assert.equal(t.nonce,rec.nonce)
  Object.assign(rec,{block:String(r.blockNumber),blockHash:r.blockHash});writeJson(path,records)
  return r
}
const one=(r,target,type,eventName)=>{const logs=parseEventLogs({abi:artifact(type).abi,eventName,logs:r.logs.filter(l=>getAddress(l.address)===getAddress(target)),strict:true});assert.equal(logs.length,1);return logs[0].args}
const {DevelopmentReferenceProcessor:cpu,PolicyRegistry:registry,MarketFactory:factory}=base.contracts
const cap=fundingJournal.plan.caps.A,{compiled,proof}=studioMarketTemplate(cap,true)
const first=await send('program',cpu,'DevelopmentReferenceProcessor','addReferenceCircuit',[compiled.netlist])
const {id}=one(first,cpu,'DevelopmentReferenceProcessor','ReferenceCircuitAdded')
const second=await send('register',registry,'PolicyRegistry','registerMarketTemplate',[cpu,id,cap,true,compiled.netlistHash,compiled.configHash,proof])
const {policyId}=one(second,registry,'PolicyRegistry','MarketTemplateRegistered')
const third=await send('create',factory,'MarketFactory','createMarket',[policyId,7500,8500,1000n*wad,1000n*usd,900n*usd,10n*usd])
const created=one(third,factory,'MarketFactory','MarketCreated')
const opt='--adopt-market='+third.transactionHash
run('services/judge-demo/run.mjs','setup',campaign,opt)
const m=readJson(directory+'/manifest.json')
assert.equal(m.owner,signer.address);assert.equal(getAddress(created.controller),m.markets.A.controller);assert.equal(m.markets.A.creationTx,third.transactionHash)
assert.equal(m.policies.A.policyId,policyId);assert.equal(m.policies.A.circuitId,String(id))
assert(!Object.hasOwn(m.setupReceipts,'studio-create-A'),'Setup issued a duplicate market')
const counts=async()=>Promise.all([m.owner,m.deployer,m.operator].map(address=>rpc.getTransactionCount({address})))
const before=await counts()
run('services/judge-demo/run.mjs','setup',campaign,opt)
assert.deepEqual(await counts(),before,'Resume sent another transaction')
run('services/judge-demo/verify.mjs',campaign)
const verified=readJson(directory+'/verified.json')
assert(verified.current.repayReady && verified.current.swapReady)
writeJson('evidence/session7-judge/scripted-adoption.json',{label:'SCRIPTED external wallet on private Anvil fork of public testnet 1952; no browser and no public transactions',
  upstreamBlock:String(BigInt(node.forkConfig.forkBlockNumber)),forkInstance:metadata.instanceId,owner:m.owner,campaign,independentlySigned:records,marketA:created,
  adoptedMarketA:m.markets.A,profile:m.profile,manifest:directory+'/manifest.json',verification:directory+'/verified.json',
  setupReceipts:Object.keys(m.setupReceipts).length,nonceBeforeAndAfterResume:before,repayReady:true,swapReady:true})
console.log('Externally signed Studio creation adopted and resumed without additional transactions',third.transactionHash,created.controller)

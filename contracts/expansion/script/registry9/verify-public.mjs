// Run from the repository root. Default is read-only; --record creates the Session 10 evidence once.
import assert from 'node:assert/strict'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {createPublicClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256, stringToHex} from 'viem'
import publicPin from '@peridot/chain-config/deployments/strategy-registry-1952.json' with {type:'json'}
import {buildAdoptionPlan, curatedStrategies} from '../../../../packages/strategy-sdk/index.ts'
import {discoverPublishedStrategies, registryAbi, verifyStrategyPublication} from '../../../../packages/strategy-sdk/registry.ts'
import {deployer, operator, retryRead} from '../session6-transactions.mjs'

const args=process.argv.slice(2)
assert(args.length===0 || (args.length===1 && args[0]==='--record'), 'Expected optional --record')
const pin={...publicPin,deploymentBlock:BigInt(publicPin.deploymentBlock)}
assert.equal(pin.chainId,1952)
assert.equal(pin.confirmations,12)
const root=new URL('../../../../',import.meta.url)
const input='deployments/session6/1952/registry-curated-v1/deployer.json'
const journal=JSON.parse(readFileSync(new URL(input,root),'utf8'))
assert.equal(journal.chainId,1952)
assert.equal(getAddress(journal.actor),deployer)
const curated=curatedStrategies()
assert.deepEqual(Object.keys(journal.steps).sort(),curated.map(x=>x.template.profile).sort())
const publications=curated.map(({template,hash,canonical})=>{
  const step=journal.steps[template.profile]
  assert.equal(step.status,'success')
  assert(BigInt(step.block)>=pin.deploymentBlock)
  return {profile:template.profile,seriesId:keccak256(stringToHex('peridot:s9:'+template.profile)),hash,canonical,step}
})
const toBlock=publications.reduce((height,p)=>BigInt(p.step.block)>height?BigInt(p.step.block):height,pin.deploymentBlock)
const urls=['https://testrpc.xlayer.tech','https://xlayertestrpc.okx.com']

async function verifyWitness(url) {
  const rpc=createPublicClient({cacheTime:0,transport:http(url,{retryCount:2,timeout:10000})})
  assert.equal(await retryRead(()=>rpc.getChainId()),1952)
  const head=await retryRead(()=>rpc.getBlockNumber(),n=>n>=toBlock+BigInt(pin.confirmations))
  const block=await retryRead(()=>rpc.getBlock({blockNumber:toBlock}))
  assert.equal((await rpc.getBlock({blockNumber:pin.deploymentBlock})).hash,pin.deploymentBlockHash)
  const accepted=[]
  const pages=[]
  for(let fromBlock=pin.deploymentBlock;fromBlock<=toBlock;fromBlock+=100n) {
    const end=fromBlock+99n < toBlock ? fromBlock+99n : toBlock
    const page=await retryRead(async()=>{
      const result=await discoverPublishedStrategies(rpc,pin,{fromBlock,toBlock:end,targetChainId:1952n})
      // A backend can serve empty logs immediately after mining. Require the known receipt rows in their page.
      for(const p of publications.filter(p=>BigInt(p.step.block)>=fromBlock && BigInt(p.step.block)<=end)) {
        assert(result.accepted.some(x=>x.transactionHash===p.step.hash),'Journaled publication absent from discovery')
      }
      return result
    })
    accepted.push(...page.accepted)
    pages.push({fromBlock,toBlock:end,toBlockHash:page.blockHash,accepted:page.accepted.length,rejected:page.rejected.length})
  }
  const verified=[]
  for(const {profile,seriesId,hash,canonical,step} of publications) {
    const [tx,receipt,raw]=await retryRead(()=>Promise.all([
      rpc.getTransaction({hash:step.hash}),rpc.getTransactionReceipt({hash:step.hash}),
      rpc.readContract({address:pin.address,abi:registryAbi,functionName:'readVersion',args:[deployer,seriesId,1],blockNumber:toBlock}),
    ]))
    assert.equal(tx.chainId,1952)
    assert.equal(tx.nonce,step.nonce)
    assert.equal(tx.value,0n)
    assert.equal(getAddress(tx.to),pin.address)
    assert.equal(getAddress(tx.from),deployer)
    assert.equal(receipt.status,'success')
    assert.equal(receipt.transactionHash,step.hash)
    assert.equal(receipt.blockNumber,BigInt(step.block))
    assert.equal(receipt.blockHash,step.blockHash)
    assert.equal(tx.blockHash,receipt.blockHash)
    assert.equal((await rpc.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash)
    const [targetChainId,adapterVersion,policyKey,contentHash,canonicalJson]=raw
    const loaded=verifyStrategyPublication({targetChainId,adapterVersion,policyKey,contentHash,canonicalJson})
    assert.equal(loaded.hash,hash)
    assert.equal(loaded.canonical,canonical)
    assert.equal(tx.input,encodeFunctionData({abi:registryAbi,functionName:'publish',
      args:[seriesId,1,targetChainId,adapterVersion,policyKey,canonicalJson]}))
    const matches=accepted.filter(item=>item.transactionHash===step.hash)
    assert.equal(matches.length,1)
    const [found]=matches
    assert.equal(found.seriesId,seriesId)
    assert.equal(found.version,1)
    assert.equal(getAddress(found.creator),deployer)
    assert.equal(found.publishedBlock,receipt.blockNumber)
    assert.equal(found.canonical,canonical)
    assert.deepEqual(found.template,loaded.template)
    const log=receipt.logs.find(l=>l.logIndex===found.logIndex && getAddress(l.address)===pin.address)
    assert(log && !log.removed && log.blockHash===receipt.blockHash)
    const {args:event}=decodeEventLog({abi:registryAbi,eventName:'StrategyPublished',topics:log.topics,data:log.data,strict:true})
    assert.deepEqual(event,{targetChainId,adapterVersion,policyKey,creator:deployer,seriesId,version:1,contentHash})

    // Use the published template and the existing demo owner's own account. Pin the
    // planner’s reads to the publication evidence block so both RPCs review exactly the same state.
    const reader={getChainId:rpc.getChainId,getCode:rpc.getCode,readContract:rpc.readContract,
      getBlock:q=>rpc.getBlock(q.blockTag==='latest'?{blockNumber:toBlock}:q)}
    const plan=await buildAdoptionPlan(reader,found.template,{owner:deployer,operator})
    assert.equal(plan.templateHash,hash)
    assert.equal(plan.blockHash,block.hash)
    assert.equal(plan.owner,deployer)
    const expectedMethod=profile==='debt-protection-v1'?'setOperator':'setGrant'
    if(plan.reviewId) assert.equal(plan.transactions.length,0)
    else assert(plan.transactions.some(t=>t.method===expectedMethod))
    for(const t of plan.transactions) {
      assert(t.from===deployer && t.to===plan.account && t.chainId===1952 && t.value===0n)
    }
    verified.push({profile,creator:deployer,seriesId,version:1,contentHash,targetChainId,adapterVersion,policyKey,
      canonicalBytes:(canonicalJson.length-2)/2,transactionHash:step.hash,nonce:tx.nonce,block:receipt.blockNumber,
      blockHash:receipt.blockHash,logIndex:found.logIndex,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,
      executionFeeWei:receipt.gasUsed*receipt.effectiveGasPrice,
      ownerPreview:{kind:'unsigned owner review',owner:plan.owner,account:plan.account,operator:plan.operator,
        reviewId:plan.reviewId,currentGrant:plan.currentGrant,warnings:plan.warnings,
        unsignedMethods:plan.transactions.map(t=>t.method),eventualGrantMethod:expectedMethod}})
  }
  assert.equal((await rpc.getBlock({blockNumber:toBlock})).hash,block.hash)
  return {url,head,successors:head-toBlock,proof:{fromBlock:pin.deploymentBlock,toBlock,blockHash:block.hash,pages,verified}}
}

const witnesses=await Promise.all(urls.map(verifyWitness))
assert.deepEqual(witnesses[0].proof,witnesses[1].proof,'Public RPCs disagree')
const result={kind:'public-testnet-strategy-discovery',chainId:1952,registry:pin.address,journal:input,
  verifiedAt:new Date().toISOString(),witnesses:witnesses.map(({url,head,successors})=>({url,head,successors})),
  ...witnesses[0].proof,adoptionTransactionsSubmitted:0}
const json=JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n'
if(args.includes('--record')) {
  const dir=new URL('evidence/session10-registry/',root)
  mkdirSync(dir,{recursive:true})
  writeFileSync(new URL('discovery.json',dir),json,{flag:'wx'})
}
console.log(json)

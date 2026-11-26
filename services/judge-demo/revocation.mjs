import assert from 'node:assert/strict'
import {getAbiItem,getAddress} from 'viem'
import {binding,call,read,requireEqual} from './contracts.mjs'
import {retryRead} from './transport.mjs'

// V1 has no enumerable operator getter. Discover every grant from both immutable
// campaign accounts' creation blocks and query the actual grant at one canonical block.
export async function discoverV1(s,m,head){
  const accounts=Object.values(m.markets).map(v=>getAddress(v.account))
  const first=Object.values(m.markets).map(v=>BigInt(v.creationBlock)).reduce((a,b)=>a<b?a:b)
  let cache=s.state.plan.v1Operators
  if(cache && (BigInt(cache.block)>head.number || (await retryRead(()=>s.client.getBlock({blockNumber:BigInt(cache.block)}))).hash!==cache.hash))cache=null
  const prior=cache?.operators??Object.fromEntries(accounts.map(a=>[a,[]]))
  const operators=new Map(accounts.map(a=>[a,new Set(prior[a]??[])]))
  const set=getAbiItem({abi:binding('SentinelAccount',accounts[0]).abi,name:'OperatorSet'})
  const from=cache?BigInt(cache.block)+1n:first
  for(let start=from;start<=head.number;start+=800n){
    const queries=[]
    for(let at=start;at<start+800n && at<=head.number;at+=100n){
      const toBlock=at+99n<head.number?at+99n:head.number
      const page=rpc=>rpc.getLogs({address:accounts,event:set,strict:true,fromBlock:at,toBlock})
      queries.push(retryRead(async()=>{
        const logs=await page(s.client)
        if(s.live){
          const witness=await page(s.witness)
          const positions=xs=>xs.map(x=>[x.blockHash,x.transactionHash,x.logIndex,x.address.toLowerCase(),x.args.operator.toLowerCase()]).sort()
          assert.deepEqual(positions(logs),positions(witness),'RPCs disagree on v1 grant history')
        }
        return logs
      }))
    }
    for(const log of (await Promise.all(queries)).flat()){
      assert(!log.removed)
      operators.get(getAddress(log.address)).add(getAddress(log.args.operator))
    }
  }
  assert.equal((await retryRead(()=>s.client.getBlock({blockNumber:head.number}))).hash,head.hash)
  if(s.live)assert.equal((await retryRead(()=>s.witness.getBlock({blockNumber:head.number}))).hash,head.hash)
  const result=Object.fromEntries([...operators].map(([a,set])=>[a,[...set].sort()]))
  s.state.plan.v1Operators={block:String(head.number),hash:head.hash,operators:result};s.save()
  return result
}

async function stateAt(s,m,boxes) {
  const head=await s.head(),discovered=await discoverV1(s,m,head),v1={}
  for(const [market,entry] of Object.entries(m.markets)){
    const c=binding('SentinelAccount',entry.account),configured=[]
    requireEqual(await read(s,c,'owner',[],head.number),m.owner)
    for(const operator of discovered[c.address]){
      const [mask]=await read(s,c,'operators',[operator],head.number)
      if(mask!==0)configured.push(operator)
    }
    v1[market]={account:c.address,discovered:discovered[c.address],configured,trigger:await read(s,c,'autoRepayTriggerBps',[],head.number)}
  }
  return {head,v1,count:await read(s,boxes.account,'operatorCount',[],head.number)}
}
const stopped=x=>x.count===0n && Object.values(x.v1).every(v=>v.configured.length===0 && v.trigger===0)

export async function revoke(s,m,boxes) {
  const initial=await stateAt(s,m,boxes)
  if(!s.state.plan.stopRounds){
    const legacy=s.state.steps['revoke-swap']
    s.state.plan.stopRounds=legacy?.status==='success'?[{index:0,completed:true,hashes:Object.fromEntries(
      ['revoke-repay','clear-trigger','revoke-swap'].filter(key=>s.state.steps[key]?.hash).map(key=>[key,s.state.steps[key].hash]))}]:[]
  }
  const rounds=s.state.plan.stopRounds
  let round=rounds.at(-1)
  if(!stopped(initial) && (!round || round.completed)){
    round={index:rounds.length,v1:initial.v1,count:String(initial.count),hashes:{}};rounds.push(round);s.save()
  }
  if(round && !round.completed){
    const suffix=round.index?'-round-'+round.index:''
    for(const [key,entry] of Object.entries(round.v1)){
      const account=binding('SentinelAccount',entry.account)
      for(const operator of entry.configured){
        const label=key==='A' && operator===m.operator?'revoke-repay':'revoke-'+key+'-'+operator
        const r=await call(s,label+suffix,'owner',account,'revokeOperator',[operator])
        round.hashes[label]=r.transactionHash;s.save()
      }
      if(entry.trigger!==0){
        const label=key==='A'?'clear-trigger':'clear-trigger-'+key
        const r=await call(s,label+suffix,'owner',account,'setAutoRepayTrigger',[0])
        round.hashes[label]=r.transactionHash;s.save()
      }
    }
    if(BigInt(round.count)>0n){
      const r=await call(s,'revoke-swap'+suffix,'owner',boxes.account,'revokeAllOperators')
      round.hashes['revoke-swap']=r.transactionHash;s.save()
    }
    round.completed=true;s.save()
  }
  const end=await stateAt(s,m,boxes)
  assert(stopped(end),'Another owner authorization appeared during revocation. Run revoke again.')
  const hash=key=>round?.hashes?.[key]??s.state.steps[key]?.hash??null
  return {profile:s.profile,campaign:s.campaign,chainId:1952,owner:m.owner,repayRevoked:hash('revoke-repay'),triggerCleared:hash('clear-trigger'),
    allV2Revoked:hash('revoke-swap'),block:String(end.head.number),blockHash:end.head.hash,v1:end.v1,operators:0}
}

import { TestnetTokenAbi } from '@peridot/chain-config'
import { decodeErrorResult, getAddress, keccak256 } from 'viem'
import { confirmedRead, jsonSafe, profile as v1 } from '../../packages/sentinel-sdk/index.mjs'
import { quote } from '../onchainos/quote.mjs'
import { abi, campaign, database, deniedBorrow, maximumInput, operator, owner, raw, reject, submitted } from './policy.mjs'

const eq=(a,b)=>getAddress(a)===getAddress(b)
export async function observe(m,action,options={}) {
  const result=await confirmedRead(action,{...options,minimum:options.minimum??BigInt(m.swap.block)})
  return jsonSafe({chainId:1952,profile:'Public testnet, inventory-funded mock WOKB/USDC, mock feed and development reference processor',source:m.source.expansionCommit,block:result.block,data:result.data})
}
export async function verifyProfile(m,ctx) {
  const c=m.contracts
  const [registered,actualOwner,swap,lending,policy,controller,book,loan,debtToken,router,pool,identity,processor,id]=await Promise.all([
    ctx.read(c.factory,abi.SentinelAccountFactoryV2,'accountOf',[owner]),
    ...['owner','swapAdapter','lendingAdapter','executionPolicy','controller','collateralMarket','debtMarket','debtAsset'].map(fn=>ctx.read(c.account,abi.SentinelAccountV2,fn)),
    ctx.read(c.swap,abi.SinglePoolSwapAdapter,'router'),ctx.read(c.swap,abi.SinglePoolSwapAdapter,'pool'),
    ctx.read(c.execution,abi.ExecutionPolicy,'NETLIST_HASH'),ctx.read(c.execution,abi.ExecutionPolicy,'processor'),ctx.read(c.execution,abi.ExecutionPolicy,'circuitId'),
  ])
  if(!eq(registered,c.account)||!eq(actualOwner,owner)||!eq(swap,c.swap)||!eq(lending,c.lending)||!eq(policy,c.execution)||
    !eq(controller,v1.controller)||!eq(book,v1.collateralMarket)||!eq(loan,v1.debtMarket)||!eq(debtToken,v1.debtAsset)||
    !eq(pool,c.venue)||!eq(router,c.venue)||identity!==m.execution.netlistHash||!eq(processor,c.cpu)||String(id)!==m.execution.circuitId)
    reject('PROFILE_MISMATCH','Account, venue or circuit binding differs from the public manifest')
  await Promise.all(['account','factory','swap','lending','execution','cpu','venue','mockWokb','mockUsdc'].map(async name=>{
    const code=await ctx.client.getCode({address:c[name],blockNumber:ctx.block.number})
    if(!code || keccak256(code)!==m.runtimeCodeHashes[name]) reject('PROFILE_MISMATCH','Deployed code differs from public manifest')
  }))
}
export async function snapshot(m,ctx) {
  const c=m.contracts
  const [grant,borrowGrant,exposure,inputs,outputs,count,policyId,allowance,venueAllowance]=await Promise.all([
    ctx.read(c.account,abi.SentinelAccountV2,'grants',[operator,c.swap,5,c.mockWokb]),
    ctx.read(c.account,abi.SentinelAccountV2,'grants',[operator,c.lending,2,v1.debtAsset]),
    ctx.read(c.account,abi.SentinelAccountV2,'exposure'),ctx.read(c.mockWokb,TestnetTokenAbi,'balanceOf',[c.account]),
    ctx.read(c.mockUsdc,TestnetTokenAbi,'balanceOf',[c.account]),ctx.read(c.account,abi.SentinelAccountV2,'operatorCount'),
    ctx.read(c.account,abi.SentinelAccountV2,'policyId'),ctx.read(c.mockWokb,TestnetTokenAbi,'allowance',[c.account,c.swap]),
    ctx.read(c.mockWokb,TestnetTokenAbi,'allowance',[c.swap,c.venue]),
  ])
  return {owner,operator,account:c.account,swapAdapter:c.swap,lendingAdapter:c.lending,
    enteredLendingPolicy:policyId,execution:{binding:c.execution,processor:c.cpu,circuitId:m.execution.circuitId,
      netlistHash:m.execution.netlistHash,policyMaxLossBps:100,solidityMaxLossBps:500},
    marketPair:{input:c.mockWokb,inputDecimals:18,output:c.mockUsdc,outputDecimals:6},
    idle:{inputRaw:inputs,outputRaw:outputs},book:{collateralBook:v1.collateralMarket,sharesRaw:exposure[0],debtBook:v1.debtMarket,debtRaw:exposure[1]},
    configuredOperators:count,swapGrant:{maxPerCallRaw:grant[0],remainingRaw:grant[1],expiry:grant[2]},
    borrowGrant:{maxPerCallRaw:borrowGrant[0],remainingRaw:borrowGrant[1],expiry:borrowGrant[2]},allowance,venueAllowance}
}
export function permitted(view,amount,now) {
  const g=view.swapGrant
  if(amount>maximumInput || g.expiry<=now || g.maxPerCallRaw>maximumInput || g.remainingRaw>2n*maximumInput ||
    amount>g.maxPerCallRaw || amount>g.remainingRaw || amount>view.idle.inputRaw) reject('OPERATOR_BUDGET','Amount outside the current owner grant, input balance or campaign cap')
}
export async function accountInfo(m) {
  return observe(m,async ctx=>{
    await verifyProfile(m,ctx)
    return {...await snapshot(m,ctx),campaign:{id:campaign(m),swap:submitted(database(),m,'swap')??null,negative:submitted(database(),m,'deniedBorrow')??null}}
  })
}
export async function market(m,{amountInRaw}) {
  const amount=raw(amountInRaw,maximumInput)
  const result=await observe(m,async ctx=>{
    await verifyProfile(m,ctx)
    const [expected,floor,timestamp]=await ctx.read(m.contracts.swap,abi.SinglePoolSwapAdapter,'executionQuote',[m.contracts.mockWokb,amount])
    const policyMin=(expected*9900n+9999n)/10000n
    return {amountInRaw,expectedOutRaw:expected,hardMinimumOutRaw:floor,policyMinimumOutRaw:policyMin,feedTimestamp:timestamp}
  })
  const requestedAt=new Date().toISOString()
  let external
  if(!['OKX_API_KEY','OKX_API_SECRET','OKX_API_PASSPHRASE'].every(k=>process.env[k])) {
    external={status:'unavailable',reason:'OKX_CREDENTIALS_UNAVAILABLE',quote:null}
  } else {
    try {external={status:'quoted',quote:await quote('WOKB',amountInRaw)}}
    catch {external={status:'unavailable',reason:'OKX_QUOTE_UNAVAILABLE',quote:null}}
  }
  return {...result,onchainOS:{source:'OKX OnchainOS',chainId:196,requestedAt,kind:'Informational real WOKB/USDC quote; settlement uses independent mock testnet prices.',...external}}
}
export async function deniedSimulation(client,address,blockOpts) {
  try {
    await client.simulateContract({account:operator,address,abi:abi.SentinelAccountV2,functionName:'borrow',args:[deniedBorrow],...blockOpts})
  } catch(e) {
    for(let err=e;err;err=err.cause){
      const data=typeof err.data==='string'?err.data:err.raw??err.data?.data
      if(typeof data==='string' && data.startsWith('0x')){
        const decoded=decodeErrorResult({abi:abi.SentinelAccountV2,data})
        if(decoded.errorName==='OperatorNotAuthorized')return {status:'simulated-rejection',method:'eth_call',revertData:data,error:decoded.errorName}
        reject('OTHER_DENIAL','Borrow reverted with a different reason')
      }
    }
    throw e
  }
  reject('BORROW_ALLOWED','Fixed borrow would succeed; negative operation suspended')
}

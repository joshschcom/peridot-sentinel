import { createWalletClient, decodeFunctionResult, getAddress, http, keccak256, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { clients, endpoints, jsonSafe, profile as v1 } from '../../packages/sentinel-sdk/index.mjs'
import { abi, calldata, campaign, database, deniedBorrow, loadProposal, maxCampaignFeePerTx, maximumInput,
  operator, proposalId, raw, reject, submitted } from './policy.mjs'
import { deniedSimulation, observe, permitted, snapshot, verifyProfile } from './state.mjs'

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const same=(a,b)=>getAddress(a)===getAddress(b)
function matchBorrowGrant(state){
  if(state.borrowGrant.maxPerCallRaw!==0n || state.borrowGrant.remainingRaw!==0n || state.borrowGrant.expiry!==0n)
    reject('GRANT_MISMATCH','Negative exercise requires an absent borrow grant')
}
function unchangedGrant(body,state){
  if(JSON.stringify(body.swapGrant)!==JSON.stringify(jsonSafe(state.swapGrant)))
    reject('PROPOSAL_CHANGED','Observed swap grant changed since simulation')
}
export async function propose(m,op,args) {
  const db=database()
  const recorded=submitted(db,m,op)
  if(recorded)return {status:'already-submitted',proposalId:recorded.id,hash:recorded.hash}
  const confirmed=await observe(m,async ctx=>{
    await verifyProfile(m,ctx)
    const state=await snapshot(m,ctx)
    const deadline=ctx.block.timestamp+300n
    const data=calldata(m,op,args,deadline)
    let simulation
    if(op==='swap'){
      permitted(state,raw(args.amountInRaw,maximumInput),ctx.block.timestamp)
      const result=await ctx.client.call({account:operator,to:m.contracts.account,data,blockNumber:ctx.block.number})
      const output=decodeFunctionResult({abi:abi.SentinelAccountV2,functionName:'swapExactIn',data:result.data})
      if(output<raw(args.minOutRaw)) reject('SIMULATION_MISMATCH','Simulated output below caller minimum')
      simulation={status:'simulated-success',method:'eth_call',amountOutRaw:output}
    }else{
      matchBorrowGrant(state)
      simulation=await deniedSimulation(ctx.client,m.contracts.account,{blockNumber:ctx.block.number})
    }
    return {deadline,data,swapGrant:state.swapGrant,simulation}
  })
  const body={campaign:campaign(m),operation:op,commit:m.source.expansionCommit,chainId:1952,
    operator,account:m.contracts.account,valueWei:'0',args,deadline:confirmed.data.deadline,
    calldata:confirmed.data.data,swapGrant:confirmed.data.swapGrant,simulation:confirmed.data.simulation,block:confirmed.block}
  const id=proposalId(body)
  db.propose(id,body)
  return {status:'proposed',proposalId:id,...body}
}
export function rejectedState(before,after) {
  const prior=jsonSafe(before),next=jsonSafe(after)
  const preserved=Object.fromEntries(['swapGrant','borrowGrant','idle','book','allowance','venueAllowance'].map(field=>[
    field,JSON.stringify(prior[field])===JSON.stringify(next[field]),
  ]))
  return {preserved,preservedState:Object.values(preserved).every(Boolean)}
}
export function swapStatus(matches) {return matches?'confirmed-swap':'mined-swap-needs-review'}
export async function verifyReceipt(m,id,body,row,r) {
  const c=m.contracts
  const before=await observe(m,ctx=>snapshot(m,ctx),{at:r.blockNumber-1n,minimum:r.blockNumber})
  const result=await observe(m,async ctx=>{
    if(ctx.block.hash!==r.blockHash)reject('REORG','Receipt no longer matches canonical block')
    const tx=await ctx.client.getTransaction({hash:r.transactionHash})
    if(tx.hash!==row.hash || tx.chainId!==1952 || tx.blockHash!==r.blockHash || !same(tx.from,operator) ||
      tx.nonce!==row.nonce || !same(tx.to,c.account) || tx.input!==body.calldata || tx.value!==0n)
      reject('RECEIPT_MISMATCH','Canonical transaction differs from the reserved proposal')
    const after=await snapshot(m,ctx)
    const receipt={hash:tx.hash,from:tx.from,to:tx.to,nonce:tx.nonce,input:tx.input,valueWei:tx.value,
      blockNumber:r.blockNumber,blockHash:r.blockHash,status:r.status,gasUsed:r.gasUsed,gasLimit:tx.gas}
    if(body.operation==='deniedBorrow'){
      if(r.status!=='reverted' || r.logs.length!==0 || r.gasUsed>=tx.gas) reject('UNEXPECTED_MINED_RESULT','Review fixed borrow receipt')
      const replay=await deniedSimulation(ctx.client,c.account,{blockNumber:r.blockNumber})
      const checked=rejectedState(before.data,after)
      return {status:checked.preservedState?'mined-revert':'mined-revert-needs-review',receipt,...checked,
        replay:{...replay,source:'eth_call at canonical receipt block'},beforeBlock:before.block,before:before.data,after,borrowAmountRaw:deniedBorrow,
        stateScope:'Grants, book positions, idle balances and allowances are compared at the ends of the parent and receipt blocks.'}
    }
    if(r.status!=='success') return {status:'mined-revert',receipt,before:before.data,after}
    const settled=parseEventLogs({abi:abi.SentinelAccountV2,eventName:'SwapSettled',strict:true,logs:r.logs}).filter(l=>same(l.address,c.account))
    const venue=parseEventLogs({abi:abi.SinglePoolSwapAdapter,eventName:'Swapped',strict:true,logs:r.logs}).filter(l=>same(l.address,c.swap))
    if(settled.length!==1 || venue.length!==1) reject('RECEIPT_MISMATCH','Missing unique settlement events')
    const e=settled[0].args,v=venue[0].args,amount=BigInt(body.args.amountInRaw),minimum=BigInt(body.args.minOutRaw)
    if(!same(e.operator,operator)||!same(e.tokenIn,c.mockWokb)||!same(e.tokenOut,c.mockUsdc)||e.amountIn!==amount||e.amountOut<minimum||
      !same(v.account,c.account)||!same(v.input,c.mockWokb)||!same(v.output,c.mockUsdc)||v.amountIn!==amount||v.amountOut!==e.amountOut||
      after.allowance!==0n||after.venueAllowance!==0n||e.slippageBps>100) reject('RECEIPT_MISMATCH','Event or observed approvals disagree with proposal')
    const grantChargedRaw=BigInt(before.data.swapGrant.remainingRaw)-after.swapGrant.remainingRaw
    const inputBalanceSpentRaw=BigInt(before.data.idle.inputRaw)-after.idle.inputRaw
    const outputBalanceGainedRaw=after.idle.outputRaw-BigInt(before.data.idle.outputRaw)
    const budgetAndBalancesMatch=grantChargedRaw===amount && inputBalanceSpentRaw===amount && outputBalanceGainedRaw===e.amountOut
    return {status:swapStatus(budgetAndBalancesMatch),receipt,grantChargedRaw,inputBalanceSpentRaw,outputBalanceGainedRaw,budgetAndBalancesMatch,settled:e,adapterSettled:v,beforeBlock:before.block,before:before.data,after,
      stateScope:'Changes in grant and balances are end-of-block observations. Both events report this exact transaction.'}
  },{at:r.blockNumber,minimum:r.blockNumber})
  return {proposalId:id,chainId:1952,...result.data,confirmations:result.block.confirmations}
}
export async function receipt(m,id) {
  const db=database()
  const {row,body}=loadProposal(db,m,id)
  if(!row.hash)return {status:'not-submitted',proposalId:id}
  let r
  for(const client of clients) {
    try {r=await client.getTransactionReceipt({hash:row.hash});break}catch{}
  }
  if(!r)return {status:'pending-or-unknown',proposalId:id,hash:row.hash,nonce:row.nonce}
  const result=await verifyReceipt(m,id,body,row,r)
  db.settle(id,row.hash,result)
  return result
}
function signer() {
  const key=(process.env.SENTINEL_OPERATOR_KEY??'').trim().replace(/^0x/i,'')
  if(!/^[0-9a-f]{64}$/i.test(key)) reject('SIGNER_UNAVAILABLE','Dedicated 1952 operator environment required')
  const account=privateKeyToAccount('0x'+key)
  if(!same(account.address,operator)) reject('SIGNER_MISMATCH','Expected dedicated D9 operator')
  return account
}
export async function execute(m,id,op){
  const db=database()
  const {row,body}=loadProposal(db,m,id,op)
  if(row.hash)return receipt(m,id)
  const prior=submitted(db,m,op)
  if(prior) return {status:'campaign-operation-already-submitted',proposalId:prior.id,hash:prior.hash}
  if(process.env.SENTINEL_V2_ENABLE_EXECUTE!=='1' || (op==='deniedBorrow'&&process.env.SENTINEL_V2_ENABLE_MINED_REJECTION!=='1'))
    reject('EXECUTION_DISABLED','Campaign signing is disabled')
  const expectedBlock=await observe(m,({block})=>block.hash,{at:BigInt(body.block.number)})
  if(expectedBlock.data!==body.block.hash)reject('REORG','Proposal block changed')
  await observe(m,async ctx=>{
    await verifyProfile(m,ctx)
    const state=await snapshot(m,ctx)
    if(ctx.block.timestamp>=BigInt(body.deadline))reject('PROPOSAL_EXPIRED','Simulate a fresh proposal')
    unchangedGrant(body,state)
    if(op==='swap')permitted(state,raw(body.args.amountInRaw,maximumInput),ctx.block.timestamp)
    else matchBorrowGrant(state)
  })
  // All operations before reservation are reads. Only one sendRawTransaction can follow reservation.
  const rpc=clients[0]
  let pending
  for(let i=0;i<3 && !pending;i++){
    try {
      const latest=await rpc.getBlock()
      if(latest.number<BigInt(body.block.number) || latest.timestamp>=BigInt(body.deadline))reject('PROPOSAL_EXPIRED','Proposal expired or the head is stale')
      const read=(address,a,fn,args=[])=>rpc.readContract({address,abi:a,functionName:fn,args,blockTag:'pending'})
      const state=await snapshot(m,{read})
      unchangedGrant(body,state)
      let limit
      if(op==='swap'){
        permitted(state,raw(body.args.amountInRaw,maximumInput),latest.timestamp)
        const result=await rpc.call({account:operator,to:m.contracts.account,data:body.calldata,blockTag:'pending'})
        const output=decodeFunctionResult({abi:abi.SentinelAccountV2,functionName:'swapExactIn',data:result.data})
        if(output<BigInt(body.args.minOutRaw))reject('PROPOSAL_CHANGED','Pending swap misses minimum')
        const estimate=await rpc.estimateGas({account:operator,to:m.contracts.account,data:body.calldata})
        limit=estimate+(estimate+2n)/3n+30000n
      }else{
        matchBorrowGrant(state)
        await deniedSimulation(rpc,m.contracts.account,{blockTag:'pending'})
        limit=300000n
      }
      const [chainId,gasPrice,nonce,current,witness,balance]=await Promise.all([
        rpc.getChainId(),rpc.getGasPrice(),rpc.getTransactionCount({address:operator,blockTag:'pending'}),
        rpc.getTransactionCount({address:operator}),clients[1].getTransactionCount({address:operator}),rpc.getBalance({address:operator}),
      ])
      if(chainId!==1952 || await clients[1].getChainId()!==1952)reject('WRONG_CHAIN','Expected chain 1952')
      if(nonce!==current || nonce!==witness)throw Error('Nonce lane is busy or observations disagree')
      if(limit>2_000_000n || limit*gasPrice>maxCampaignFeePerTx || limit*gasPrice>balance) reject('GAS_BUDGET','Fee limit or gas balance exceeded')
      pending={limit,gasPrice,nonce}
    } catch(e){if(e.code && typeof e.code==='string')throw e;if(i===2)throw e;await wait(350*(i+1))}
  }
  const wallet=createWalletClient({chain:v1.chain,account:signer(),transport:http(endpoints[0],{retryCount:0})})
  const signed=await wallet.signTransaction({chain:v1.chain,type:'legacy',to:m.contracts.account,value:0n,
    data:body.calldata,gas:pending.limit,nonce:pending.nonce,gasPrice:pending.gasPrice})
  const hash=keccak256(signed)
  if(!db.reserve(id,hash,pending.nonce,m.contracts.account))return receipt(m,id)
  try {
    if(await rpc.sendRawTransaction({serializedTransaction:signed})!==hash)throw Error('Hash mismatch')
  } catch{return {status:'submission-unknown',proposalId:id,hash,nonce:pending.nonce}}
  for(let i=0;i<12;i++){
    await wait(1000)
    try {const result=await receipt(m,id);if(result.status!=='pending-or-unknown')return result}
    catch(e){if(!['STALE_RPC','RPC_UNAVAILABLE'].includes(e.code))throw e}
  }
  return {status:'pending-or-unknown',proposalId:id,hash,nonce:pending.nonce}
}

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {decodeFunctionResult} from 'viem'
import {clients} from '../../packages/sentinel-sdk/index.mjs'
import {abi,loadProposal,operator,publicManifest} from './policy.mjs'
import {catalog,validate} from './server.mjs'
import {deniedSimulation,observe,verifyProfile} from './state.mjs'
import {verifyReceipt} from './execution.mjs'

const prefix='mcp__sentinel__'
function responseValue(content) {
  if(typeof content==='string') return responseValue(JSON.parse(content))
  if(Array.isArray(content)) return responseValue(content.find(item=>item.type==='text')?.text)
  if(content?.structuredContent) return responseValue(content.structuredContent)
  if(content?.content && !content.status && !content.data) return responseValue(content.content)
  return content?.result??content
}
export function parseTranscript(events) {
  assert(events.some(e=>e.type==='system' && e.subtype==='init'),'Missing genuine Claude CLI init record')
  assert(events.some(e=>e.type==='result' && e.subtype==='success' && !e.is_error),'Missing successful Claude CLI result')
  const calls=new Map()
  for(const event of events){
    if(event.type==='assistant'){
      for(const call of event.message?.content??[]){
        if(call.type!=='tool_use')continue
        assert(call.name?.startsWith(prefix),'Unexpected tool outside campaign')
        const tool=call.name.slice(prefix.length)
        validate(tool,call.input)
        assert(event.message.model && !calls.has(call.id),'Missing model or duplicate tool call ID')
        calls.set(call.id,{id:call.id,tool,args:call.input,model:event.message.model})
      }
    }else if(event.type==='user'){
      for(const response of event.message?.content??[]){
        if(response.type!=='tool_result')continue
        const call=calls.get(response.tool_use_id)
        assert(call && !Object.hasOwn(call,'output'),'Unmatched or repeated tool result')
        if(response.is_error){call.error=true;continue}
        call.output=responseValue(response.content)
      }
    }
  }
  const list=[...calls.values()].filter(c=>!c.error && c.output)
  for(const t of catalog) assert(list.some(c=>c.tool===t.name),'Missing completed tool '+t.name)
  return list
}
function resultFor(calls,tool,test) {
  const found=calls.find(c=>c.tool===tool && test(c))
  assert(found,'Missing matching '+tool+' response')
  return found
}
async function proof(m,calls,op){
  const isSwap=op==='swap'
  const simulate=isSwap?'simulate_and_propose_swap':'simulate_denied_borrow'
  const send=isSwap?'execute_swap':'mine_denied_borrow'
  const issuing=resultFor(calls,simulate,c=>c.output.status==='proposed' && c.output.operation===op)
  const {status,proposalId:id,...body}=issuing.output
  const sent=resultFor(calls,send,c=>c.args.proposalId===id)
  const reconciled=resultFor(calls,'get_receipt',c=>c.args.proposalId===id && c.output.proposalId===id && c.output.receipt)
  assert(calls.indexOf(issuing)<calls.indexOf(sent) && calls.indexOf(sent)<calls.indexOf(reconciled),'Invalid operation order')
  assert.deepEqual(body.args,issuing.args)
  assert.equal(body.simulation.status,isSwap?'simulated-success':'simulated-rejection')
  const tx=reconciled.output.receipt
  assert.equal(tx.hash,sent.output.receipt?.hash??sent.output.hash)
  const row={hash:tx.hash,nonce:tx.nonce,body:JSON.stringify(body)}
  loadProposal({get:()=>row},m,id,op)
  const simulation=await observe(m,async ctx=>{
    await verifyProfile(m,ctx)
    assert.equal(ctx.block.hash,body.block.hash,'Simulation block changed')
    if(!isSwap) return deniedSimulation(ctx.client,m.contracts.account,{blockNumber:ctx.block.number})
    const value=await ctx.client.call({account:operator,to:m.contracts.account,data:body.calldata,blockNumber:ctx.block.number})
    return {amountOutRaw:decodeFunctionResult({abi:abi.SentinelAccountV2,functionName:'swapExactIn',data:value.data})}
  },{at:BigInt(body.block.number)})
  if(isSwap)assert.equal(simulation.data.amountOutRaw,body.simulation.amountOutRaw)
  else assert.equal(simulation.data.revertData,body.simulation.revertData)
  const chainReceipt=await Promise.any(clients.map(rpc=>rpc.getTransactionReceipt({hash:tx.hash})))
  const canonical=await verifyReceipt(m,id,body,row,chainReceipt)
  assert.deepEqual(canonical.receipt,tx)
  assert.equal(canonical.status,isSwap?'confirmed-swap':'mined-revert')
  if(isSwap) {
    assert.equal(canonical.budgetAndBalancesMatch,true)
    assert(BigInt(body.args.amountInRaw)<BigInt(body.swapGrant.remainingRaw),'Swap consumed entire remaining budget')
  } else {
    assert.equal(canonical.replay.error,'OperatorNotAuthorized')
    assert.equal(canonical.preservedState,true)
    assert.deepEqual(canonical.before.swapGrant,canonical.after.swapGrant)
    assert.deepEqual(canonical.before.borrowGrant,canonical.after.borrowGrant)
    assert.deepEqual(canonical.before.idle,canonical.after.idle)
  }
  return {proposalId:id,model:issuing.model,chosenArgs:issuing.args,simulatedAt:body.block,simulation:body.simulation,canonical}
}
export async function verifyTranscript(path){
  const events=readFileSync(path,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line))
  const calls=parseTranscript(events)
  const m=publicManifest(), swap=await proof(m,calls,'swap'), rejection=await proof(m,calls,'deniedBorrow')
  const market=resultFor(calls,'read_market',c=>c.args.amountInRaw===swap.chosenArgs.amountInRaw)
  const account=resultFor(calls,'read_account',c=>c.output.data?.account===m.contracts.account)
  const chosen=calls.find(c=>c.tool==='simulate_and_propose_swap' && c.output.proposalId===swap.proposalId)
  assert(calls.indexOf(account)<calls.indexOf(chosen) && calls.indexOf(market)<calls.indexOf(chosen),'Missing account and market reads before simulation')
  assert(['quoted','unavailable'].includes(market.output.onchainOS?.status),'Missing external market-data status')
  assert.equal(market.output.onchainOS.chainId,196)
  assert.equal(market.output.chainId,1952)
  return {label:'Recorded Claude CLI session with independently re-read public 1952 receipts',source:m.source.expansionCommit,
    account:m.contracts.account,operator,market:market.output,swap,rejection}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  assert(process.argv.length===3,'Expected one path to the complete Claude stream-json transcript')
  console.log(JSON.stringify(await verifyTranscript(process.argv[2]),null,2))
}

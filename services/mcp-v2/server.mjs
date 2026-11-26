import {pathToFileURL} from 'node:url'
import {Server,StdioServerTransport,CallToolRequestSchema,ListToolsRequestSchema} from '../mcp/runtime/protocol.mjs'
import {ConnectError,jsonSafe} from '../../packages/sentinel-sdk/index.mjs'
import {isId,publicManifest,raw,reject} from './policy.mjs'
import {accountInfo,market} from './state.mjs'
import {execute,propose,receipt} from './execution.mjs'

const amount={type:'string',pattern:'^[1-9][0-9]{0,77}$'}
const id={type:'string',pattern:'^0x[0-9a-f]{64}$'}
export const catalog=Object.entries({
  read_account:['Read confirmed account, lending book exposure, mock idle assets, policy, remaining grants and submitted campaign transactions.',{}],
  read_market:['Read a normalized quote from the 1952 inventory-backed mock and request separate, informational 196 OKX market data for the chosen input.',{amountInRaw:amount}],
  simulate_and_propose_swap:['Simulate exact WOKB mock input and minimum mUSDC output chosen by the owner-authorized agent. Save typed parameters and immutable deadline under a proposal ID.',{amountInRaw:amount,minOutRaw:amount}],
  execute_swap:['Execute or reconcile one previously simulated fixed-pair swap on 1952, using its persisted proposal ID.',{proposalId:id}],
  simulate_denied_borrow:['Simulate a fixed 1-raw-unit borrow by the swap operator. On an exact authorization denial, save its bounded negative-demo proposal.',{}],
  mine_denied_borrow:['Once per account campaign, submit the simulated 1-raw-unit unauthorized borrow with explicit gas to demonstrate a mined revert. Costs testnet gas.',{proposalId:id}],
  get_receipt:['Read canonical receipt, matching event or decoded replay, block and resulting authorization, without submitting.',{proposalId:id}],
}).map(([name,[description,properties]])=>({name,description,inputSchema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}))

export function validate(name,args){
  const tool=catalog.find(t=>t.name===name)
  if(!tool || args===null || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).length!==tool.inputSchema.required.length || tool.inputSchema.required.some(k=>!Object.hasOwn(args,k)))
    reject('INVALID_ARGUMENT','Expected exactly the typed arguments for this tool')
  for(const k of tool.inputSchema.required) {
    if(k==='proposalId'){if(!isId(args[k]))reject('INVALID_ARGUMENT','Expected a locally issued proposal ID')}
    else raw(args[k])
  }
}
export async function handle(name,args={}){
  try{
    validate(name,args)
    const m=publicManifest()
    let value
    switch(name){
      case 'read_account':value=await accountInfo(m);break
      case 'read_market':value=await market(m,args);break
      case 'simulate_and_propose_swap':value=await propose(m,'swap',args);break
      case 'simulate_denied_borrow':value=await propose(m,'deniedBorrow',args);break
      case 'execute_swap':value=await execute(m,args.proposalId,'swap');break
      case 'mine_denied_borrow':value=await execute(m,args.proposalId,'deniedBorrow');break
      case 'get_receipt':value=await receipt(m,args.proposalId);break
    }
    const result=jsonSafe(value)
    return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}}
  }catch(e){
    const error=e instanceof ConnectError?{code:e.code,message:e.message}:{code:'REQUEST_FAILED',message:'Read or simulation unavailable, denied, or pending. Reconcile a submitted proposal using get_receipt.'}
    return {isError:true,content:[{type:'text',text:JSON.stringify(error)}],structuredContent:{error}}
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=new Server({name:'sentinel-connect-v2',version:'2.0.0'},{capabilities:{tools:{}}})
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:catalog}))
  server.setRequestHandler(CallToolRequestSchema,req=>handle(req.params.name,req.params.arguments))
  await server.connect(new StdioServerTransport())
}

import {after,test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs'
import {resolve} from 'node:path'
import {Client,StdioClientTransport} from '../../mcp/runtime/protocol.mjs'
import {environments,openBridge} from '../host.mjs'
import {rejectedState,swapStatus} from '../execution.mjs'
import {catalog} from '../server.mjs'
import {parseTranscript} from '../verify-transcript.mjs'

mkdirSync('services/mcp-v2/.state',{recursive:true})
const dir=mkdtempSync('services/mcp-v2/.state/host-')
after(()=>rmSync(dir,{force:true,recursive:true}))

test('Claude and its real stdio bridge receive only a socket; separate MCP gets only required signing and quote values',async()=>{
  const sock=resolve(dir,'m.sock')
  const e=environments({PATH:process.env.PATH,KEEPER_TESTNET_OPERATOR_KEY:'fake-d9',OKX_API_KEY:'fake-api',OKX_API_SECRET:'fake-secret',
    OKX_API_PASSPHRASE:'fake-pass',PERIDOT_TESTNET_KEY:'fake-owner',CLAUDE_CODE_OAUTH_TOKEN:'fake-host'},sock)
  assert.deepEqual(Object.keys(e.host).sort(),['PATH','CLAUDE_CODE_OAUTH_TOKEN','SENTINEL_MCP_SOCKET'].sort())
  assert.deepEqual(Object.keys(e.mcp).sort(),['PATH','SENTINEL_OPERATOR_KEY','OKX_API_KEY','OKX_API_SECRET','OKX_API_PASSPHRASE',
    'SENTINEL_V2_ENABLE_EXECUTE','SENTINEL_V2_ENABLE_MINED_REJECTION'].sort())
  const close=await openBridge(sock,e.mcp)
  const client=new Client({name:'unsigned-campaign-test',version:'1.0'})
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['services/mcp-v2/bridge.mjs'],env:e.host}))
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),catalog.map(t=>t.name))
  }finally{await client.close();close()}
})
test('receipt state conflicts require review; all relevant state must be preserved for a mined rejection',()=>{
  const state={swapGrant:{remainingRaw:'100'},borrowGrant:{remainingRaw:'0'},idle:{inputRaw:'20'},book:{debtRaw:'3'},allowance:'0',venueAllowance:'0'}
  assert.equal(rejectedState(state,state).preservedState,true)
  for(const key of Object.keys(state)){
    const check=rejectedState(state,{...state,[key]:'changed'})
    assert.equal(check.preservedState,false);assert.equal(check.preserved[key],false)
  }
  assert.equal(swapStatus(false),'mined-swap-needs-review');assert.equal(swapStatus(true),'confirmed-swap')
})
test('transcript parser requires complete model/tool-result links and excludes non-campaign tool calls',()=>{
  const events=[{type:'system',subtype:'init'}]
  for(const t of catalog){
    const input=Object.fromEntries(t.inputSchema.required.map(k=>[k,k==='proposalId'?'0x'+'a'.repeat(64):'1']))
    events.push({type:'assistant',message:{model:'test-fixture',content:[{type:'tool_use',id:t.name,name:'mcp__sentinel__'+t.name,input}]}})
    events.push({type:'user',message:{content:[{type:'tool_result',tool_use_id:t.name,content:[{type:'text',text:'{"status":"fixture"}'}]}]}})
  }
  events.push({type:'result',subtype:'success'})
  assert.equal(parseTranscript(events).length,7)
  assert.throws(()=>parseTranscript(events.slice(0,-1)))
  const invalid=structuredClone(events);invalid[1].message.content[0].name='Bash'
  assert.throws(()=>parseTranscript(invalid))
})

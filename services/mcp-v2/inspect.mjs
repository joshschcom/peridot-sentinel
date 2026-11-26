import { Client, StdioClientTransport } from '../mcp/runtime/protocol.mjs'

const client = new Client({name:'sentinel-v2-scripted-read-evidence',version:'1.0.0'})
async function read(name,args={}) {
  const response=await client.callTool({name,arguments:args},undefined,{timeout:120000})
  if(response.isError) throw new Error(name+' '+JSON.stringify(response.structuredContent))
  return response.structuredContent.result
}
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:['services/mcp-v2/server.mjs'],
    env:{SENTINEL_V2_ENABLE_EXECUTE:'0',SENTINEL_V2_ENABLE_MINED_REJECTION:'0'}}))
  const tools=(await client.listTools()).tools.map(t=>t.name)
  const account=await read('read_account')
  const amountInRaw=(10n**18n/4n).toString()
  const market=await read('read_market',{amountInRaw})
  const g=account.data.swapGrant
  const budget=[g.maxPerCallRaw,g.remainingRaw,account.data.idle.inputRaw].map(BigInt)
  const swap=budget.every(n=>n>=BigInt(amountInRaw))&&BigInt(g.expiry)>BigInt(account.block.timestamp)
    ? await read('simulate_and_propose_swap',{amountInRaw,minOutRaw:market.data.policyMinimumOutRaw})
    : {status:'skipped-insufficient-grant-or-idle-balance'}
  const rejection=await read('simulate_denied_borrow')
  console.log(JSON.stringify({label:'Unsigned scripted MCP read and simulation, public chain 1952',server:client.getServerVersion(),tools,account,market,swap,rejection},null,2))
} finally {
  await client.close()
}

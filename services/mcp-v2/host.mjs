import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {closeSync,mkdirSync,mkdtempSync,openSync,rmSync} from 'node:fs'
import {createServer} from 'node:net'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {once} from 'node:events'

const common=['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','TMPDIR','SHELL','TERM','SystemRoot']
const hostAuth=['CLAUDE_CONFIG_DIR','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL']
const quoteKeys=['OKX_API_KEY','OKX_API_SECRET','OKX_API_PASSPHRASE']
function select(input,names){return Object.fromEntries(names.filter(k=>input[k]).map(k=>[k,input[k]]))}
export function environments(input,socket){
  const d9=input.SENTINEL_OPERATOR_KEY??input.KEEPER_TESTNET_OPERATOR_KEY
  if(!d9)throw Error('Set the dedicated D9 operator environment before starting the campaign')
  return {
    host:{...select(input,[...common,...hostAuth]),SENTINEL_MCP_SOCKET:socket},
    mcp:{...select(input,[...common,...quoteKeys]),SENTINEL_OPERATOR_KEY:d9,SENTINEL_V2_ENABLE_EXECUTE:'1',SENTINEL_V2_ENABLE_MINED_REJECTION:'1'},
  }
}
export async function openBridge(socket,env) {
  let backend,peer
  const listener=createServer(conn=>{
    if(peer){conn.destroy();return}
    peer=conn
    listener.close()
    backend=spawn(process.execPath,['services/mcp-v2/server.mjs'],{env,stdio:['pipe','pipe','inherit']})
    conn.pipe(backend.stdin)
    backend.stdout.pipe(conn)
    backend.stdin.on('error',()=>conn.destroy())
    backend.on('error',()=>conn.destroy())
    conn.on('error',()=>backend.kill())
    conn.on('close',()=>backend.kill())
  })
  listener.listen(socket)
  await once(listener,'listening')
  return ()=>{peer?.destroy();backend?.kill();if(listener.listening)listener.close()}
}
async function run(){
  process.umask(0o077)
  mkdirSync('services/mcp-v2/.state',{recursive:true})
  mkdirSync('evidence/session6-mcp-v2',{recursive:true})
  const dir=mkdtempSync('services/mcp-v2/.state/host-')
  const path=resolve(dir,'m.sock')
  const transcript='evidence/session6-mcp-v2/claude-transcript-'+randomBytes(8).toString('hex')+'.ndjson'
  let stop,host
  const cleanup=()=>{stop?.();rmSync(dir,{force:true,recursive:true})}
  try{
    const e=environments(process.env,path)
    stop=await openBridge(path,e.mcp)
    const tools=['read_account','read_market','simulate_and_propose_swap','execute_swap','simulate_denied_borrow','mine_denied_borrow','get_receipt'].map(s=>'mcp__sentinel__'+s)
    const input=openSync('services/mcp-v2/objective.txt','r'),out=openSync(transcript,'wx',0o600)
    console.error('Recording Claude tool calls in '+transcript)
    try{
      host=spawn('claude',['-p','--mcp-config','services/mcp-v2/claude.mcp.json','--strict-mcp-config',
        '--permission-mode','dontAsk','--tools','','--allowedTools',...tools,'--output-format','stream-json','--verbose'],
      {env:e.host,stdio:[input,out,'inherit']})
    }finally{closeSync(input);closeSync(out)}
    const quit=()=>host.kill('SIGTERM')
    process.once('SIGINT',quit);process.once('SIGTERM',quit)
    try{const [code]=await once(host,'exit');process.exitCode=code??1}
    finally{process.off('SIGINT',quit);process.off('SIGTERM',quit)}
  }finally{cleanup()}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await run()

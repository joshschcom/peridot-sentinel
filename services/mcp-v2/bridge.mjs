// Claude's stdio subprocess has a one-use local MCP socket and no wallet or market credentials.
import {createConnection} from 'node:net'
import {resolve} from 'node:path'
const root=resolve('services/mcp-v2/.state')
const socket=process.env.SENTINEL_MCP_SOCKET??''
if(!socket.startsWith(root+'/host-') || !/^\/host-[a-zA-Z0-9]+\/m\.sock$/.test(socket.slice(root.length)))
  throw Error('Expected private campaign socket')
const remote=createConnection(socket)
process.stdin.pipe(remote)
remote.pipe(process.stdout)
remote.on('error',()=>{process.stderr.write('Campaign socket unavailable\n');process.exitCode=1;process.stdin.destroy()})
remote.on('close',()=>process.stdin.destroy())

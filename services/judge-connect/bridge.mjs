import assert from 'node:assert/strict'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'
const socket = process.env.JUDGE_MCP_SOCKET ?? ''
const prefix = resolve('.research') + '/'
assert(socket.startsWith(prefix) && /^judge-mcp-[A-Za-z0-9]+\/m\.sock$/.test(socket.slice(prefix.length)), 'Expected private judge MCP socket')
const rpc = createConnection(socket)
process.stdin.pipe(rpc)
rpc.pipe(process.stdout)
rpc.on('error', () => { process.exitCode = 1; process.stdin.destroy() })
rpc.on('close', () => process.stdin.destroy())

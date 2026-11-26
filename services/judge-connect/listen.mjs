// Launch in the operator shell. The model host uses only the printed socket path.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { options } from './profile.mjs'
import { operatorEnvironment } from './server.mjs'

const [mode, campaign] = process.argv.slice(2)
options(mode, campaign)
const env = operatorEnvironment(process.env)
env.JUDGE_CONNECT_EXECUTE = process.env.JUDGE_CONNECT_EXECUTE === '1' ? '1' : '0'
if (env.JUDGE_CONNECT_EXECUTE === '0') delete env.SENTINEL_OPERATOR_KEY
if (mode === 'testnet' && env.JUDGE_CONNECT_EXECUTE === '1') assert(env.SENTINEL_OPERATOR_KEY, 'Dedicated D9 environment required')
process.umask(0o077)
mkdirSync('.research', {recursive: true})
const directory = mkdtempSync(resolve('.research/judge-mcp-'))
const socket = resolve(directory, 'm.sock')
let child, peer
const listener = createServer(conn => {
  if (peer) { conn.destroy(); return }
  peer = conn
  listener.close()
  child = spawn(process.execPath, ['services/judge-connect/server.mjs', mode, campaign], {env, stdio: ['pipe', 'pipe', 'inherit']})
  conn.pipe(child.stdin)
  child.stdout.pipe(conn)
  child.stdin.on('error', () => conn.destroy())
  child.on('error', () => conn.destroy())
  child.on('exit', () => conn.end())
  conn.on('error', () => child.kill())
  conn.on('close', () => child.kill())
})
function cleanup() {
  peer?.destroy()
  child?.kill()
  if (listener.listening) listener.close()
  rmSync(directory, {recursive: true, force: true})
}
process.once('exit', cleanup)
process.once('SIGINT', cleanup)
process.once('SIGTERM', cleanup)
listener.listen(socket, () => console.log(socket))

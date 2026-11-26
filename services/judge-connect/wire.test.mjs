import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeFunctionData } from 'viem'
import { SentinelAccountAbi } from '@peridot/chain-config'
import { abi } from '../mcp-v2/policy.mjs'
import { Client, StdioClientTransport } from '../mcp/runtime/protocol.mjs'
import { catalog, operatorEnvironment, transaction, validate } from './server.mjs'
import { options } from './profile.mjs'

test('only four campaign tools, typed operations and local proposal IDs', () => {
  assert.equal(catalog.length, 4)
  assert.throws(() => validate('judge_execute', {to: '0x00', calldata: '0x'}))
  assert.throws(() => validate('judge_propose', {operation: 'withdraw'}))
  assert.throws(() => validate('judge_read', {url: 'http://example.test'}))
  validate('judge_receipt', {operation: 'repay'})
  assert.throws(() => options('mainnet', 'judge-01'))
  assert.throws(() => options('testnet', '../elsewhere'))
})
test('single zero-value typed envelope per action, restricted signer environment', () => {
  const account = '0x0000000000000000000000000000000000000001'
  const token = '0x0000000000000000000000000000000000000002'
  const m = {markets: {A: {account:token}}, contracts: {account, mockWokb: token}, grants: {swap: {expiry:'12345'}}}
  const swap = transaction(m, 'swap')
  const e = decodeFunctionData({abi:abi.SentinelAccountV2, data:swap.data})
  assert.deepEqual(e.args, [token,250000000000000000n,19800000n,12345n]); assert.equal(swap.target, account)
  assert.equal(decodeFunctionData({abi:SentinelAccountAbi,data:transaction(m,'repay').data}).functionName, 'autoRepay')
  assert.deepEqual(decodeFunctionData({abi:abi.SentinelAccountV2,data:transaction(m,'deny-operator').data}).args,[1n])
  assert.deepEqual(operatorEnvironment({SENTINEL_OPERATOR_KEY:'fixture',PERIDOT_TESTNET_KEY:'excluded',JUDGE_OWNER_KEY:'excluded',ANTHROPIC_API_KEY:'excluded'}),{SENTINEL_OPERATOR_KEY:'fixture'})
})
test('generic client can discover the stdio catalog without any wallet', async () => {
  const client = new Client({name:'judge-test',version:'1'})
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:['services/judge-connect/server.mjs','fork','judge-01'],env:{}}))
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),catalog.map(t=>t.name))
    const denied = await client.callTool({name:'unknown',arguments:{}})
    assert(denied.isError)
  } finally { await client.close() }
})
test('a separate host discovers tools through a private one-client socket', async () => {
  const {spawn} = await import('node:child_process')
  const {once} = await import('node:events')
  const {createInterface} = await import('node:readline')
  const {statSync} = await import('node:fs')
  const {dirname} = await import('node:path')
  const signer = spawn(process.execPath, ['services/judge-connect/listen.mjs', 'fork', 'fixture'], {
    env: {PATH:process.env.PATH, JUDGE_CONNECT_EXECUTE:'0'}, stdio:['ignore','pipe','inherit'],
  })
  const ended = once(signer, 'exit')
  const lines = createInterface({input:signer.stdout})
  const client = new Client({name:'isolated-host-test',version:'1'})
  try {
    const [socket] = await once(lines, 'line')
    assert.equal(statSync(dirname(socket)).mode & 0o077, 0)
    await client.connect(new StdioClientTransport({command:process.execPath,args:['services/judge-connect/bridge.mjs'],env:{JUDGE_MCP_SOCKET:socket}}))
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),catalog.map(t=>t.name))
  } finally {
    await client.close()
    lines.close()
    if (signer.exitCode === null) signer.kill('SIGTERM')
    await ended
  }
})

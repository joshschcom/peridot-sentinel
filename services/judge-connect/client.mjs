// Generic MCP client. Tool APIs carry public typed operations and proposal IDs only.
import assert from 'node:assert/strict'
import { Client, StdioClientTransport } from '../mcp/runtime/protocol.mjs'
import { operations, options } from './profile.mjs'
import { operatorEnvironment } from './server.mjs'

const [mode, campaign, action = 'read'] = process.argv.slice(2)
options(mode, campaign)
assert(['read', 'simulate', 'exercise', ...operations].includes(action))
const env = operatorEnvironment(process.env)
if (['simulate', 'read'].includes(action)) delete env.SENTINEL_OPERATOR_KEY
env.JUDGE_CONNECT_EXECUTE = (action === 'exercise' || operations.includes(action)) && (mode === 'fork' || process.env.JUDGE_CONNECT_EXECUTE === '1') ? '1' : '0'
const client = new Client({name: 'peridot-judge-generic-client', version: '1.0.0'})
async function call(name, args = {}) {
  const response = await client.callTool({name, arguments: args}, undefined, {timeout: 240000})
  assert(!response.isError, name + ': ' + response.content?.[0]?.text)
  return response.structuredContent.result
}
try {
  await client.connect(new StdioClientTransport({command: process.execPath, args: ['services/judge-connect/server.mjs', mode, campaign], env}))
  const report = {profile: mode, campaign, tools: (await client.listTools()).tools.map(t => t.name), before: await call('judge_read'), operations: []}
  const actions = operations.includes(action) ? [action] : action === 'read' ? [] : operations
  for (const operation of actions) {
    const proposal = await call('judge_propose', {operation})
    if (action === 'simulate') { report.operations.push({operation, proposal}); continue }
    if (proposal.status === 'proposed') await call('judge_execute', {proposalId: proposal.proposalId})
    const confirmed = await call('judge_receipt', {operation})
    assert(confirmed.hash, 'Expected a confirmed receipt')
    report.operations.push({operation, confirmed})
  }
  if (actions.length) report.after = await call('judge_read')
  console.log(JSON.stringify(report, null, 2))
} finally { await client.close() }

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { encodeFunctionData, getAddress, keccak256, toHex } from 'viem'
import { SentinelAccountAbi, TestnetTokenAbi } from '@peridot/chain-config'
import { Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema } from '../mcp/runtime/protocol.mjs'
import { abi, operator } from '../mcp-v2/policy.mjs'
import { deniedSimulation } from '../mcp-v2/state.mjs'
import { retryRead } from '../../contracts/expansion/script/session6-transactions.mjs'
import { openProfile, operations, observation, checkBindings, json, jsonSafe } from './profile.mjs'

const exec = promisify(execFile)
const opInput = {type: 'string', enum: operations}
const idInput = {type: 'string', pattern: '^0x[0-9a-f]{64}$'}
export const catalog = [
  ['judge_read', {}, 'Read judge account balances, v1/v2 grants and book exposure at one block.'],
  ['judge_propose', {operation: opInput}, 'Simulate a fixed judge operation. An authorization rejection is required for the deliberate negative.'],
  ['judge_execute', {proposalId: idInput}, 'Execute or reconcile one locally proposed fixed operation with the restricted operator.'],
  ['judge_receipt', {operation: opInput}, 'Read canonical settlement or the separate mined rejection for this campaign.'],
].map(([name, properties, description]) => ({name, description, inputSchema: {type: 'object', properties, required: Object.keys(properties), additionalProperties: false}}))

export function validate(name, args) {
  const tool = catalog.find(t => t.name === name)
  assert(tool && args && typeof args === 'object' && !Array.isArray(args), 'Unknown tool or invalid arguments')
  assert.deepEqual(Object.keys(args).sort(), tool.inputSchema.required.toSorted())
  if ('operation' in args) assert(operations.includes(args.operation), 'Unsupported operation')
  if ('proposalId' in args) assert(/^0x[0-9a-f]{64}$/.test(args.proposalId), 'Invalid proposal ID')
}

export function operatorEnvironment(env) {
  const out = {}
  for (const key of ['PATH', 'LANG', 'TMPDIR', 'SENTINEL_OPERATOR_KEY']) if (env[key]) out[key] = env[key]
  return out
}

export function transaction(m, op) {
  assert(operations.includes(op))
  if (op === 'repay') return {target: m.markets.A.account, data: encodeFunctionData({abi: SentinelAccountAbi, functionName: 'autoRepay'})}
  const args = op === 'swap' ? [m.contracts.mockWokb, 250000000000000000n, 19800000n, BigInt(m.grants.swap.expiry)] : [1n]
  return {target: m.contracts.account, data: encodeFunctionData({abi: abi.SentinelAccountV2, functionName: op === 'swap' ? 'swapExactIn' : 'borrow', args})}
}

async function state(p) {
  const {contracts: c, markets} = p.m
  return observation(p, async ctx => {
    await checkBindings(p, ctx)
    const [repayGrant, swapGrant, operatorCount, book, idleInputRaw, idleOutputRaw] = await Promise.all([
      ctx.read(markets.A.account, SentinelAccountAbi, 'operators', [operator]),
      ctx.read(c.account, abi.SentinelAccountV2, 'grants', [operator, c.swap, 5, c.mockWokb]),
      ctx.read(c.account, abi.SentinelAccountV2, 'operatorCount'), ctx.read(c.account, abi.SentinelAccountV2, 'exposure'),
      ctx.read(c.mockWokb, TestnetTokenAbi, 'balanceOf', [c.account]), ctx.read(c.mockUsdc, TestnetTokenAbi, 'balanceOf', [c.account]),
    ])
    return {chainId: 1952, profile: p.m.profile, campaign: p.campaign, owner: p.m.owner, operator,
      repayAccount: markets.A.account, swapAccount: c.account, repayGrant, swapGrant, operatorCount, book, idleInputRaw, idleOutputRaw}
  })
}

async function proof(p, op) {
  const path = resolve(p.dir, op + '.json')
  if (!existsSync(path)) return {status: 'no-recorded-receipt', operation: op}
  const e = json(path)
  const t = transaction(p.m, op)
  const actual = await retryRead(async () => {
    const rows = await Promise.all(p.clients.map(async c => ({
      r: await c.getTransactionReceipt({hash: e.hash}), tx: await c.getTransaction({hash: e.hash}),
      b: await c.getBlock({blockNumber: BigInt(e.blockNumber)}),
    })))
    for (const {r, tx, b} of rows) {
      assert.equal(r.blockHash, e.blockHash)
      assert.equal(r.blockHash, b.hash)
      assert.equal(r.transactionHash, e.hash)
      assert.equal(tx.blockHash, r.blockHash)
      assert.equal(getAddress(tx.to), getAddress(t.target))
      assert.equal(getAddress(tx.from), operator)
      assert.equal(tx.input, t.data)
      assert.equal(tx.value, 0n)
      assert.equal(tx.chainId, 1952)
      assert.equal(r.status, op === 'deny-operator' ? 'reverted' : 'success')
      if (op === 'deny-operator') assert(r.logs.length === 0 && r.gasUsed < tx.gas)
    }
    return rows[0].r
  })
  const replay = op === 'deny-operator' ? await deniedSimulation(p.rpc, t.target, {blockNumber: actual.blockNumber}) : undefined
  return {operation: op, profile: p.m.profile, status: actual.status, hash: e.hash, block: String(actual.blockNumber), blockHash: actual.blockHash,
    gasUsed: String(actual.gasUsed), evidence: e, ...(replay && {replay})}
}

async function simulate(p, op) {
  return observation(p, async ctx => {
    await checkBindings(p, ctx)
    const {target, data} = transaction(p.m, op)
    if (op === 'deny-operator') return deniedSimulation(p.rpc, target, {blockNumber: ctx.block.number})
    const {data: result} = await p.rpc.call({account: operator, to: target, data, blockNumber: ctx.block.number})
    assert(/^0x[0-9a-f]{64}$/i.test(result))
    const amount = BigInt(result)
    if (op === 'repay') assert.equal(amount, 2000000n, 'Repayment differs from the judge allowance')
    else assert(amount >= 19800000n, 'Swap below minimum output')
    return {status: 'simulated-success', target, resultRaw: amount, dataHash: keccak256(data)}
  })
}

export function campaignTools(mode, campaign) {
  const proposals = new Map()
  let busy = false
  return async (name, args) => {
    validate(name, args)
    const p = await openProfile(mode, campaign)
    if (name === 'judge_read') return state(p)
    if (name === 'judge_receipt') return proof(p, args.operation)
    if (name === 'judge_propose') {
      const already = await proof(p, args.operation)
      if (already.hash) return already
      const simulation = await simulate(p, args.operation)
      const {target, data} = transaction(p.m, args.operation)
      const intent = {operation: args.operation, mode, campaign, owner: p.m.owner, operator, target, data, valueWei: '0', blockHash: simulation.block.hash}
      const id = keccak256(toHex(JSON.stringify(intent)))
      proposals.set(id, {...intent, createdAt: Date.now()})
      return {status: 'proposed', proposalId: id, intent, simulation}
    }
    assert(process.env.JUDGE_CONNECT_EXECUTE === '1', 'Signing disabled')
    const proposal = proposals.get(args.proposalId)
    assert(proposal && Date.now() - proposal.createdAt < 300000, 'Unknown or expired proposal, simulate again')
    const {target, data} = transaction(p.m, proposal.operation)
    assert.equal(getAddress(target), getAddress(proposal.target))
    assert.equal(data, proposal.data)
    assert.equal(getAddress(proposal.owner), getAddress(p.m.owner))
    if (busy) throw Error('An operation is pending')
    busy = true
    try {
      const existing = await proof(p, proposal.operation)
      if (existing.hash) return existing
      await simulate(p, proposal.operation)
      const env = operatorEnvironment(process.env)
      env.JUDGE_OWNER = getAddress(p.m.owner)
      await exec(process.execPath, ['services/judge-demo/run.mjs', mode, proposal.operation, campaign], {env, maxBuffer: 256 * 1024})
      const result = await proof(p, proposal.operation)
      assert(result.hash, 'Submitted operation awaiting reconciliation')
      return result
    } finally { busy = false }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const call = campaignTools(process.argv[2], process.argv[3])
  const server = new Server({name: 'peridot-judge', version: '1.0.0'}, {capabilities: {tools: {}}})
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: catalog}))
  server.setRequestHandler(CallToolRequestSchema, async req => {
    try {
      const result = jsonSafe(await call(req.params.name, req.params.arguments ?? {}))
      return {content: [{type: 'text', text: JSON.stringify(result)}], structuredContent: {result}}
    } catch {
      return {isError: true, content: [{type: 'text', text: 'Judge profile, permissions, simulation, or receipt check failed. Inspect the public campaign journal before retrying.'}]}
    }
  })
  await server.connect(new StdioServerTransport())
}

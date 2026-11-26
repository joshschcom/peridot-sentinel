import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPublicClient, getAddress, http, keccak256 } from 'viem'
import { MarketFactoryAbi, SentinelAccountFactoryAbi } from '@peridot/chain-config'
import { abi, operator } from '../mcp-v2/policy.mjs'
import { retryRead } from '../../contracts/expansion/script/session6-transactions.mjs'

export const operations = ['swap', 'repay', 'deny-operator']
export const json = path => JSON.parse(readFileSync(path, 'utf8'))
export const jsonSafe = data => JSON.parse(JSON.stringify(data, (_, x) => typeof x === 'bigint' ? String(x) : x))
const endpoints = ['https://testrpc.xlayer.tech', 'https://xlayertestrpc.okx.com']
const forkUrl = 'http://127.0.0.1:19750'
const same = (a, b) => getAddress(a) === getAddress(b)

export function options(mode, campaign) {
  assert(['fork', 'testnet'].includes(mode), 'Expected fork or testnet')
  assert(typeof campaign === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(campaign), 'Invalid campaign name')
  return {mode, campaign}
}

export async function openProfile(mode, campaign) {
  options(mode, campaign)
  const urls = mode === 'fork' ? [forkUrl] : endpoints
  const clients = urls.map(url => createPublicClient({transport: http(url, {retryCount: 0, timeout: 10000}), cacheTime: 0}))
  const rpc = clients[0]
  for (const client of clients) assert.equal(await retryRead(() => client.getChainId()), 1952)
  let instance = '1952'
  if (mode === 'fork') {
    const [info, meta] = await Promise.all(['anvil_nodeInfo', 'anvil_metadata'].map(method => rpc.request({method})))
    assert(endpoints.includes(info.forkConfig?.forkUrl), 'Expected a private fork of X Layer testnet')
    assert(/^0x[0-9a-f]{64}$/i.test(meta.instanceId))
    instance = 'fork-' + meta.instanceId.slice(2, 18)
  }
  const dir = resolve('deployments/session7', instance, campaign)
  const m = json(resolve(dir, 'manifest.json'))
  assert.equal(m.chainId, 1952)
  assert.equal(m.campaign, campaign)
  assert.equal(m.profile, mode === 'fork' ? 'private-testnet-fork' : 'public-testnet')
  assert(same(m.operator, operator) && !same(m.owner, m.deployer) && !same(m.owner, operator))
  const base = json('packages/chain-config/deployments/1952.json')
  for (const key of ['MarketFactory', 'SentinelAccountFactory', 'MockDebt']) assert(same(m.base[key], base.contracts[key]))
  assert(!same(m.contracts.account, json('packages/chain-config/expansion/deployments/1952.json').contracts.account))
  return {mode, campaign, dir, m, rpc, clients, urls}
}

// All profile and grant reads in one observation share a block. On public 1952 both hosts
// must agree on its hash, including after the reads, before the observation is returned.
export async function observation(p, fn) {
  return retryRead(async () => {
    const blocks = await Promise.all(p.clients.map(c => c.getBlock()))
    const height = blocks.reduce((n, b) => b.number < n ? b.number : n, blocks[0].number)
    assert(height >= BigInt(p.m.deploymentBlock), 'RPC behind judge deployment')
    const at = await p.rpc.getBlock({blockNumber: height})
    const read = (address, abi, functionName, args = []) => p.rpc.readContract({address, abi, functionName, args, blockNumber: height})
    const result = await fn({block: at, read})
    const witnesses = await Promise.all(p.clients.map(c => c.getBlock({blockNumber: height})))
    assert(witnesses.every(b => b.hash === at.hash), 'Campaign block changed or RPC witnesses disagree')
    return jsonSafe({block: {number: height, hash: at.hash, timestamp: at.timestamp}, result})
  })
}

export async function checkBindings(p, {block, read}) {
  const {owner, contracts: c, markets, base, runtimeCodeHashes} = p.m
  await Promise.all(Object.entries(c).map(async ([name, address]) => {
    const code = await p.rpc.getCode({address, blockNumber: block.number})
    assert(code && code !== '0x' && keccak256(code) === runtimeCodeHashes[name], 'Runtime identity mismatch: ' + name)
  }))
  const known = await Promise.all([
    read(c.factory, abi.SentinelAccountFactoryV2, 'accountOf', [owner]),
    ...['owner', 'controller', 'swapAdapter', 'lendingAdapter', 'executionPolicy'].map(fn => read(c.account, abi.SentinelAccountV2, fn)),
    read(c.execution, abi.ExecutionPolicy, 'processor'),
    read(c.swap, abi.SinglePoolSwapAdapter, 'pool'), read(c.swap, abi.SinglePoolSwapAdapter, 'router'),
  ])
  const expected = [c.account, owner, markets.A.controller, c.swap, c.lending, c.execution, c.cpu, c.venue, c.venue]
  assert(known.every((x, i) => same(x, expected[i])), 'Unexpected account, execution policy or route')
  for (const market of [markets.A, markets.B]) {
    assert(await read(base.MarketFactory, MarketFactoryAbi, 'isMarket', [market.controller]))
    assert(same(await read(base.SentinelAccountFactory, SentinelAccountFactoryAbi, 'accountOf', [owner, market.controller]), market.account))
  }
}

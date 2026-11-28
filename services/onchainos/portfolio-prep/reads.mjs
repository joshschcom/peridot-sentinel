// Pure request planning and response parsing. No transport, signer, environment or wallet.
import assert from 'node:assert/strict'
import {base58} from '@scure/base'
import {getAddress, isAddress} from 'viem'
export const pair = Object.freeze({
  WOKB: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  USDC: '0xb6ceceab302e2e4948951ee7843fc24e92933061',
})

const origin = 'https://web3.okx.com'
const endpoints = Object.freeze({
  chains: '/api/v6/dex/balance/supported/chain',
  inventory: '/api/v6/dex/balance/all-token-balances-by-address',
  walletUsd: '/api/v6/dex/balance/total-value-by-address',
  quote: '/api/v6/dex/aggregator/quote',
})
const chains = ['196', '1', '8453', '501']

function address(chainIndex, value) {
  assert(chains.includes(chainIndex), 'Unsupported chain')
  if (chainIndex === '501') {
    assert(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value), 'Invalid Solana address')
    assert.equal(base58.decode(value).length, 32, 'Expected 32-byte Solana address')
    return value
  }
  assert(typeof value === 'string' && isAddress(value), 'Invalid EVM address')
  return getAddress(value)
}

function raw(value, optional = false) {
  if (optional && (value == null || value === '')) return null
  assert(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value), 'Expected unsigned integer string')
  assert(BigInt(value) < 2n ** 256n, 'Amount exceeds uint256')
  return value
}

function decimal(value, optional = false) {
  if (optional && (value == null || value === '')) return null
  assert(typeof value === 'string' && value.length <= 180 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value), 'Expected unsigned decimal string')
  return value
}

function request(kind, scope, params) {
  const qs = new URLSearchParams(params).toString()
  return {kind, scope, method: 'GET', origin, path: endpoints[kind] + (qs ? '?' + qs : '')}
}

function walletRequest(kind, {chainIndex, address: owner, role}) {
  assert(['wallet', 'sentinel', 'watch'].includes(role), 'Invalid watchlist role')
  const scope = {chainIndex, address: address(chainIndex, owner), role}
  const params = {address: scope.address, chains: chainIndex}
  if (kind === 'walletUsd') params.assetType = '1'
  return request(kind, scope, params)
}

export function portfolioPlan(subjects) {
  assert(Array.isArray(subjects) && subjects.length > 0 && subjects.length <= 50, 'Supply 1–50 subjects')
  const rows = subjects.map(s => walletRequest('inventory', s))
  const key = s => s.scope.chainIndex + '/' + s.scope.address
  rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) === key(b) ? 0 : 1)
  assert.equal(new Set(rows.map(key)).size, rows.length, 'Repeated address on one chain')
  return [request('chains', null, {}), ...rows.flatMap(r => [r, walletRequest('walletUsd', r.scope)])]
}

export function quotePlan(from, amount) {
  assert(Object.hasOwn(pair, from), 'Expected WOKB or USDC')
  const amountIn = raw(amount)
  assert(BigInt(amountIn) > 0n, 'Quote amount must be positive')
  const to = from === 'WOKB' ? 'USDC' : 'WOKB'
  return request('quote', {chainIndex: '196', from, amountIn}, {
    chainIndex: '196', fromTokenAddress: pair[from], toTokenAddress: pair[to], amount: amountIn,
  })
}

export function canonical(req) {
  if (req.kind === 'chains') return request('chains', null, {})
  if (req.kind === 'quote') return quotePlan(req.scope.from, req.scope.amountIn)
  assert(req.kind === 'inventory' || req.kind === 'walletUsd', 'Unsupported request kind')
  return walletRequest(req.kind, req.scope)
}

function inventory(scope, rows) {
  assert(Array.isArray(rows) && rows.length <= 10000, 'Invalid token inventory')
  const seen = new Set()
  return rows.map(row => {
    assert.equal(row.chainIndex, scope.chainIndex, 'Unexpected response chain')
    assert.equal(address(scope.chainIndex, row.address), scope.address, 'Unexpected response owner')
    assert(typeof row.symbol === 'string' && row.symbol.length > 0 && row.symbol.length <= 128 &&
      !/[\u0000-\u001f\u007f]/u.test(row.symbol), 'Invalid token symbol')
    assert.equal(typeof row.isRiskToken, 'boolean', 'Missing provider risk flag')
    // The official Ethereum example documents an empty contract for ETH. Preserve ambiguous native markers elsewhere.
    const marker = row.tokenContractAddress
    let assetKind = 'token'
    let assetAddress = null
    if (marker === '') assetKind = scope.chainIndex === '1' && row.symbol === 'ETH' ? 'native' : 'unverified-native-marker'
    else {
      assetAddress = address(scope.chainIndex, marker)
      if (/^0x(0{40}|e{40})$/i.test(assetAddress) || assetAddress === '11111111111111111111111111111111') {
        assetKind = 'unverified-native-marker'
      }
    }
    const assetId = scope.chainIndex + '/' + (assetAddress ?? assetKind)
    assert(!seen.has(assetId), 'Duplicate asset identity in response')
    seen.add(assetId)
    return {assetId, assetKind, assetAddress, symbol: row.symbol, balance: decimal(row.balance),
      rawBalance: raw(row.rawBalance, true), tokenPriceUsd: decimal(row.tokenPrice, true), providerRiskFlag: row.isRiskToken}
  })
}

function dataFor(req, data) {
  assert(Array.isArray(data), 'Missing response data')
  if (req.kind === 'chains') {
    assert(data.every(row => typeof row?.chainIndex === 'string' && /^[0-9]+$/.test(row.chainIndex)), 'Invalid chain entry')
    const supported = new Set(data.map(r => r.chainIndex))
    return {supported: chains.filter(id => supported.has(id)), unsupported: chains.filter(id => !supported.has(id))}
  }
  assert.equal(data.length, 1, 'Expected one scoped response object')
  const row = data[0]
  if (req.kind === 'inventory') return {assets: inventory(req.scope, row.tokenAssets)}
  if (req.kind === 'walletUsd') return {assetType: '1', walletTokensUsd: decimal(row.totalValue)}
  const {from, amountIn} = req.scope
  const to = from === 'WOKB' ? 'USDC' : 'WOKB'
  assert.equal(row.chainIndex, '196', 'Quote chain mismatch')
  assert.equal(address('196', row.fromToken.tokenContractAddress), getAddress(pair[from]), 'Quote input mismatch')
  assert.equal(address('196', row.toToken.tokenContractAddress), getAddress(pair[to]), 'Quote output mismatch')
  assert.equal(row.fromTokenAmount, amountIn, 'Quote amount mismatch')
  const amountOut = raw(row.toTokenAmount)
  assert(BigInt(amountOut) > 0n, 'Invalid output amount')
  return {from, to, amountIn, amountOut}
}

export function normalize(req, {httpStatus, body, requestedAt, receivedAt, provenance}) {
  assert.deepEqual(req, canonical(req), 'Unrecognized request envelope')
  assert(['synthetic', 'provider-response'].includes(provenance), 'Supply response provenance')
  for (const stamp of [requestedAt, receivedAt]) {
    assert(typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) &&
      new Date(stamp).toISOString() === stamp, 'Expected UTC ISO timestamp')
  }
  assert(receivedAt >= requestedAt, 'Receipt time precedes request')
  assert(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599, 'Invalid HTTP status')
  const base = {schemaVersion: 1, provenance, source: 'OKX OnchainOS', kind: req.kind, scope: req.scope,
    path: req.path, requestedAt, receivedAt, providerUpdatedAt: null, blockOrSlot: null}
  const providerCode = typeof body?.code === 'string' && /^[0-9]{1,16}$/.test(body.code) ? body.code : null
  if (httpStatus !== 200 || providerCode !== '0') {
    return {...base, status: 'unavailable', httpStatus, providerCode, data: null}
  }
  return {...base, status: 'received', httpStatus, providerCode, data: dataFor(req, body.data)}
}

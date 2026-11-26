import assert from 'node:assert/strict'
import test from 'node:test'
import {base58} from '@scure/base'
import {pair} from '../quote.mjs'
import {normalize, portfolioPlan, quotePlan} from './reads.mjs'

// All input addresses, amounts, timestamps and provider payloads below are synthetic.
const evm = '0x0000000000000000000000000000000000000001'
const contract = '0x0000000000000000000000000000000000000002'
const sol = base58.encode(new Uint8Array(32).fill(9))
const mint = base58.encode(new Uint8Array(32).fill(11))
const subjects = ['196', '1', '8453', '501'].map(chainIndex => ({chainIndex, address: chainIndex === '501' ? sol : evm, role: 'watch'}))
const items = portfolioPlan(subjects)
const stamp = {httpStatus: 200, provenance: 'synthetic', requestedAt: '2026-11-26T12:00:00.000Z', receivedAt: '2026-11-26T12:00:01.000Z'}
const apply = (r, data) => normalize(r, {...stamp, body: {code: '0', data}})
const inventoryRequest = chain => items.find(r => r.kind === 'inventory' && r.scope.chainIndex === chain)
const row = (chainIndex = '1') => ({chainIndex, address: chainIndex === '501' ? sol : evm, tokenContractAddress: chainIndex === '501' ? mint : contract,
  symbol: 'SYNTH', balance: '9007199254740993.123456789', rawBalance: '9007199254740993123456789', tokenPrice: '', isRiskToken: false})

test('reversed watchlists yield the same nine unsigned GET envelopes', () => {
  assert.deepEqual(portfolioPlan([...subjects].reverse()), items)
  assert.equal(items.length, 9)
  assert(items.every(r => r.origin === 'https://web3.okx.com' && r.method === 'GET'))
  assert.equal(items.filter(r => r.path.endsWith('assetType=1')).length, 4)
  assert.deepEqual(apply(items[0], [{chainIndex: '1'}, {chainIndex: '501'}, {chainIndex: '999'}]).data,
    {supported: ['1', '501'], unsupported: ['196', '8453']})
})

test('wrong network, malformed address, duplicate subject and modified request are rejected', () => {
  for (const s of [{...subjects[0], chainIndex: '1952'}, {...subjects[0], address: sol},
    {...subjects[3], address: '11111111111111111111111111111111111111111111'}, {...subjects[3], address: 'invalid'}]) {
    assert.throws(() => portfolioPlan([s]))
  }
  assert.throws(() => portfolioPlan([subjects[0], subjects[0]]))
  assert.throws(() => apply({...items[0], method: 'POST'}, []))
  assert.throws(() => apply({...items[0], path: '/unrelated'}, []))
})

test('all four chains preserve precision, address identity, absence and provider filtering', () => {
  for (const s of subjects) {
    const r = row(s.chainIndex)
    const response = apply(inventoryRequest(s.chainIndex), [{tokenAssets: [{...r, arbitraryData: 'discard'}]}])
    const asset = response.data.assets[0]
    assert.equal(response.provenance, 'synthetic')
    assert.equal(response.blockOrSlot, null)
    assert.equal(response.providerUpdatedAt, null)
    assert.equal(asset.rawBalance, r.rawBalance)
    assert.equal(asset.balance, r.balance)
    assert.equal(asset.assetAddress, r.tokenContractAddress)
    assert.equal(asset.tokenPriceUsd, null)
    assert.equal(asset.arbitraryData, undefined)
    assert.equal(apply(inventoryRequest(s.chainIndex), [{tokenAssets: []}]).data.assets.length, 0)
  }
})

test('mismatched identity, duplicate rows and unsafe amount encodings invalidate the observation', () => {
  const r = inventoryRequest('1')
  for (const change of [{chainIndex: '196'}, {address: contract}, {balance: 1.1}, {balance: '1e4'},
    {rawBalance: (2n ** 256n).toString()}, {isRiskToken: 'false'}]) {
    assert.throws(() => apply(r, [{tokenAssets: [{...row(), ...change}]}]))
  }
  assert.throws(() => apply(r, [{tokenAssets: [row(), row()]}]))
  assert.throws(() => apply(r, []))
})

test('native markers are scoped and missing raw balances remain null', () => {
  for (const s of subjects) {
    const [a] = apply(inventoryRequest(s.chainIndex), [{tokenAssets: [
      {...row(s.chainIndex), symbol: 'ETH', tokenContractAddress: '', rawBalance: ''},
    ]}]).data.assets
    assert.equal(a.assetKind, s.chainIndex === '1' ? 'native' : 'unverified-native-marker')
    assert.equal(a.rawBalance, null)
  }
})

test('wallet subtotals stay separate from quote outputs and transport failures stay unknown', () => {
  const r = items.find(r => r.kind === 'walletUsd')
  assert.equal(apply(r, [{totalValue: '478.36881223456789'}]).data.walletTokensUsd, '478.36881223456789')
  assert.throws(() => normalize(r, {...stamp, receivedAt: '2026-11-26T10:00:00.000Z', body: {}}))
  const response = normalize(r, {...stamp, httpStatus: 401, body: {code: '50103', msg: 'discard provider text'}})
  assert.equal(response.status, 'unavailable')
  assert.equal(response.data, null)
  assert.equal(response.providerCode, '50103')
  assert.equal(response.msg, undefined)
})

test('quote plans bind 196, the reviewed pair and exact amount; retain only output amount', () => {
  const r = quotePlan('WOKB', '1000000000000000000')
  const input = {chainIndex: '196', fromToken: {tokenContractAddress: pair.WOKB}, toToken: {tokenContractAddress: pair.USDC},
    fromTokenAmount: '1000000000000000000', toTokenAmount: '12345678', tx: {irrelevant: true}}
  assert.deepEqual(apply(r, [input]).data, {from: 'WOKB', to: 'USDC', amountIn: input.fromTokenAmount, amountOut: input.toTokenAmount})
  for (const c of [{chainIndex: '1952'}, {fromTokenAmount: '2'}, {toTokenAmount: '0'}, {toToken: input.fromToken}]) {
    assert.throws(() => apply(r, [{...input, ...c}]))
  }
  assert.throws(() => quotePlan('USDT', '1'))
  assert.throws(() => quotePlan('USDC', '0'))
})

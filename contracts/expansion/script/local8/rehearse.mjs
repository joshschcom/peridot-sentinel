// Run from the repository root. Wallet #1 owns both rehearsal accounts; wallet #2 can only swap.
import assert from 'node:assert/strict'
import {closeSync, existsSync, mkdirSync, openSync, unlinkSync} from 'node:fs'
import {
  createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, keccak256,
  parseAbi, parseEventLogs, toFunctionSelector, zeroAddress,
} from 'viem'
import {foundry} from 'viem/chains'
import {gasWithHeadroom, readJson, writeJson} from '../session6-transactions.mjs'

const rpc = 'http://127.0.0.1:18545'
const reportPath = 'evidence/session8-local/rehearsal.json'
const manifests = 'packages/chain-config/expansion/deployments'
const base = readJson(manifests + '/31337.json')
const vault = readJson(manifests + '/vault-31337.json')
const m4 = readJson('packages/chain-config/deployments/31337.json')
const transport = http(rpc, {retryCount: 0})
const client = createPublicClient({chain: foundry, transport, cacheTime: 0})
const wallet = createWalletClient({chain: foundry, transport})
const metadata = await client.request({method: 'anvil_metadata'})
const genesis = await client.getBlock({blockNumber: 0n})
assert.equal(await client.getChainId(), 31337)
assert.equal(metadata.forkedNetwork, null)
for (const profile of [base, vault]) {
  assert.equal(profile.chainId, 31337)
  assert.equal(profile.anvil.instanceId, metadata.instanceId)
  assert.equal(profile.anvil.genesisHash, genesis.hash)
  assert.equal(profile.anvil.rpcUrl, rpc)
  for (const [key, address] of Object.entries(profile.contracts)) {
    assert.equal(keccak256(await client.getCode({address})), profile.runtimeCodeHashes[key], key)
  }
}
assert.equal(base.m4.accountPolicy, m4.tapeout.circuits.find(c => c.kind === 'ACCOUNT').policyId)
assert.equal(vault.sourcePolicy, base.m4.accountPolicy)
const a = base.contracts, v = vault.contracts
const abis = name => readJson('packages/chain-config/expansion/abi/' + name + '.json')
const accountAbi = abis('SentinelAccountV2'), vaultAccountAbi = abis('VaultSentinelAccountV2')
const factoryAbi = abis('SentinelAccountFactoryV2'), vaultFactoryAbi = abis('VaultSentinelAccountFactoryV2')
const shareAbi = abis('TestnetSavingsVault')
const token = parseAbi(['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'])
const unlocked = (await wallet.getAddresses()).map(address => getAddress(address))
assert(unlocked.length >= 10)
const [, owner, operator] = unlocked
const context = {chainId: 31337, instanceId: metadata.instanceId, genesisHash: genesis.hash, rpc, owner, operator,
  factory: getAddress(a.factory), vaultFactory: getAddress(v.vaultFactory), accountPolicy: base.m4.accountPolicy}
mkdirSync('evidence/session8-local', {recursive: true})
const lock = openSync(reportPath + '.lock', 'wx')
try {
  const state = existsSync(reportPath) ? readJson(reportPath) : {
    label: 'Unforked, unlocked local Anvil; scripted wallet transactions using valueless mock assets',
    context, startBlock: String(await client.getBlockNumber()), steps: {}, observations: {},
  }
  assert.deepEqual(state.context, context, 'Recorded evidence belongs to a different deployment')
  const save = () => writeJson(reportPath, state)
  const view = (address, abi, functionName, args = [], blockNumber) =>
    client.readContract({address, abi, functionName, args, blockNumber})
  const lendingAbi = abis('PeridotLendingAdapter')
  const lendingView = field => view(a.lending, lendingAbi, field)
  const [controller, book, collateral, marketFactory, registry] = await Promise.all(
    ['controller', 'collateralMarket', 'collateralAsset', 'marketFactory', 'registry'].map(lendingView))
  assert.equal(controller, getAddress(base.lendingMarket.controller))
  assert.equal(book, getAddress(base.lendingMarket.collateralMarket))
  assert.equal(marketFactory, getAddress(base.lendingMarket.factory))
  assert.notEqual(controller, getAddress(m4.markets[0].controller))
  assert.equal(collateral, getAddress(m4.contracts.MockCollateral))
  assert.equal(registry, getAddress(m4.contracts.PolicyRegistry))
  assert(await view(marketFactory, parseAbi(['function isMarket(address) view returns (bool)']), 'isMarket', [controller]))
  state.observations.lending = {marketFactory, controller, book, collateral, registry, originalM4Controller: m4.markets[0].controller}
  const balance = (asset, who, block) => view(asset, token, 'balanceOf', [who], block)
  const allowance = (asset, from, spender, block) => view(asset, token, 'allowance', [from, spender], block)
  let submitted = 0

  async function send(label, from, to, abi, fn, args) {
    const data = encodeFunctionData({abi, functionName: fn, args})
    const intent = {from, to: getAddress(to), method: fn, dataHash: keccak256(data)}
    let row = state.steps[label], signed
    if (row) {
      assert.deepEqual(row.intent, intent, label + ' intent changed')
    } else {
      const nonce = await client.getTransactionCount({address: from, blockTag: 'pending'})
      assert.equal(nonce, await client.getTransactionCount({address: from}), 'Wallet already has a pending transaction')
      const gas = gasWithHeadroom(await client.estimateGas({account: from, to, data}))
      const gasPrice = await client.getGasPrice()
      signed = await wallet.signTransaction({account: from, type: 'legacy', to, data, nonce, gas, gasPrice, value: 0n})
      row = state.steps[label] = {intent, hash: keccak256(signed), nonce, gasLimit: String(gas), gasPrice: String(gasPrice)}
      save()
    }
    const known = await client.getTransaction({hash: row.hash}).catch(error => {
      if (error.name === 'TransactionNotFoundError') return undefined
      throw error
    })
    if (!known) {
      assert.equal(await client.getTransactionCount({address: from, blockTag: 'pending'}), row.nonce,
        'The reserved nonce was consumed by a different transaction')
      signed ??= await wallet.signTransaction({account: from, type: 'legacy', to, data, nonce: row.nonce,
        gas: BigInt(row.gasLimit), gasPrice: BigInt(row.gasPrice), value: 0n})
      assert.equal(keccak256(signed), row.hash, 'Reserved transaction changed')
      assert.equal(await wallet.sendRawTransaction({serializedTransaction: signed}), row.hash)
      submitted++
    }
    const receipt = await client.waitForTransactionReceipt({hash: row.hash, pollingInterval: 100})
    const tx = await client.getTransaction({hash: row.hash})
    assert.equal(receipt.status, 'success', label)
    assert.equal(getAddress(tx.from), from)
    assert.equal(getAddress(tx.to), intent.to)
    assert.equal(tx.value, 0n)
    assert.equal(tx.nonce, row.nonce)
    assert.equal(keccak256(tx.input), intent.dataHash)
    assert.equal(tx.gas, BigInt(row.gasLimit))
    assert.equal((await client.getBlock({blockNumber: receipt.blockNumber})).hash, receipt.blockHash)
    if (row.blockHash) assert.equal(row.blockHash, receipt.blockHash)
    Object.assign(row, {block: String(receipt.blockNumber), blockHash: receipt.blockHash, gasUsed: String(receipt.gasUsed), status: receipt.status})
    save()
    return receipt
  }
  function event(receipt, address, abi, name) {
    const matched = parseEventLogs({abi, eventName: name, logs: receipt.logs.filter(l => getAddress(l.address) === getAddress(address))})
    assert.equal(matched.length, 1, name)
    return matched[0].args
  }
  async function create(label, factory, factoryAbi, abi) {
    assert.equal(await view(factory, factoryAbi, 'accountOf', [owner], BigInt(state.startBlock)), zeroAddress)
    const receipt = await send(label, owner, factory, factoryAbi, 'createAccount', [context.accountPolicy])
    const created = event(receipt, factory, factoryAbi, 'AccountCreated')
    assert.equal(getAddress(created.owner), owner)
    assert.equal(created.policyId, context.accountPolicy)
    const addr = getAddress(created.account)
    const at = receipt.blockNumber
    assert.equal(await view(addr, abi, 'policyId', [], at), context.accountPolicy)
    assert.equal(await view(factory, factoryAbi, 'accountOf', [owner], at), addr)
    for (const [fn, target] of Object.entries({owner, lendingAdapter: a.lending, swapAdapter: a.swap,
      executionPolicy: a.execution, controller})) {
      assert.equal(await view(addr, abi, fn, [], at), getAddress(target))
    }
    return addr
  }

  const browserOwners = unlocked.slice(3, 10)
  for (const browser of browserOwners) {
    assert.equal(await view(a.factory, factoryAbi, 'accountOf', [browser], BigInt(state.startBlock)), zeroAddress)
    assert.equal(await view(v.vaultFactory, vaultFactoryAbi, 'accountOf', [browser], BigInt(state.startBlock)), zeroAddress)
  }
  state.observations.browserOwnersUncreatedAtStart = browserOwners
  const account = await create('create-base-account', a.factory, factoryAbi, accountAbi)
  const sibling = await create('create-vault-account', v.vaultFactory, vaultFactoryAbi, vaultAccountAbi)
  assert.notEqual(account, sibling)
  assert.equal(await view(sibling, vaultAccountAbi, 'vault'), getAddress(v.mockVault))
  assert.equal(await view(sibling, vaultAccountAbi, 'vaultAdapter'), getAddress(v.vaultAdapter))
  assert.equal(await view(sibling, vaultAccountAbi, 'vaultAsset'), getAddress(a.mockUsdc))
  state.accounts = {base: account, vault: sibling}

  const wad = 10n ** 18n, usd = 10n ** 6n
  // Derive deterministic deadlines from the canonical start block for replay.
  const start = await client.getBlock({blockNumber: BigInt(state.startBlock)})
  const expiry = start.timestamp + 86400n
  await send('fund-vault', owner, a.mockUsdc, token, 'mint', [sibling, 12n * usd])
  await send('set-vault-limits', owner, sibling, vaultAccountAbi, 'setVaultDepositLimits', [20n * usd, wad])
  async function settle(label, fn, operation, assets, shares) {
    const args = operation === 7 ? [shares, assets, expiry] : [assets, shares, expiry]
    const receipt = await send(label, owner, sibling, vaultAccountAbi, fn, args)
    const after = receipt.blockNumber, before = after - 1n
    const settled = event(receipt, sibling, vaultAccountAbi, 'VaultSettled')
    assert.equal(settled.operation, operation)
    assert.equal(settled.assets, assets)
    assert.equal(settled.shares, shares)
    assert.equal(getAddress(settled.operator), owner)
    assert.equal(getAddress(settled.vault), getAddress(v.mockVault))
    const vaultEvent = event(receipt, v.mockVault, shareAbi, operation === 6 ? 'Deposit' : 'Withdraw')
    assert.equal(getAddress(vaultEvent.owner), sibling)
    if (operation !== 6) assert.equal(getAddress(vaultEvent.receiver), sibling)
    const position = block => view(sibling, vaultAccountAbi, 'vaultPosition', [], block)
    const [p0, p1] = await Promise.all([position(before), position(after)])
    const direction = operation === 6 ? 1n : -1n
    assert.equal(p1[0] - p0[0], direction * shares)
    assert.equal(p1[1] - p0[1], direction * assets)
    assert.equal(await balance(a.mockUsdc, sibling, before) - await balance(a.mockUsdc, sibling, after), direction * assets)
    assert.equal(await allowance(a.mockUsdc, sibling, v.mockVault, after), 0n)
    state.observations[label] = {assets, shares, positionAfter: p1, idleAssetsAfter: await balance(a.mockUsdc, sibling, after), allowanceAfter: '0'}
  }
  await settle('deposit', 'depositToVault', 6, 10n * usd, 10n * usd)
  await settle('withdraw', 'withdrawFromVault', 8, 2n * usd, 2n * usd)
  await settle('redeem', 'redeemFromVault', 7, 4n * usd, 4n * usd)

  await send('fund-collateral', owner, collateral, token, 'mint', [account, wad])
  const supply = await send('supply', owner, account, accountAbi, 'supply', [wad])
  const before = supply.blockNumber - 1n, after = supply.blockNumber
  const exposure = block => view(account, accountAbi, 'exposure', [], block)
  const [p0, p1] = await Promise.all([exposure(before), exposure(after)])
  assert(p1[0] > p0[0] && p1[1] === p0[1])
  assert.equal(await balance(collateral, account, before) - await balance(collateral, account, after), wad)
  assert.equal(await balance(book, account, after), p1[0])
  assert.equal(await allowance(collateral, account, book, after), 0n)
  state.observations.supply = {amount: wad, sharesBefore: p0[0], sharesAfter: p1[0], debtRaw: p1[1], allowanceAfter: '0'}

  const route = [operator, a.swap, 5, a.mockWokb]
  const grantAt = block => view(account, accountAbi, 'grants', route, block)
  await send('fund-swap', owner, a.mockWokb, token, 'mint', [account, wad])
  const grant = await send('grant-swap', owner, account, accountAbi, 'setGrant', [...route, wad, 2n * wad, expiry])
  assert.deepEqual(await grantAt(grant.blockNumber), [wad, 2n * wad, expiry])
  assert.equal(await view(account, accountAbi, 'operatorAt', [0n], grant.blockNumber), operator)
  const amountIn = wad / 4n
  const quote = await view(a.swap, abis('SinglePoolSwapAdapter'), 'executionQuote', [a.mockWokb, amountIn], grant.blockNumber)
  const minOut = quote[0] - quote[0] / 100n
  const swapArgs = [a.mockWokb, amountIn, minOut, expiry]
  const swap = await send('operator-swap', operator, account, accountAbi, 'swapExactIn', swapArgs)
  const result = event(swap, account, accountAbi, 'SwapSettled')
  assert.equal(getAddress(result.operator), operator)
  assert.equal(getAddress(result.tokenOut), getAddress(a.mockUsdc))
  assert.equal(result.amountIn, amountIn)
  assert(result.amountOut >= minOut)
  const sa = swap.blockNumber, sb = sa - 1n
  assert.equal(await balance(a.mockUsdc, account, sa) - await balance(a.mockUsdc, account, sb), result.amountOut)
  assert.equal(await balance(a.mockWokb, account, sb) - await balance(a.mockWokb, account, sa), amountIn)
  assert.equal(await balance(a.mockUsdc, operator, sa), await balance(a.mockUsdc, operator, sb))
  assert.equal(await allowance(a.mockWokb, account, a.swap, sa), 0n)
  assert.equal(await allowance(a.mockWokb, a.swap, a.venue, sa), 0n)
  assert.deepEqual(await grantAt(sa), [wad, 2n * wad - amountIn, expiry])
  state.observations.swap = {recipient: account, amountIn, minOut, actualOut: result.amountOut, remaining: (await grantAt(sa))[1],
    allowanceToAdapterAfter: '0', allowanceToRouterAfter: '0', ownerGrantExpiry: expiry, executionQuoteAtGrant: quote}
  const stop = await send('revoke-all', owner, account, accountAbi, 'revokeAllOperators', [])
  const revoked = event(stop, account, accountAbi, 'AllOperatorsRevoked')
  assert.equal(await view(account, accountAbi, 'operatorCount', [], stop.blockNumber), 0n)
  assert.deepEqual(await grantAt(stop.blockNumber), [0n, 0n, 0n])
  for (const browser of browserOwners) {
    assert.equal(await view(a.factory, factoryAbi, 'accountOf', [browser], stop.blockNumber), zeroAddress)
    assert.equal(await view(v.vaultFactory, vaultFactoryAbi, 'accountOf', [browser], stop.blockNumber), zeroAddress)
  }
  state.observations.browserReadiness = {block: stop.blockNumber, wallets: browserOwners, baseAccounts: 0, vaultAccounts: 0}
  const rejected = await client.simulateContract({account: operator, address: account, abi: accountAbi,
    functionName: 'swapExactIn', args: swapArgs, blockNumber: stop.blockNumber}).then(() => null, e => e)
  const denied = rejected?.walk?.(e => e.data?.errorName === 'OperatorNotAuthorized')
  assert(denied, 'Expected OperatorNotAuthorized() on post-stop simulation')
  state.observations.revoke = {epoch: revoked.newEpoch, remaining: '0', operatorCount: '0',
    afterStop: {kind: 'eth_call at revoke block', block: stop.blockNumber, method: 'swapExactIn',
      error: denied.data.errorName, selector: toFunctionSelector('OperatorNotAuthorized()')}}
  save()
  console.log(JSON.stringify({baseAccount: account, vaultAccount: sibling, canonicalReceipts: Object.keys(state.steps).length,
    newTransactions: submitted, evidence: reportPath}))
} finally {
  closeSync(lock)
  unlinkSync(reportPath + '.lock')
}

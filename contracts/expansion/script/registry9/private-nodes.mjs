// Launch our own node. The only clients capable of submitting transactions use its fixed loopback URL.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {createPublicClient, createWalletClient, getAddress, http, keccak256, stringToHex, toHex} from 'viem'

const upstreams = ['https://testrpc.xlayer.tech', 'https://xlayertestrpc.okx.com']
const reader = url => createPublicClient({cacheTime:0, transport:http(url, {retryCount:2, timeout:45000})})

export async function selectFork(number, expectedHash) {
  const readers = upstreams.map(reader)
  const ids = await Promise.all(readers.map(r => r.getChainId()))
  assert.deepEqual(ids, [1952, 1952])
  if (number === undefined) {
    const heads = await Promise.all(readers.map(r => r.getBlockNumber()))
    number = heads.reduce((a,b) => a < b ? a : b) - 12n
  }
  const [one, two] = await Promise.all(readers.map(r => r.getBlock({blockNumber:number})))
  assert(one.hash && one.hash === two.hash, 'Upstream witnesses disagree on the fork block')
  if (expectedHash) assert.equal(one.hash, expectedHash, 'Supplied fork hash differs from upstream')
  return {number, hash:one.hash, timestamp:one.timestamp, witnesses:upstreams}
}

export async function withPrivateNode(origin, work) {
  const port = origin ? 19832 : 19831
  const chainId = origin ? 1952 : 31337
  const url = 'http://127.0.0.1:' + port
  const reachable = await fetch(url, {signal:AbortSignal.timeout(800)}).then(() => true, () => false)
  assert(!reachable, 'Dedicated Anvil port already occupied: ' + port)
  const args = ['--host','127.0.0.1','--port',String(port),'--chain-id',String(chainId),'--silent']
  if (origin) args.push('--fork-url',upstreams[0],'--fork-block-number',String(origin.number),'--no-storage-caching')
  else args.push('--timestamp','1795770000')
  const proc = spawn('anvil', args, {stdio:['ignore','ignore','inherit']})
  const exited = once(proc, 'exit')
  const stop = () => proc.kill('SIGTERM')
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const node = reader(url)
    let info
    for (let i=0; i<100 && !info; i++) {
      assert(proc.exitCode === null && proc.signalCode === null, 'Private Anvil exited')
      try { info = await node.request({method:'anvil_nodeInfo'}, {retryCount:0}) } catch { await delay(150) }
    }
    assert(info && proc.exitCode === null && proc.signalCode === null)
    assert.equal(await node.getChainId(), chainId)
    if (origin) {
      assert.equal(info.forkConfig.forkUrl, upstreams[0])
      assert.equal(BigInt(info.forkConfig.forkBlockNumber), origin.number)
      assert.equal((await node.getBlock()).hash, origin.hash)
    } else {
      assert(!info.forkConfig?.forkUrl)
      assert.equal(await node.getBlockNumber(), 0n)
    }
    // Deterministic fresh identities use Anvil impersonation, exclusively inside this private process.
    const identities = Object.fromEntries(['creator','adopter','operator'].map(role => [
      role, getAddress('0x' + keccak256(stringToHex('peridot:registry9:private-fixture:' + role)).slice(-40))
    ]))
    for (const address of Object.values(identities)) {
      assert(!await node.getCode({address}))
      assert.equal(await node.getTransactionCount({address}), 0)
      await node.request({method:'anvil_setBalance',params:[address,toHex(10n**19n)]}, {retryCount:0})
      await node.request({method:'anvil_impersonateAccount',params:[address]}, {retryCount:0})
    }
    const wallet = createWalletClient({transport:http(url, {retryCount:0, timeout:90000})})
    const send = async (label, from, request) => {
      assert(Object.values(identities).includes(from))
      const estimate = await node.estimateGas({account:from, ...request})
      const gas = estimate * 125n / 100n + 30000n
      const hash = await wallet.sendTransaction({chain:null, account:from, value:0n, ...request, gas})
      const receipt = await node.waitForTransactionReceipt({hash, pollingInterval:100, timeout:90000, retryCount:3})
      assert.equal(receipt.status, 'success', label + ' failed: ' + hash)
      assert.equal((await node.getBlock({blockNumber:receipt.blockNumber})).hash, receipt.blockHash)
      assert.equal(getAddress(receipt.from), from)
      return {label, from, to:receipt.to, created:receipt.contractAddress, hash, block:receipt.blockNumber,
        blockHash:receipt.blockHash, gasEstimate:estimate, gasLimit:gas, gasUsed:receipt.gasUsed,
        effectiveGasPriceWei:receipt.effectiveGasPrice, feeWei:receipt.gasUsed * receipt.effectiveGasPrice, status:receipt.status}
    }
    const confirm = () => node.request({method:'anvil_mine',params:['0x1']}, {retryCount:0})
    return await work({node,chainId,identities,send,confirm})
  } finally {
    process.off('SIGINT',stop)
    process.off('SIGTERM',stop)
    if (proc.exitCode === null && proc.signalCode === null) stop()
    const limit = setTimeout(() => proc.kill('SIGKILL'), 5000)
    try { await exited } finally { clearTimeout(limit) }
  }
}

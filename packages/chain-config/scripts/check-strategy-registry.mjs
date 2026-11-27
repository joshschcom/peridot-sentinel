// From the repo root: node packages/chain-config/scripts/check-strategy-registry.mjs
// Read-only. A successful run prints the independently observed block and receipt identities.
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {pathToFileURL} from 'node:url'
import {createPublicClient, getAddress, getContractAddress, http, keccak256, size} from 'viem'
import review from '../../../evidence/claude-registry/deploy-1952.json' with {type:'json'}
import pin from '../deployments/strategy-registry-1952.json' with {type:'json'}

const endpoints = ['https://testrpc.xlayer.tech', 'https://xlayertestrpc.okx.com']

export function checkReviewedPin(candidate) {
  assert.equal(candidate.chainId, 1952)
  assert.equal(candidate.chainId, review.chainId)
  assert.equal(candidate.confirmations, 12)
  assert.equal(candidate.address, getAddress(review.address))
  assert.equal(candidate.runtimeCodeHash, review.runtimeKeccak)
  assert.equal(candidate.deploymentBlock, String(review.blockNumber))
  assert.equal(candidate.deploymentBlockHash, review.blockHash)
  assert.equal(candidate.deploymentTxHash, review.transactionHash)
}

async function observe(clients) {
  const deployed = BigInt(pin.deploymentBlock)
  const heads = await Promise.all(clients.map(client => client.getBlockNumber()))
  const common = heads.reduce((a, b) => a < b ? a : b)
  assert(common >= deployed + BigInt(pin.confirmations), 'Waiting for both endpoints to see 12 successors')

  const witnesses = await Promise.all(clients.map(async (client, index) => {
    const [chainId, tx, receipt, deployment, observed, initialCode, currentCode] = await Promise.all([
      client.getChainId(), client.getTransaction({hash:pin.deploymentTxHash}),
      client.getTransactionReceipt({hash:pin.deploymentTxHash}), client.getBlock({blockNumber:deployed}),
      client.getBlock({blockNumber:common}), client.getCode({address:pin.address, blockNumber:deployed}),
      client.getCode({address:pin.address, blockNumber:common}),
    ])
    assert.equal(chainId, pin.chainId)
    assert.equal(tx.chainId, pin.chainId)
    assert.equal(tx.hash, pin.deploymentTxHash)
    assert.equal(tx.to, null)
    assert.equal(tx.value, 0n)
    assert.equal(getAddress(tx.from), getAddress(review.deployer))
    assert.equal(tx.nonce, review.nonce)
    assert.equal(getContractAddress({from:tx.from, nonce:BigInt(tx.nonce)}), pin.address)
    assert.equal(keccak256(tx.input), review.creationCodeKeccak)

    assert.equal(receipt.status, 'success')
    assert.equal(receipt.transactionHash, tx.hash)
    assert.equal(receipt.transactionIndex, tx.transactionIndex)
    assert.equal(getAddress(receipt.from), getAddress(tx.from))
    assert.equal(receipt.to, null)
    assert.equal(getAddress(receipt.contractAddress), pin.address)
    assert.equal(receipt.gasUsed, BigInt(review.gasUsed))
    assert.equal(tx.blockNumber, deployed)
    assert.equal(receipt.blockNumber, deployed)
    assert.equal(deployment.number, deployed)
    assert.equal(deployment.hash, pin.deploymentBlockHash)
    assert.equal(tx.blockHash, deployment.hash)
    assert.equal(receipt.blockHash, deployment.hash)
    assert.equal(deployment.transactions[tx.transactionIndex], tx.hash)

    assert(initialCode && currentCode, 'Registry code unavailable')
    assert.equal(size(initialCode), review.runtimeBytes)
    assert.equal(keccak256(initialCode), pin.runtimeCodeHash)
    assert.equal(keccak256(currentCode), pin.runtimeCodeHash)
    assert.equal(observed.number, common)
    assert(observed.hash, 'Missing common block hash')
    const after = await client.getBlock({blockNumber:common})
    assert.equal(after.hash, observed.hash, 'Common block changed during verification')
    return {
      rpc:endpoints[index], head:heads[index].toString(), commonBlockHash:observed.hash,
      deploymentRuntimeHash:keccak256(initialCode), commonRuntimeHash:keccak256(currentCode),
    }
  }))
  assert.equal(witnesses[0].commonBlockHash, witnesses[1].commonBlockHash, 'Public endpoints disagree')
  return {
    profile:'public-testnet', observedAt:new Date().toISOString(), pin, deployer:review.deployer,
    nonce:review.nonce, creationCodeHash:review.creationCodeKeccak, runtimeBytes:review.runtimeBytes,
    gasUsed:String(review.gasUsed), commonBlock:String(common), successors:String(common-deployed), witnesses,
  }
}

export async function checkStrategyRegistry() {
  checkReviewedPin(pin)
  const clients = endpoints.map(url => createPublicClient({
    cacheTime:0, transport:http(url, {retryCount:0, timeout:12000}),
  }))
  // A stale header, code or receipt on a single backend invalidates that whole observation.
  for (let attempt = 1; ; attempt++) {
    try { return await observe(clients) } catch (error) {
      if (attempt >= 4) throw error
      await delay(1000 * attempt)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await checkStrategyRegistry(), null, 2))
}

// Session 10 public testnet publications. Preview is keyless. --publish reconciles the same two intents.
import assert from 'node:assert/strict'
import {createPublicClient, decodeFunctionData, getAddress, http, keccak256, stringToHex} from 'viem'
import {curatedStrategies} from '../../../../packages/strategy-sdk/index.ts'
import {buildStrategyPublication, registryAbi, verifyStrategyPublication} from '../../../../packages/strategy-sdk/registry.ts'
import publicPin from '@peridot/chain-config/deployments/strategy-registry-1952.json' with {type:'json'}
import {checkReviewedPin} from '../../../../packages/chain-config/scripts/check-strategy-registry.mjs'
import rehearsal from '../../../../evidence/session9-registry/nov27/fork-1952.json' with {type:'json'}
import {deployer, openSession, publicRpc, retryRead} from '../session6-transactions.mjs'

const mode = process.argv.slice(2)
assert(mode.length === 1 && ['--preview','--publish'].includes(mode[0]), 'Choose --preview or --publish')
checkReviewedPin(publicPin)
const pin = {...publicPin, deploymentBlock:BigInt(publicPin.deploymentBlock)}
const reader = createPublicClient({transport:http(publicRpc,{retryCount:2}),cacheTime:0})
assert.equal(await reader.getChainId(),pin.chainId)
const templates = curatedStrategies()
assert.deepEqual(templates.map(x=>x.template.profile),['debt-protection-v1','restricted-swap-v2'])
const session = mode[0] === '--publish' ? await openSession({mode:'testnet',slug:'registry-curated-v1',forkPort:19832}) : null
try {
  for (const {template,canonical,hash} of templates) {
    const profile = template.profile
    const approved = rehearsal.publications.find(item=>item.profile===profile)
    const seriesId = keccak256(stringToHex('peridot:s9:'+profile))
    assert.equal(approved.contentHash,hash)
    assert.equal(approved.seriesId,seriesId)
    const prior = session?.state.steps[profile]
    let data
    if (prior) {
      // Use the already reserved hash, including when its first receipt read failed.
      const tx = await retryRead(()=>reader.getTransaction({hash:prior.hash}))
      assert.equal(tx.chainId,1952)
      assert.equal(getAddress(tx.from),deployer)
      assert.equal(getAddress(tx.to),pin.address)
      assert.equal(tx.value,0n)
      assert.equal(tx.nonce,prior.nonce)
      data = tx.input
    } else {
      const plan = await buildStrategyPublication(reader,pin,{creator:deployer,seriesId,expectedVersion:1,json:canonical})
      assert.equal(plan.chainId,1952)
      assert.equal(plan.from,deployer)
      assert.equal(plan.to,pin.address)
      assert.equal(plan.contentHash,hash)
      assert.equal(plan.value,0n)
      data = plan.data
    }
    const call = decodeFunctionData({abi:registryAbi,data})
    assert.equal(call.functionName,'publish')
    const [series,version,targetChainId,adapterVersion,policyKey,canonicalJson] = call.args
    assert.equal(series,seriesId)
    assert.equal(version,1)
    assert.equal(canonicalJson,stringToHex(canonical))
    assert.equal(verifyStrategyPublication({targetChainId,adapterVersion,policyKey,canonicalJson,contentHash:hash}).hash,hash)
    if (session) {
      await session.send(profile,{to:pin.address,data,value:0n})
    } else {
      const gas = await retryRead(()=>reader.estimateGas({account:deployer,to:pin.address,data,value:0n}))
      console.log(profile, 'version',version, 'content',hash, 'estimated gas',String(gas))
    }
  }
} finally {
  session?.close()
}

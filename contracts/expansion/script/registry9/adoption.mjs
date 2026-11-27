// Verify independent ownership using the existing public testnet factories on the private fork.
import assert from 'node:assert/strict'
import {encodeFunctionData, getAddress, zeroAddress} from 'viem'
import {SentinelAccountAbi, SentinelAccountFactoryAbi} from '@peridot/chain-config'
import {buildAdoptionPlan, buildRevocationPlan} from '../../../../packages/strategy-sdk/index.ts'
import v2Factory from '../../../../packages/chain-config/expansion/abi/SentinelAccountFactoryV2.json' with {type:'json'}
import v2Account from '../../../../packages/chain-config/expansion/abi/SentinelAccountV2.json' with {type:'json'}

export async function adopt({node,chainId,identities,record}, publication, accountPolicy) {
  assert.equal(chainId, 1952)
  const {creator,adopter,operator} = identities
  const {template} = publication
  const debt = template.profile === 'debt-protection-v1'
  const factory = template.deployment.factory
  const abi = debt ? SentinelAccountFactoryAbi : v2Factory
  const accountOf = () => node.readContract({address:factory,abi,functionName:'accountOf',
    args:debt ? [adopter,template.deployment.target] : [adopter]})
  assert.equal(await accountOf(),zeroAddress, 'Adopter needs a fresh Sentinel account for this rehearsal')
  await assert.rejects(buildAdoptionPlan(node,template,{owner:adopter,operator}), /Create your own account/)
  await record('Adopter creates own ' + template.profile + ' account', adopter,
    {to:factory,data:encodeFunctionData({abi,functionName:'createAccount',args:debt ? [template.deployment.target,accountPolicy] : [accountPolicy]})})
  const account = await accountOf()
  const accountAbi = debt ? SentinelAccountAbi : v2Account
  assert.equal(getAddress(await node.readContract({address:account,abi:accountAbi,functionName:'owner'})),adopter)
  const grant = who => node.readContract({address:account,abi:accountAbi,functionName:debt?'operators':'grants',
    args:debt?[who]:[who,template.deployment.target,5,template.allowedAssets[0].address]})
  const creatorBefore = await grant(creator), operatorBefore = await grant(operator)
  const empty = tuple => tuple.every(item => BigInt(item) === 0n)
  assert(empty(creatorBefore) && empty(operatorBefore))
  const select = {owner:adopter,operator}
  const first = await buildAdoptionPlan(node, template, select)
  const plan = first.reviewId ? await buildAdoptionPlan(node,template,{...select,acknowledge:first.reviewId}) : first
  assert(plan.transactions.length > 0 && plan.templateHash === publication.hash)
  const sign = async tx => {
    assert.equal(tx.chainId,1952)
    assert.equal(tx.value,0n)
    assert.equal(getAddress(tx.from),adopter)
    assert.equal(getAddress(tx.to),getAddress(account))
    return await record(template.profile + ' owner ' + tx.method,adopter,{to:tx.to,data:tx.data})
  }
  const writes = []
  for(const tx of plan.transactions) writes.push((await sign(tx)).hash)
  const active = await grant(operator)
  const expectedFirst = debt ? 8n : BigInt(template.budget.perCallRaw)
  assert.equal(BigInt(active[0]),expectedFirst)
  assert.equal(active[1],BigInt(template.budget.cumulativeRaw))
  assert.equal(active[2],plan.expiry)
  assert(empty(await grant(creator)))
  const revoke = await buildRevocationPlan(node,template,select)
  assert.equal(revoke.transactions.length,1)
  const revoked = (await sign(revoke.transactions[0])).hash
  const operatorAfter = await grant(operator), creatorAfter = await grant(creator)
  assert(empty(operatorAfter) && empty(creatorAfter))
  return {profile:template.profile, strategyHash:publication.hash, account,adopter,operator,creator,
    initialAccount:zeroAddress, plannerRejectedMissingAccount:true,
    review:{block:plan.blockNumber,blockHash:plan.blockHash,warnings:plan.warnings,reviewId:plan.reviewId,
      methods:plan.transactions.map(t=>t.method),expiry:plan.expiry}, writes,creatorBefore,operatorBefore,
    activeOperatorGrant:active,revoked,operatorAfter,creatorAfter}
}

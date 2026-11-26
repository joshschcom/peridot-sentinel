// LOCAL ONLY. Reuse the pinned public artifacts; all authority comes from the current wallet.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPublicClient, defineChain, getAddress, http, keccak256} from 'viem'
import {readJson} from '../session6-transactions.mjs'

export const rpcUrl = 'http://127.0.0.1:18545'
export const chain = defineChain({id:31337,name:'Shared local Anvil',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpcUrl]}}})
export const client = createPublicClient({chain,transport:http(rpcUrl,{retryCount:0}),cacheTime:0})
export const manifestDir = 'packages/chain-config/expansion/deployments'
export const journalDir = 'deployments/session8/local'
export const base = readJson('packages/chain-config/deployments/31337.json')
export const market = base.markets[0]
export const personal = base.tapeout.circuits.find(row => row.kind === 'ACCOUNT')
export const marketPolicy = base.tapeout.circuits.find(row => row.kind === 'MARKET')
export const account0 = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')

function artifact(name, legacy = false, file = name) {
  return readJson('contracts/' + (legacy ? '' : 'expansion/') + 'out/' + file + '.sol/' + name + '.json')
}
export const types = {
  mockWokb:artifact('TestnetToken', true), mockUsdc:artifact('TestnetToken', true),
  mockOracle:artifact('LocalVenueQuotes'), cpu:artifact('DevelopmentReferenceProcessor', true),
  execution:artifact('ExecutionPolicy'), source:artifact('TestnetSwapQuoteSource',false,'TestnetInventoryVenue'),
  venue:artifact('TestnetInventoryVenue'), swap:artifact('SinglePoolSwapAdapter'),
  lending:artifact('PeridotLendingAdapter'), factory:artifact('SentinelAccountFactoryV2'),
  mockVault:artifact('TestnetSavingsVault'), vaultAdapter:artifact('SingleVaultAdapter'), vaultFactory:artifact('VaultSentinelAccountFactoryV2'),
  acceptancePrices:artifact('LocalAcceptancePrices'), acceptanceFactory:artifact('MarketFactory',true),
}
export const m4Artifacts = {controller:artifact('IsolatedController',true),book:artifact('MarketPToken',true)}

export function read(address, abi, functionName, args = [], blockNumber) {
  return client.readContract({address,abi,functionName,args,blockNumber})
}
export function sameAddress(actual, expected) {
  assert.equal(getAddress(actual), getAddress(expected))
}

export async function runtimeHash(address, built, blockNumber) {
  const code = await client.getCode({address,blockNumber})
  assert(code && code !== '0x', 'Missing runtime at '+address)
  function withoutImmutables(hex) {
    const bytes = Buffer.from(hex.slice(2),'hex')
    for (const refs of Object.values(built.deployedBytecode.immutableReferences ?? {})) {
      for (const {start,length} of refs) bytes.fill(0,start,start+length)
    }
    return bytes
  }
  assert.deepEqual(withoutImmutables(code),withoutImmutables(built.deployedBytecode.object),'Unexpected runtime at '+address)
  return keccak256(code)
}

export function checkArtifacts() {
  const publicBase = readJson(manifestDir+'/1952.json').source
  const publicVault = readJson(manifestDir+'/vault-1952.json').build
  const pinned = {...publicBase.creationHashes,...publicVault.creationHashes}
  for (const [key,built] of Object.entries(types)) {
    if (key === 'mockOracle' || key === 'acceptancePrices') {
      const path = 'script/local8/'+(key==='mockOracle'?'LocalVenueQuotes':'LocalAcceptancePrices')+'.sol'
      assert.equal(keccak256(readFileSync('contracts/expansion/'+path)),built.metadata.sources[path].keccak256)
    } else if (key !== 'acceptanceFactory') {
      assert.equal(keccak256(built.bytecode.object),pinned[key],'Artifact does not match published source pin: '+key)
    }
  }
  return {expansionCommit:publicBase.expansionCommit,vaultCommit:publicVault.sourceCommit,
    m4Commit:base.commit,localQuoteCreationHash:keccak256(types.mockOracle.bytecode.object),
    localLendingPricesCreationHash:keccak256(types.acceptancePrices.bytecode.object)}
}

export async function sharedNode() {
  const [chainId,meta,genesis,accounts] = await Promise.all([client.getChainId(),client.request({method:'anvil_metadata'}),client.getBlock({blockNumber:0n}),client.request({method:'eth_accounts'})])
  assert.equal(chainId,31337)
  assert.equal(meta.chainId,31337)
  assert.equal(meta.forkedNetwork,null,'Expected unforked local Anvil')
  assert.match(meta.clientVersion,/^anvil\//)
  assert.match(meta.instanceId,/^0x[0-9a-f]{64}$/)
  assert(accounts.length >= 10)
  sameAddress(accounts[0],account0)
  // deploy-demo's local journal captures both this exact node instance and its genesis.
  const m4Journal = readJson('deployments/local/demo-'+meta.instanceId.slice(2,14)+'.json')
  assert.equal(m4Journal.runId,meta.instanceId)
  assert.equal(m4Journal.genesisHash,genesis.hash)
  assert.equal(m4Journal.chainId,chainId)
  sameAddress(m4Journal.sender,accounts[0])
  assert.equal(base.status,'deployed')
  assert.equal(base.chainId,31337)
  assert.deepEqual(base,m4Journal.manifest,'M4 manifest is from another deployment')
  const m4RuntimeHashes = {}
  await Promise.all(Object.entries(base.contracts).map(async ([name,address]) => {
    const built = artifact(/^Mock(Collateral|Debt)$/.test(name) ? 'TestnetToken' : name, true)
    const creation = m4Journal.transactions['deploy-'+name]
    const receipt = await client.getTransactionReceipt({hash:creation.hash})
    assert.equal(receipt.status,'success')
    assert.equal(receipt.blockHash,creation.blockHash)
    sameAddress(receipt.contractAddress,address)
    const artifactName = /^Mock(Collateral|Debt)$/.test(name) ? 'TestnetToken' : name
    assert.equal(m4Journal.buildHashes[artifactName],keccak256(built.bytecode.object),name+' M4 artifact changed')
    m4RuntimeHashes[name] = await runtimeHash(address,built)
  }))
  m4RuntimeHashes.controller = await runtimeHash(market.controller,artifact('IsolatedController',true))
  const proxyRuntime = ('0x363d3d373d3d3d363d73'+base.contracts.MarketPToken.slice(2)+'5af43d82803e903d91602b57fd5bf3').toLowerCase()
  for (const key of ['collateralMarket','debtMarket']) {
    const code = await client.getCode({address:market[key]})
    assert.equal(code?.toLowerCase(),proxyRuntime,key+' targets a different pToken implementation')
    m4RuntimeHashes[key] = keccak256(code)
  }
  assert(await read(base.contracts.MarketFactory,artifact('MarketFactory',true).abi,'isMarket',[market.controller]))
  const policy = await read(base.contracts.PolicyRegistry,artifact('PolicyRegistry',true).abi,'requirePolicy',[personal.policyId,1])
  sameAddress(policy[0],base.tapeout.processor)
  assert.equal(String(policy[1]),personal.circuitId)
  const hashes = Object.fromEntries(Object.entries(m4RuntimeHashes).sort(([a],[b])=>a.localeCompare(b)))
  return {anvil:{rpcUrl,instanceId:meta.instanceId,genesisHash:genesis.hash},m4RuntimeHashes:hashes}
}

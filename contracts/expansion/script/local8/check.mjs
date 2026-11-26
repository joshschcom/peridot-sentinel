// Check one specific unforked local instance and the immutable bindings used for browser writes.
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {encodeDeployData,getAddress,keccak256} from 'viem'
import {readJson} from '../session6-transactions.mjs'
import {account0,base,checkArtifacts,client,journalDir,m4Artifacts,manifestDir,market,marketPolicy,personal,read,runtimeHash,sameAddress,sharedNode,types} from './bindings.mjs'
import {executionCircuit} from '../../policy/compile.mjs'

export async function verifyManifests(core,vault) {
  assert.equal(core.schemaVersion,2)
  assert.equal(vault.schemaVersion,1)
  const identity = {...await sharedNode(),source:checkArtifacts()}
  const journalPath = journalDir+'/deployment-'+identity.anvil.instanceId.slice(2,14)+'.json'
  const journal = readJson(journalPath)
  assert.deepEqual(journal.identity,identity)
  assert.equal(core.deploymentBlock,journal.steps['deploy-mockWokb'].block)
  assert.equal(vault.deploymentBlock,journal.steps['deploy-mockVault'].block)
  for (const manifest of [core,vault]) {
    assert.equal(manifest.chainId,31337)
    assert.equal(manifest.profile,'local')
    assert.equal(manifest.public,false)
    assert.equal(manifest.uiEnabled,true)
    assert.deepEqual(manifest.anvil,identity.anvil)
    assert.deepEqual(manifest.source,identity.source)
    assert.equal(manifest.journal,journalPath)
    assert.equal(manifest.readyBlock,journal.steps['deploy-vaultFactory'].block)
    assert.equal((await client.getBlock({blockNumber:BigInt(manifest.readyBlock)})).hash,manifest.readyBlockHash)
    for (const [key,address] of Object.entries(manifest.contracts)) {
      const row = journal.steps['deploy-'+key]
      assert(row,'Unknown contract '+key)
      sameAddress(row.contractAddress,address)
      assert.equal(await runtimeHash(address,types[key]),manifest.runtimeCodeHashes[key],key+' differs from manifest')
    }
  }
  await Promise.all(Object.entries(journal.steps).map(async ([label,step]) => {
    const [tx,receipt,block] = await Promise.all([client.getTransaction({hash:step.hash}),
      client.getTransactionReceipt({hash:step.hash}),client.getBlock({blockNumber:BigInt(step.block)})])
    assert.equal(receipt.status,'success',label)
    assert.equal(receipt.status,step.status)
    assert.equal(String(receipt.gasUsed),step.gasUsed)
    assert.equal(block.hash,step.blockHash)
    assert.equal(receipt.blockHash,block.hash)
    sameAddress(tx.from,account0)
    assert.equal(tx.to?.toLowerCase() ?? null,step.to?.toLowerCase() ?? null)
    assert.equal(keccak256(tx.input),step.dataHash)
    assert.equal(tx.nonce,step.nonce)
    assert.equal(tx.value,0n)
  }))
  const a = {...core.contracts,...vault.contracts}
  const book = core.lendingMarket
  const view = (key,fn,args=[]) => read(a[key],types[key].abi,fn,args)
  async function addressBindings(key,expected) {
    for (const [field,address] of Object.entries(expected)) sameAddress(await view(key,field),address)
  }
  assert.deepEqual(core.m4,{marketFactory:base.contracts.MarketFactory,...market,accountPolicy:personal.policyId})
  assert.equal(vault.sourcePolicy,personal.policyId)
  assert.equal(core.execution.mode,'development-reference')
  assert.equal(core.execution.netlistHash,executionCircuit.netlistHash)
  assert.equal(book.marketPolicy,marketPolicy.policyId)
  assert.notEqual(getAddress(book.controller),getAddress(market.controller))
  sameAddress(book.factory,a.acceptanceFactory)
  sameAddress(book.collateralAsset,base.contracts.MockCollateral)
  sameAddress(book.debtAsset,base.contracts.MockDebt)
  sameAddress(book.priceSource,a.acceptancePrices)
  await addressBindings('acceptanceFactory',{oracle:a.acceptancePrices,registry:base.contracts.PolicyRegistry,
    adapter:base.contracts.TapeOutPolicyAdapter,rateModel:base.contracts.DemoRateModel,pTokenImplementation:base.contracts.MarketPToken,
    approvedCollateral:book.collateralAsset,approvedDebt:book.debtAsset})
  assert(await view('acceptanceFactory','isMarket',[book.controller]))
  sameAddress(await view('acceptanceFactory','marketAt',[0n]),book.controller)
  assert.equal(await read(book.controller,m4Artifacts.controller.abi,'active'),true)
  await runtimeHash(book.controller,m4Artifacts.controller)
  for (const key of ['debtMarket','collateralMarket']) {
    sameAddress(await read(book.controller,m4Artifacts.controller.abi,key),book[key])
    const code = await client.getCode({address:book[key]})
    assert.equal(keccak256(code),identity.m4RuntimeHashes[key])
  }
  await addressBindings('acceptancePrices',{collateral:book.collateralAsset,debt:book.debtAsset})
  assert.deepEqual(await view('acceptancePrices','price',[book.collateralAsset]),[16n*10n**17n,true])
  assert.deepEqual(await view('acceptancePrices','price',[book.debtAsset]),[10n**18n,true])
  await addressBindings('lending',{marketFactory:book.factory,controller:book.controller,collateralMarket:book.collateralMarket,
    debtMarket:book.debtMarket,collateralAsset:book.collateralAsset,debtAsset:book.debtAsset,registry:base.contracts.PolicyRegistry,policyAdapter:base.contracts.TapeOutPolicyAdapter})
  await view('lending','requireAccountPolicy',[personal.policyId])
  await addressBindings('factory',{lendingAdapter:a.lending,swapAdapter:a.swap,executionPolicy:a.execution})
  await addressBindings('execution',{processor:a.cpu})
  assert.equal(await view('execution','processorCodeHash'),core.runtimeCodeHashes.cpu)
  const id = await view('execution','circuitId')
  assert.equal(String(id),core.execution.circuitId)
  assert.equal(await view('execution','NETLIST_HASH'),core.execution.netlistHash)
  assert.deepEqual(await view('cpu','circuitInfo',[id]),[20,1,0,59])
  assert.equal(keccak256(await view('cpu','netlist',[id])),core.execution.netlistHash)
  await addressBindings('source',{oracle:a.mockOracle})
  await addressBindings('mockOracle',{venue:a.venue})
  const tokens = [a.mockWokb,a.mockUsdc].sort((x,y)=>BigInt(x)<BigInt(y)?-1:1)
  await addressBindings('venue',{token0:tokens[0],token1:tokens[1],factory:a.venue})
  await addressBindings('swap',{token0:tokens[0],token1:tokens[1],pool:a.venue,router:a.venue,factory:a.venue,priceSource:a.source})
  assert.equal(core.swap.mockWokbDecimals,18)
  assert.equal(core.swap.mockUsdcDecimals,6)
  assert.equal(await view('mockWokb','decimals'),core.swap.mockWokbDecimals)
  assert.equal(await view('mockUsdc','decimals'),core.swap.mockUsdcDecimals)
  assert.equal(core.swap.fixedWokbUsdWad,String(80n*10n**18n))
  assert.equal(core.swap.fixedUsdcUsdWad,String(10n**18n))
  for (const [asset,price] of [[a.mockWokb,core.swap.fixedWokbUsdWad],[a.mockUsdc,core.swap.fixedUsdcUsdWad]]) {
    const at = BigInt(core.readyBlock)
    const [value,observed] = await read(a.source,types.source.abi,'price',[asset],at)
    assert.equal(String(value),price)
    assert.equal(observed,(await client.getBlock({blockNumber:at})).timestamp)
  }
  const [gross,floor] = await view('swap','executionQuote',[a.mockWokb,10n**18n])
  assert.equal(gross,80_000000n)
  assert.equal(floor,76_000000n)
  assert.equal(await view('swap','maxAge'),86400n)
  assert.equal(core.swap.feePpm,500)
  assert.equal(core.swap.hardMaxLossBps,500)
  assert.equal(core.swap.policyMaxLossBps,100)
  assert.equal(await view('venue','fee'),core.swap.feePpm)
  assert.equal(await view('swap','hardSlippageBps'),core.swap.hardMaxLossBps)
  for (const [bps,expected] of [[core.swap.policyMaxLossBps,'0x01'],[core.swap.policyMaxLossBps+1,'0x00']]) {
    const context = await view('execution','encodeSwap',[15,bps])
    assert.equal(await view('cpu','eval',[id,context]),expected)
  }
  for (const [key,initial] of [['mockWokb',100n*10n**18n],['mockUsdc',8000_000000n]]) {
    const historical = await read(a[key],types[key].abi,'balanceOf',[a.venue],BigInt(core.readyBlock))
    assert.equal(historical,initial,'Initial venue inventory differs')
  }
  assert.deepEqual(vault.baseContracts,{lending:a.lending,swap:a.swap,execution:a.execution,mockUsdc:a.mockUsdc})
  sameAddress(vault.asset,a.mockUsdc)
  await addressBindings('vaultFactory',{vaultAdapter:a.vaultAdapter})
  // Three constructor bindings on this factory are private. Verify the actual mined initcode.
  const deployed = await client.getTransaction({hash:journal.steps['deploy-vaultFactory'].hash})
  assert.equal(deployed.input,encodeDeployData({abi:types.vaultFactory.abi,bytecode:types.vaultFactory.bytecode.object,
    args:[a.lending,a.swap,a.execution,a.vaultAdapter]}))
  await addressBindings('vaultAdapter',{vault:a.mockVault,asset:a.mockUsdc,implementation:a.mockVault})
  await addressBindings('mockVault',{asset:a.mockUsdc})
  assert.equal(vault.assetDecimals,6)
  assert.equal(vault.shareDecimals,await view('mockVault','decimals'))
  return {chainId:31337,instanceId:identity.anvil.instanceId,verifiedDeploymentReceipts:Object.keys(journal.steps).length,
    verifiedM4Runtimes:Object.keys(identity.m4RuntimeHashes).length,verifiedExpansionRuntimes:Object.keys(a).length,
    primaryM4Controller:market.controller,localAcceptanceController:book.controller}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const checked=await verifyManifests(readJson(manifestDir+'/31337.json'),readJson(manifestDir+'/vault-31337.json'))
  console.log(JSON.stringify(checked,null,2))
}

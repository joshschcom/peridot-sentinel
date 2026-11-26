// From repo root. Only account #0 on the M4-bearing unforked local Anvil can submit.
import assert from 'node:assert/strict'
import {encodeDeployData,encodeFunctionData,getAddress,parseEventLogs} from 'viem'
import {executionCircuit} from '../../policy/compile.mjs'
import {writeJson} from '../session6-transactions.mjs'
import {account0,base,checkArtifacts,m4Artifacts,manifestDir,market,marketPolicy,personal,read,runtimeHash,sharedNode,types} from './bindings.mjs'
import {openJournal} from './transactions.mjs'
import {verifyManifests} from './check.mjs'

const source = checkArtifacts()
const identity = {...await sharedNode(),source}
const s = openJournal(identity)
const addresses = {}
async function deploy(key,args=[]) {
  const built = types[key]
  const receipt = await s.send('deploy-'+key,undefined,encodeDeployData({abi:built.abi,bytecode:built.bytecode.object,args}))
  addresses[key] = getAddress(receipt.contractAddress)
  await runtimeHash(addresses[key],built)
  return receipt
}
function call(label,key,functionName,args) {
  return s.send(label,addresses[key],encodeFunctionData({abi:types[key].abi,functionName,args}))
}
async function hashes(entries) {
  const values = await Promise.all(Object.entries(entries).map(async ([key,address]) => [key,await runtimeHash(address,types[key])]))
  return Object.fromEntries(values)
}
try {
  const wad = 10n**18n
  const first = await deploy('mockWokb',['Local Mock WOKB','mWOKB',18])
  await deploy('mockUsdc',['Local Mock USDC','mUSDC',6])
  await deploy('venue',[addresses.mockWokb,addresses.mockUsdc,80n*wad,wad])
  await deploy('mockOracle',[addresses.venue])
  await deploy('source',[addresses.mockOracle])
  await call('seed-venue-mWOKB','mockWokb','mint',[addresses.venue,100n*wad])
  await call('seed-venue-mUSDC','mockUsdc','mint',[addresses.venue,8000_000000n])
  await deploy('cpu')
  const program = await call('install-execution-program','cpu','addReferenceCircuit',[executionCircuit.netlist])
  const [added] = parseEventLogs({abi:types.cpu.abi,eventName:'ReferenceCircuitAdded',logs:program.logs})
  assert.equal(added.args.netlistHash,executionCircuit.netlistHash)
  const id = added.args.id
  await deploy('execution',[addresses.cpu,id])
  await deploy('swap',[addresses.venue,addresses.venue,addresses.mockWokb,addresses.mockUsdc,addresses.source,86400n,500])
  await deploy('mockVault',[addresses.mockUsdc])
  await deploy('vaultAdapter',[addresses.mockVault,addresses.mockUsdc])

  // The existing M4 feed is stale. Its factory fixes that feed permanently. Retain all M4
  // addresses and use a separate isolated book with the same asset, risk and policy code.
  const m4 = base.contracts
  await deploy('acceptancePrices',[m4.MockCollateral,m4.MockDebt])
  await deploy('acceptanceFactory',[m4.PolicyRegistry,m4.TapeOutPolicyAdapter,addresses.acceptancePrices,m4.DemoRateModel,
    m4.MarketPToken,m4.MockCollateral,m4.MockDebt])
  const limits = await read(market.controller,m4Artifacts.controller.abi,'limits')
  const created = await call('create-local-acceptance-market','acceptanceFactory','createMarket',[marketPolicy.policyId,...limits])
  const [entry] = parseEventLogs({abi:types.acceptanceFactory.abi,eventName:'MarketCreated',logs:created.logs})
  const {controller,collateralMarket,debtMarket} = entry.args
  const lendingMarket = {label:'Separate local acceptance book; fixed simulated 1.6 USD mCOL and 1 USD mUSD, always marked fresh',
    factory:addresses.acceptanceFactory,controller,collateralMarket,debtMarket,collateralAsset:m4.MockCollateral,
    debtAsset:m4.MockDebt,priceSource:addresses.acceptancePrices,marketPolicy:marketPolicy.policyId}
  const seed = limits[5] + 100_000000n
  const assetCall = (label,to,abi,functionName,args) => s.send(label,to,encodeFunctionData({abi,functionName,args}))
  await assetCall('mint-acceptance-seed',m4.MockDebt,types.mockUsdc.abi,'mint',[account0,seed])
  await assetCall('approve-acceptance-seed',m4.MockDebt,types.mockUsdc.abi,'approve',[debtMarket,seed])
  await assetCall('supply-acceptance-seed',debtMarket,m4Artifacts.book.abi,'mint',[seed])
  await assetCall('activate-acceptance-market',controller,m4Artifacts.controller.abi,'activate',[])
  await deploy('lending',[lendingMarket.factory,lendingMarket.controller])
  await deploy('factory',[addresses.lending,addresses.swap,addresses.execution])
  const last = await deploy('vaultFactory',[addresses.lending,addresses.swap,addresses.execution,addresses.vaultAdapter])
  const {mockVault,vaultAdapter,vaultFactory,...coreAddresses} = addresses
  const vaultAddresses = {mockVault,vaultAdapter,vaultFactory}
  const common = {chainId:31337,profile:'local',public:false,uiEnabled:true,anvil:identity.anvil,
    journal:s.path,readyBlock:String(last.blockNumber),readyBlockHash:last.blockHash}
  const core = {...common,schemaVersion:2,label:'Unforked local Anvil. Inventory-backed mock venue; prices fixed in the constructor. The timestamp is the current simulated block time.',
    deploymentBlock:String(first.blockNumber),source,m4:{marketFactory:base.contracts.MarketFactory,...market,accountPolicy:personal.policyId},
    lendingMarket,contracts:coreAddresses,runtimeCodeHashes:await hashes(coreAddresses),execution:{mode:'development-reference',circuitId:String(id),netlistHash:added.args.netlistHash},
    swap:{feePpm:500,hardMaxLossBps:500,policyMaxLossBps:100,mockWokbDecimals:18,mockUsdcDecimals:6,fixedWokbUsdWad:String(80n*wad),fixedUsdcUsdWad:String(wad)}}
  const vault = {...common,schemaVersion:1,label:'Unforked local Anvil. Mock ERC-4626 savings vault holding valueless mUSDC.',
    deploymentBlock:s.state.steps['deploy-mockVault'].block,contracts:vaultAddresses,runtimeCodeHashes:await hashes(vaultAddresses),
    baseContracts:{lending:addresses.lending,swap:addresses.swap,execution:addresses.execution,mockUsdc:addresses.mockUsdc},
    asset:addresses.mockUsdc,assetDecimals:6,shareDecimals:6,sourcePolicy:personal.policyId,source}
  await verifyManifests(core,vault)
  writeJson(manifestDir+'/31337.json',core)
  writeJson(manifestDir+'/vault-31337.json',vault)
  console.log('Verified '+Object.keys(s.state.steps).length+' canonical deployment receipts. Browser factory calls use the connected owner.')
} finally {s.close()}

// Exercise the creator wallet flow against a v1.2 local reference deployment.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createPublicClient, createWalletClient, defineChain, getAddress, http, parseEventLogs, zeroHash} from 'viem'
import {studioMarketTemplate, STUDIO_MARKET_ROOT} from '@peridot/circuit-sdk'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [rpcRaw, manifestPath, bpsRaw = '6234', reserveRaw = 'true'] = process.argv.slice(2)
if (!rpcRaw || !manifestPath) throw Error('Usage: node contracts/script/studio-local-demo.mjs <loopback-url> <local-manifest-path> [bps] [true|false]')
const url = new URL(rpcRaw)
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Requires loopback Anvil')
if (!/^\d+$/.test(bpsRaw) || !['true', 'false'].includes(reserveRaw)) throw Error('Invalid Studio options')
const bps = Number(bpsRaw)
const reserve = reserveRaw === 'true'
const {compiled, proof, spec} = studioMarketTemplate(bps, reserve)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.profile !== 'local' || manifest.chainId !== 31337 || manifest.tapeout.mode !== 'development-reference') {
  throw Error('Expected a local development-reference deployment manifest')
}
const chain = defineChain({id:31337, name:'Local Anvil', nativeCurrency:{name:'Test gas',symbol:'TEST',decimals:18},rpcUrls:{default:{http:[url.href]}}})
const rpc = createPublicClient({chain,transport:http(url.href),pollingInterval:100})
if (await rpc.getChainId() !== 31337 || (await rpc.request({method:'anvil_metadata'})).forkedNetwork) throw Error('Expected unforked Anvil 31337')
const user = (await rpc.request({method:'eth_accounts'}))[2]
if (!user) throw Error('Anvil requires three local unlocked accounts; third account is the creator')
const wallet = createWalletClient({account:user, chain, transport:http(url.href,{retryCount:0})})
function contract(name, address) {
  return {address, abi:JSON.parse(readFileSync(resolve(root,`contracts/out/${name}.sol/${name}.json`),'utf8')).abi}
}
const registry = contract('PolicyRegistry', manifest.contracts.PolicyRegistry)
const cpu = contract('DevelopmentReferenceProcessor', manifest.tapeout.processor)
const factory = contract('MarketFactory',manifest.contracts.MarketFactory)
const read = (c, fn, args=[]) => rpc.readContract({...c,functionName:fn,args})
if (getAddress(await read(factory,'registry')) !== getAddress(registry.address) ||
    getAddress(await read(registry,'owner')) === getAddress(user) ||
    await read(registry,'MARKET_TEMPLATE_ROOT') !== STUDIO_MARKET_ROOT ||
    await read(registry,'trustedCodeHash',[cpu.address]) === zeroHash) throw Error('Incompatible CPU, registry, factory or creator account')

const transactions = []
async function send(c, functionName, args) {
  const action = {...c,functionName,args,account:user}
  await rpc.simulateContract(action)
  const estimate = await rpc.estimateContractGas(action)
  const hash = await wallet.writeContract({...action,gas:estimate*13n/10n+25_000n})
  const receipt = await rpc.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') throw Error(`${functionName} reverted: ${hash}`)
  transactions.push({functionName, from:receipt.from, to:receipt.to, hash, block:receipt.blockNumber, blockHash:receipt.blockHash, status:receipt.status, gasUsed:receipt.gasUsed})
  return receipt
}
function event(c, receipt, name) {
  const logs = receipt.logs.filter(l=>getAddress(l.address) === getAddress(c.address))
  return parseEventLogs({abi:c.abi, logs, eventName:name, strict:true})[0]?.args
}
let id = await read(registry,'marketTemplatePolicy',[cpu.address,compiled.configHash])
if (id === zeroHash) {
  const added = await send(cpu,'addReferenceCircuit',[compiled.netlist])
  const circuitId = event(cpu,added,'ReferenceCircuitAdded')?.id
  if (circuitId === undefined) throw Error('Missing circuit receipt')
  await send(registry,'registerMarketTemplate',[cpu.address,circuitId,bps,reserve,compiled.netlistHash,compiled.configHash,proof])
  id = await read(registry,'marketTemplatePolicy',[cpu.address,compiled.configHash])
}
const entry = await read(registry,'getPolicy',[id])
await read(registry,'requirePolicy',[id,0])
if (entry.kind !== 0 || getAddress(entry.processor) !== getAddress(cpu.address) || entry.configHash !== compiled.configHash ||
    entry.netlistHash !== compiled.netlistHash) throw Error('Registered entry does not match selected economics')
const created = await send(factory,'createMarket',[id,7500,8500,1000n*10n**18n,1000n*10n**6n,900n*10n**6n,10n*10n**6n])
const details = event(factory,created,'MarketCreated')
if (!details) throw Error('Missing market creation receipt')
const controller = contract('IsolatedController',details.controller)
if (getAddress(await read(controller,'owner')) !== getAddress(user) || await read(controller,'active') ||
    await read(controller,'policyId') !== id) throw Error('Incorrect market creator, lifecycle or policy')
const evidence = {label:'Unforked local Anvil simulation. DevelopmentReferenceProcessor is a Peridot test fixture.',
  chainId:31337, rpc:rpcRaw, instanceId:(await rpc.request({method:'anvil_metadata'})).instanceId,
  registrar:await read(registry,'owner'), creator:user, registry:registry.address, processor:entry.processor,
  circuitId:entry.circuitId, root:STUDIO_MARKET_ROOT, spec, netlistHash:compiled.netlistHash, configHash:compiled.configHash,
  policyId:id, factory:factory.address, market:details, active:false, transactions}
console.log(JSON.stringify(evidence,(_,v)=>typeof v === 'bigint' ? String(v) : v,2))

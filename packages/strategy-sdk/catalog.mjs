// Regenerate the checked-in JSON Schema and the two curated examples from verified manifests.
// Runtime imports use the resulting static assets, not an RPC or the filesystem.
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const base = new URL('.', import.meta.url)
const load = name => JSON.parse(readFileSync(new URL(name, base), 'utf8'))
const write = (name, data) => {
  const file = new URL(name, base)
  const bytes = JSON.stringify(data, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== bytes) throw Error('Stale artifact: '+fileURLToPath(file))
  } else writeFileSync(file, bytes)
}
const v1 = load('../chain-config/deployments/1952.json')
const v2 = load('../chain-config/expansion/deployments/1952.json')
if (v1.status !== 'deployed' || v1.chainId !== 1952 || v2.chainId !== 1952) throw Error('Expected deployed testnet manifests')
const executionProgram = load('../../contracts/expansion/policy/execution.json')
if (executionProgram.netlistHash !== v2.execution.netlistHash) throw Error('Execution program mismatch')
const account = v1.tapeout.circuits.find(c=>c.kind === 'ACCOUNT')
const common = {schema:'peridot.strategy/v1',chainId:1952}
const debt = {
  ...common, profile:'debt-protection-v1', executionMode:'rule-based',
  deployment:{accountVersion:'v1',sourceCommit:v1.commit,factory:v1.contracts.SentinelAccountFactory,
    adapter:'isolated-controller-v1',target:v1.markets[0].controller},
  allowedOperations:['AUTO_REPAY'], allowedAssets:[{symbol:'mUSD',address:v1.contracts.MockDebt,decimals:6}],
  policy:{kind:'ACCOUNT',schemaVersion:1,templateVersion:0,mode:v1.tapeout.mode,enforcer:v1.contracts.PolicyRegistry,
    processor:v1.tapeout.processor,circuitId:account.circuitId,netlistHash:account.netlistHash,policyId:account.policyId}
}
const swap = {
  ...common, profile:'restricted-swap-v2', executionMode:'external-agent',
  deployment:{accountVersion:'v2',sourceCommit:v2.source.expansionCommit,factory:v2.contracts.factory,
    adapter:'single-pool-swap-v2',target:v2.contracts.swap},
  allowedOperations:['SWAP_EXACT_IN'], allowedAssets:[
    {symbol:'mWOKB',address:v2.contracts.mockWokb,decimals:v2.swap.mockWokbDecimals},
    {symbol:'mUSDC',address:v2.contracts.mockUsdc,decimals:v2.swap.mockUsdcDecimals}],
  policy:{kind:'EXECUTION',schemaVersion:executionProgram.schema,templateVersion:1,mode:v2.execution.mode,enforcer:v2.contracts.execution,
    processor:v2.contracts.cpu,circuitId:v2.execution.circuitId,netlistHash:v2.execution.netlistHash}
}
const raw = maxDigits => ({type:'string',pattern:'^[1-9][0-9]{0,'+(maxDigits-1)+'}$'})
const integer = (minimum,maximum) => ({type:'integer', minimum,maximum})
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties})
const prose = maximum => ({type:'string',minLength:1,maxLength:maximum,pattern:"^[A-Za-z0-9 .,!?()'/%:;-]+$"})
const editable = {name:prose(80),description:prose(320),objective:prose(200),agentInstructions:prose(500),expirySeconds:integer(1,604800)}
const profile = (pins,fields) => object({...Object.fromEntries(Object.entries(pins).map(([key,value])=>[key,{const:value}])),...editable,...fields})
const schema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',title:'Peridot Sentinel strategy template v1',
  description:'1952 public testnet. The SDK additionally enforces bigint budget ceilings and relationships, sensitive-text rejection and duplicate-key rejection.',
  oneOf:[
    profile(debt,{risk:object({triggerLtvBps:integer(1,10000)}),budget:object({cumulativeRaw:raw(7)})}),
    profile(swap,{risk:object({maxSlippageBps:{const:v2.swap.policyMaxLossBps}}),budget:object({perCallRaw:raw(19),cumulativeRaw:raw(19)})})
  ]
}
write('strategy.schema.json',schema)
write('templates/debt-protection-v1.json',{...debt,name:'Debt protection',description:'Repay testnet debt from idle mUSD when the account reaches its trigger.',
  objective:'Reduce debt when the position reaches the chosen loan to value ratio.',agentInstructions:'Simulate repayment before submission. Check the receipt and remaining budget.',
  expirySeconds:86400,risk:{triggerLtvBps:5000},budget:{cumulativeRaw:'2000000'}})
write('templates/restricted-swap-v2.json',{...swap,name:'Restricted agent swap',description:'Allow bounded mWOKB to mUSDC swaps through the inventory funded testnet venue.',
  objective:'Give the operator a limited allowance for one approved trading route.',agentInstructions:'Review the live testnet quote and simulate each swap. Deliver output to the account.',
  expirySeconds:86400,risk:{maxSlippageBps:v2.swap.policyMaxLossBps},budget:{perCallRaw:'500000000000000000',cumulativeRaw:'1000000000000000000'}})

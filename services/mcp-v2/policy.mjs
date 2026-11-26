import { encodeFunctionData, getAddress, keccak256, toHex } from 'viem'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Journal } from '../mcp/journal.mjs'
import { ConnectError, profile as v1 } from '../../packages/sentinel-sdk/index.mjs'

export const owner = getAddress('0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67')
export const operator = getAddress('0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88')
export const maximumInput = 10n ** 18n
export const maxCampaignFeePerTx = 1_000_000_000_000_000n
export const deniedBorrow = 1n
const directory = new URL('../../packages/chain-config/expansion/', import.meta.url)
const bytes32 = /^0x[0-9a-f]{64}$/
export function reject(code, message) { throw new ConnectError(code, message) }
const parse = url => JSON.parse(readFileSync(url, 'utf8'))
export const abi = Object.fromEntries(['SentinelAccountV2','SentinelAccountFactoryV2','SinglePoolSwapAdapter','ExecutionPolicy']
  .map(name=>[name,parse(new URL('abi/'+name+'.json',directory))]))
export function publicManifest(){
  let m
  try{m=parse(new URL('deployments/1952.json',directory))}catch{reject('NOT_DEPLOYED','Verified public v2 manifest unavailable')}
  if(m.chainId!==1952 || m.profile!=='1952' || !/^[0-9a-f]{40}$/.test(m.source?.expansionCommit??'') ||
    m.execution?.mode!=='development-reference' || !bytes32.test(m.execution.netlistHash) ||
    m.swap?.mockWokbDecimals!==18 || m.swap?.mockUsdcDecimals!==6 || m.swap?.policyMaxLossBps!==100 ||
    m.swap?.hardMaxLossBps!==500) reject('MANIFEST_MISMATCH','Unexpected 1952 demo profile')
  for(const name of ['factory','account','lending','swap','execution','cpu','mockWokb','mockUsdc','venue']){
    if(!bytes32.test(m.runtimeCodeHashes?.[name]??'') || !m.contracts?.[name]) reject('MANIFEST_MISMATCH','Missing address or runtime hash')
    m.contracts[name]=getAddress(m.contracts[name])
  }
  return m
}
export function raw(s,limit=(1n<<256n)-1n){
  if(typeof s!=='string' || !/^[1-9][0-9]{0,77}$/.test(s) || BigInt(s)>limit) reject('INVALID_AMOUNT','Expected a positive raw decimal string within the campaign limit')
  return BigInt(s)
}
export function calldata(m,op,args,deadline){
  if(op==='swap')return encodeFunctionData({abi:abi.SentinelAccountV2,functionName:'swapExactIn',args:[
    m.contracts.mockWokb,raw(args.amountInRaw,maximumInput),raw(args.minOutRaw),BigInt(deadline)]})
  if(op==='deniedBorrow')return encodeFunctionData({abi:abi.SentinelAccountV2,functionName:'borrow',args:[deniedBorrow]})
  reject('UNKNOWN_OPERATION','Unsupported campaign operation')
}
export const campaign = m => 'peridot/d20/v1/1952/'+m.contracts.account.toLowerCase()
export const proposalId = body => keccak256(toHex(JSON.stringify(body)))
export const isId = x => typeof x==='string' && bytes32.test(x)
export function store(path,keeper){
  const db = new Journal(path,keeper)
  // The shared journal atomically reserves the D9 keeper nonce. This index also limits
  // each account's entire campaign to one submitted transaction of either approved type.
  db.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_campaign_operation ON proposal(json_extract(body,'$.campaign'),json_extract(body,'$.operation')) WHERE hash IS NOT NULL")
  return db
}
let journal
export function database(){
  journal ??= store(fileURLToPath(new URL('.state/proposals.sqlite',import.meta.url)),
    fileURLToPath(new URL('../keeper/.state/1952/'+v1.factory+'/'+operator+'/operator.sqlite',import.meta.url)))
  return journal
}
export function submitted(db,m,op) {
  return db.db.prepare("SELECT id,hash FROM proposal WHERE hash IS NOT NULL AND json_extract(body,'$.campaign')=? AND json_extract(body,'$.operation')=?").get(campaign(m),op)
}
export function loadProposal(db,m,id,expectedOp){
  if(!isId(id)) reject('INVALID_PROPOSAL','Expected locally issued proposalId')
  const row=db.get(id)
  if(!row) reject('UNKNOWN_PROPOSAL','No such locally issued proposal')
  const body=JSON.parse(row.body)
  if(proposalId(body)!==id || body.campaign!==campaign(m) || body.commit!==m.source.expansionCommit ||
    body.account!==m.contracts.account || body.operator!==operator || body.chainId!==1952 ||
    body.valueWei!=='0' || (expectedOp && body.operation!==expectedOp) ||
    body.calldata!==calldata(m,body.operation,body.args,body.deadline)) reject('PROPOSAL_MISMATCH','Proposal differs from the current fixed campaign')
  return {row,body}
}

import {encodeFunctionData, getAddress, isAddress, keccak256, stringToHex, zeroAddress} from 'viem'
import type {Abi, Address, Hex, PublicClient} from 'viem'
import {DevelopmentReferenceProcessorAbi, IsolatedControllerAbi, PolicyRegistryAbi, SentinelAccountAbi, SentinelAccountFactoryAbi} from '@peridot/chain-config'
import v2Account from '../chain-config/expansion/abi/SentinelAccountV2.json' with {type:'json'}
import v2Factory from '../chain-config/expansion/abi/SentinelAccountFactoryV2.json' with {type:'json'}
import execution from '../chain-config/expansion/abi/ExecutionPolicy.json' with {type:'json'}
import expansion from '../chain-config/expansion/deployments/1952.json' with {type:'json'}
import {importStrategy} from './validate.ts'
import type {Strategy} from './validate.ts'
export {importStrategy, curatedStrategies, type Strategy} from './validate.ts'

type Reader = Pick<PublicClient,'getChainId'|'getBlock'|'getCode'|'readContract'>
export type Selection = {owner:Address;operator:Address;acknowledge?:Hex}
type Calls = {
  setAutoRepayTrigger:[triggerBps:number]
  setOperator:[operator:Address,mask:8,cumulative:bigint,expiry:bigint]
  setGrant:[operator:Address,adapter:Address,op:5,input:Address,perCall:bigint,cumulative:bigint,expiry:bigint]
  revokeOperator:[operator:Address]
  revokeGrant:[operator:Address,adapter:Address,op:5,input:Address]
}
export type OwnerTransaction = {chainId:1952;from:Address;to:Address;value:0n;data:Hex} & {
  [Method in keyof Calls]: {method:Method;args:Calls[Method]}
}[keyof Calls]
const delay = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function read<T>(call:()=>Promise<T>):Promise<T> {
  for(let i=0;;i++){
    try {return await call()} catch(error) {if(i===2) throw error; await delay(200*(i+1))}
  }
}
function check(condition:unknown, message:string): asserts condition {
  if (!condition) throw Error(message)
}
function same(a:unknown,b:string) {return typeof a==='string' && a.toLowerCase()===b.toLowerCase()}

async function plan(client:Reader,input:Strategy,selection:Selection,revoke:boolean) {
  // Revalidate even when a caller mutated a previously reviewed JS object.
  const {template,hash} = importStrategy(JSON.stringify(input))
  const {owner,operator} = selection
  check(isAddress(owner) && isAddress(operator) && !same(owner,zeroAddress) && !same(operator,zeroAddress) && !same(owner,operator),'Select distinct nonzero owner and operator addresses')
  check(await read(()=>client.getChainId())===1952,'Switch to X Layer testnet (1952)')
  const block = await read(()=>client.getBlock({blockTag:'latest'}))
  check(block.number!==null && block.hash!==null,'Expected a mined block')
  const blockNumber = block.number
  const debt = template.profile==='debt-protection-v1'
  const abi:Abi = debt ? SentinelAccountAbi : v2Account as Abi
  const factory = getAddress(template.deployment.factory)
  const target = getAddress(template.deployment.target)
  const asset = getAddress(template.allowedAssets[0].address)
  const policy = template.policy
  const view = (address:Address,contractAbi:Abi,functionName:string,args:readonly unknown[]=[]) =>
    read(()=>client.readContract({address,abi:contractAbi,functionName,args,blockNumber}))
  const code = (address:Address)=>read(()=>client.getCode({address,blockNumber}))
  const accountOf = await view(factory,debt?SentinelAccountFactoryAbi:v2Factory as Abi,'accountOf',debt?[owner,target]:[owner])
  check(typeof accountOf==='string' && isAddress(accountOf) && !same(accountOf,zeroAddress),'Create your own account at this factory before adoption')
  const account = getAddress(accountOf)
  check(!same(account,operator) && !same(account,owner),'Account cannot act as owner or operator')
  const [ownerOf, accountCode] = await Promise.all([view(account,abi,'owner'),code(account)])
  check(same(ownerOf,owner) && accountCode && accountCode!=='0x','Account owner or code mismatch')
  const grantArgs = debt?[operator]:[operator,target,5,asset]
  const grant = await view(account,abi,debt?'operators':'grants',grantArgs) as [number|bigint,bigint,bigint]
  const currentTrigger = debt ? Number(await view(account,abi,'autoRepayTriggerBps')) : null
  const currentGrant = {mask:debt?Number(grant[0]):null,perCallRaw:debt?null:String(grant[0]),remainingRaw:String(grant[1]),expiry:String(grant[2])}
  const transactions:OwnerTransaction[] = []
  const tx = <K extends keyof Calls>(method:K,args:Calls[K])=>{
    const data = encodeFunctionData({abi,functionName:method as string,args:args as readonly unknown[]})
    transactions.push({chainId:1952,from:owner,to:account,value:0n,method,args,data} as OwnerTransaction)
  }
  const warnings:string[]=[]
  let reviewId:Hex|null = null
  let expiry:bigint|null = null
  if (revoke) {
    // Emergency revocation depends on provenance/ownership only, even after a policy outage.
    if (debt) tx('revokeOperator',[operator])
    else tx('revokeGrant',[operator,target,5,asset])
    if(debt) warnings.push('Revocation removes every permission for this operator. The account-wide trigger remains configured.')
  } else {
    if (template.profile==='debt-protection-v1') {
      const registry = getAddress(template.policy.enforcer)
      const [controller,debtAsset,activePolicy,boundRegistry,entry,binding] = await Promise.all([
        view(account,abi,'controller'), view(account,abi,'debtAsset'), view(account,abi,'policyId'),
        view(target,IsolatedControllerAbi,'registry'), view(registry,PolicyRegistryAbi,'getPolicy',[template.policy.policyId]),
        view(registry,PolicyRegistryAbi,'requirePolicy',[template.policy.policyId,1])
      ])
      const p=entry as {chainId:bigint;processor:Address;circuitId:bigint;kind:number;schemaVersion:number;templateVersion:number;netlistHash:Hex}
      const [processor,id]=binding as [Address,bigint]
      check(same(controller,target) && same(debtAsset,asset) && same(boundRegistry,registry) && same(activePolicy,template.policy.policyId)
        && p.chainId===1952n && p.kind===1 && p.schemaVersion===template.policy.schemaVersion && p.templateVersion===template.policy.templateVersion
        && same(p.processor,template.policy.processor) && same(processor,p.processor) && id===p.circuitId && id===BigInt(template.policy.circuitId)
        && same(p.netlistHash,template.policy.netlistHash),'Current lending account, asset or policy differs from template')
      if (currentTrigger!==template.risk.triggerLtvBps)
        warnings.push('Changing the account-wide trigger affects every existing repay operator. V1 cannot enumerate all operators on-chain. Check historical grants before confirming this change.')
    } else {
      const enforcer=getAddress(policy.enforcer)
      const [adapter,adapterCode,enforced,enforcerCode,cpu,id,programHash,token0,token1] = await Promise.all([
        view(account,abi,'swapAdapter'),code(target),view(account,abi,'executionPolicy'),code(enforcer),
        view(enforcer,execution as Abi,'processor'),view(enforcer,execution as Abi,'circuitId'),view(enforcer,execution as Abi,'NETLIST_HASH'),
        view(account,abi,'token0'),view(account,abi,'token1')
      ])
      const output=template.allowedAssets[1].address
      check(same(adapter,target) && adapterCode && keccak256(adapterCode)===expansion.runtimeCodeHashes.swap &&
        same(enforced,enforcer) && enforcerCode && keccak256(enforcerCode)===expansion.runtimeCodeHashes.execution &&
        same(cpu,policy.processor) && id===BigInt(policy.circuitId) && same(programHash,policy.netlistHash) &&
        ((same(token0,asset) && same(token1,output)) || (same(token1,asset) && same(token0,output))),
        'Current swap route or execution policy differs from template')
    }
    const net=await view(getAddress(policy.processor),DevelopmentReferenceProcessorAbi,'netlist',[BigInt(policy.circuitId)]) as Hex
    check(keccak256(net)===policy.netlistHash,'Current processor netlist differs from template')
    if (grant[2]!==0n) warnings.push(debt ? 'setOperator replaces the selected operator’s entire mask, expiry and remaining budget.' :
      'setGrant replaces the selected route’s limits and expiry. A previously spent budget can become available again.')
    expiry=block.timestamp+BigInt(template.expirySeconds)
    if(warnings.length) reviewId=keccak256(stringToHex(JSON.stringify([hash,owner.toLowerCase(),account.toLowerCase(),operator.toLowerCase(),currentTrigger,currentGrant])))
    if(reviewId===null || selection.acknowledge===reviewId){
      if(template.profile==='debt-protection-v1'){
        if(currentTrigger!==template.risk.triggerLtvBps) tx('setAutoRepayTrigger',[template.risk.triggerLtvBps])
        tx('setOperator',[operator,8,BigInt(template.budget.cumulativeRaw),expiry])
      }else tx('setGrant',[operator,target,5,asset,BigInt(template.budget.perCallRaw),BigInt(template.budget.cumulativeRaw),expiry])
    }
  }
  const confirmed=await read(()=>client.getBlock({blockNumber}))
  check(confirmed.hash===block.hash,'Review block changed; rebuild the plan')
  return {templateHash:hash,chainId:1952 as const,owner,operator,account,blockNumber,blockHash:block.hash,expiry,
    currentGrant,currentTrigger,reviewId,warnings,transactions}
}

/** Read on-chain authority and return unsigned, zero-value owner calls for wallet review. */
export const buildAdoptionPlan=(client:Reader,template:Strategy,selection:Selection)=>plan(client,template,selection,false)
/** Remove this operator's v1 grant or this precise v2 route. */
export const buildRevocationPlan=(client:Reader,template:Strategy,selection:Selection)=>plan(client,template,selection,true)

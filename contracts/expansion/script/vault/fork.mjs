// Run the swap fork bootstrap first. All writes in this script target one verified private Anvil.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPublicClient,createWalletClient,encodeDeployData,encodeFunctionData,getAddress,http,
  keccak256,parseAbi,parseEventLogs,toFunctionSelector,toHex} from 'viem'

const bootstrap=JSON.parse(readFileSync('.research/session6-spark-fork-bootstrap.json'))
const upstream='https://rpc.xlayer.tech'
const transport=http('http://127.0.0.1:19635',{retryCount:0,timeout:45_000})
const rpc=createPublicClient({transport,cacheTime:0})
const wallet=createWalletClient({transport})
const info=await rpc.request({method:'anvil_nodeInfo'})
assert.equal(await rpc.getChainId(),31337)
assert.equal(info.forkConfig.forkUrl,upstream)
assert.equal(info.forkConfig.forkBlockNumber,Number(bootstrap.upstream.block))
assert.equal((await rpc.getBlock({blockNumber:BigInt(bootstrap.upstream.block)})).hash,bootstrap.upstream.hash)
const last=bootstrap.receipts.at(-1)
assert.equal((await rpc.getBlock()).hash,last.blockHash,'expected the freshly completed swap fork bootstrap')
assert.equal((await rpc.getTransactionReceipt({hash:last.hash})).status,'success')

const read=(address,abi,functionName,args=[],blockNumber)=>rpc.readContract({address,abi,functionName,args,blockNumber})
const {owner,operator}=bootstrap
const vault='0xf90E63079D97a0A1f479b2b168457F420CAFf6ba'
const asset=bootstrap.ledger.usdc
const evmImplSlot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const tokenAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function decimals() view returns(uint8)'])
const vaultAbi=parseAbi(['function asset() view returns(address)','function getImplementation() view returns(address)',
  'function maxDeposit(address) view returns(uint256)','function previewDeposit(uint256) view returns(uint256)','function totalAssets() view returns(uint256)',
  'event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)',
  'event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)'])
const impl=getAddress(await read(vault,vaultAbi,'getImplementation'))
const slot=await rpc.getStorageAt({address:vault,slot:evmImplSlot})
assert.equal(impl,getAddress('0x'+slot.slice(-40)))
assert.equal(getAddress(await read(vault,vaultAbi,'asset')),getAddress(asset))
assert.equal(await read(vault,tokenAbi,'decimals'),6)
assert.equal(await read(asset,tokenAbi,'decimals'),6)
const receipts=[]
const contracts={}
const artifact=name=>JSON.parse(readFileSync('contracts/expansion/out/'+name+'.sol/'+name+'.json'))
const readBal=(address,who)=>read(address,tokenAbi,'balanceOf',[who])
async function send(label,request,actor=owner,expected='success'){
  const limit=BigInt(bootstrap.upstream.timestamp)+BigInt(bootstrap.receipts.length+receipts.length)+1n
  await rpc.request({method:'evm_setNextBlockTimestamp',params:[toHex(limit)]})
  const hash=await wallet.sendTransaction({account:actor,chain:null,gas:15_000_000n,...request})
  let receipt
  for(let i=0;i<80 && !receipt;i++){
    try {receipt=await rpc.getTransactionReceipt({hash})}catch{await new Promise(r=>setTimeout(r,200))}
  }
  assert(receipt,label+' missing receipt')
  assert.equal(receipt.status,expected,label)
  assert.equal((await rpc.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash)
  receipts.push({label,hash,actor,to:receipt.to,created:receipt.contractAddress,status:receipt.status,block:receipt.blockNumber,blockHash:receipt.blockHash,gas:receipt.gasUsed})
  return receipt
}
const tx=(label,to,abi,functionName,args=[],actor,expected)=>send(label,{to,data:encodeFunctionData({abi,functionName,args})},actor,expected)
async function deploy(name,args){
  const a=artifact(name)
  const r=await send('Deploy '+name,{data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args})})
  const address=getAddress(r.contractAddress)
  contracts[name]={address,runtimeHash:keccak256(await rpc.getCode({address}))}
  return address
}
const adapter=await deploy('SingleVaultAdapter',[vault,asset])
const core=name=>bootstrap.deployed[name].address
const factory=await deploy('VaultSentinelAccountFactoryV2',[core('PeridotLendingAdapter'),core('SinglePoolSwapAdapter'),core('ExecutionPolicy'),adapter])
const factoryAbi=artifact('VaultSentinelAccountFactoryV2').abi
const accountAbi=artifact('VaultSentinelAccountV2').abi
await tx('Create optional vault-enabled account',factory,factoryAbi,'createAccount',[bootstrap.circuits[1].policyId])
const account=await read(factory,factoryAbi,'accountOf',[owner])
contracts.VaultSentinelAccountV2={address:account,runtimeHash:keccak256(await rpc.getCode({address:account}))}
const call=(label,name,args,actor,expected)=>tx(label,account,accountAbi,name,args,actor,expected)
async function state(){
  const [position,accountAssets,operatorAssets,allowance,grant]=await Promise.all([
    read(account,accountAbi,'vaultPosition'),readBal(asset,account),readBal(asset,operator),
    read(asset,tokenAbi,'allowance',[account,vault]),read(account,accountAbi,'grants',[operator,adapter,6,asset])])
  const [shares,claimAssets,liquidShares,liquidAssets]=position
  return {shares,claimAssets,liquidShares,liquidAssets,accountAssets,operatorAssets,allowance,remainingDeposit:grant[1]}
}
const amount=50_000_000n
const deadline=BigInt(bootstrap.upstream.timestamp)+1800n
await tx('Owner moves prior fork swap proceeds into its wallet',bootstrap.account,artifact('SentinelAccountV2').abi,'withdraw',[asset,60_000_000n])
await tx('Fund vault-enabled account from real fork swap proceeds',asset,tokenAbi,'transfer',[account,60_000_000n])
await call('Owner limits allocation to 60 USDC and 0.98 spUSDC per USDC','setVaultDepositLimits',[60_000_000n,980_000_000_000_000_000n])
await call('Grant vault deposit to operator','setGrant',[operator,adapter,6,asset,amount,55_000_000n,deadline])
const before=await state()
const denied=await call('Minimum 51 shares rejects 50 USDC allocation','depositToVault',[amount,51_000_000n,deadline],operator,'reverted')
const trace=await rpc.request({method:'debug_traceTransaction',params:[denied.transactionHash,{tracer:'callTracer'}]})
assert.equal(trace.output,toFunctionSelector('VaultBounds()'))
assert.deepEqual(await state(),before)
const dep=await call('Operator deposits 50 USDC into real Spark spUSDC','depositToVault',[amount,49_000_000n,deadline],operator)
const events=(r,abi,address,name)=>parseEventLogs({abi,logs:r.logs.filter(l=>getAddress(l.address)===getAddress(address)),eventName:name,strict:true})
const minted=events(dep,vaultAbi,vault,'Deposit')[0].args
const afterDeposit=await state()
assert.equal(getAddress(minted.owner),getAddress(account))
assert.equal(getAddress(minted.sender),getAddress(account))
assert.equal(minted.assets,amount)
assert.equal(minted.shares,afterDeposit.shares)
assert.equal(before.accountAssets-afterDeposit.accountAssets,amount)
assert.equal(afterDeposit.remainingDeposit,5_000_000n)
assert.equal(afterDeposit.allowance,0n)
assert.equal(afterDeposit.operatorAssets,before.operatorAssets)
const w=await call('Owner withdraws exact 5 USDC to account','withdrawFromVault',[5_000_000n,5_000_000n,deadline])
const withdrawn=events(w,vaultAbi,vault,'Withdraw')[0].args
const afterWithdraw=await state()
assert.equal(withdrawn.assets,5_000_000n)
assert.equal(afterDeposit.shares-afterWithdraw.shares,withdrawn.shares)
assert.equal(afterWithdraw.accountAssets-afterDeposit.accountAssets,withdrawn.assets)
await call('Owner disables additional deposits','setVaultDepositLimits',[0n,0n])
await call('Owner emergency revokes all operators','revokeAllOperators',[])
const red=await call('Owner redeems remaining Spark shares into account','redeemFromVault',[afterWithdraw.shares,44_000_000n,deadline])
const redeemed=events(red,vaultAbi,vault,'Withdraw')[0].args
const after=await state()
for(const e of [withdrawn,redeemed]){
  for(const who of [e.sender,e.owner,e.receiver])assert.equal(getAddress(who),getAddress(account))
}
assert.equal(after.shares,0n)
assert.equal(after.accountAssets-afterWithdraw.accountAssets,redeemed.assets)
assert.equal(after.allowance,0n)
assert.equal(after.remainingDeposit,0n)
assert.equal(after.operatorAssets,before.operatorAssets)
console.log(JSON.stringify({label:'Private Anvil chain 31337, fork of public X Layer 196. All transaction hashes are local.',upstream:bootstrap.upstream,
  bootstrapSwapReceipt:last,forkInitAccounts:{owner,operator},vault,asset,implementation:impl,implementationSlot:slot,implementationCodeHash:keccak256(await rpc.getCode({address:impl})),contracts,
  bookMarket:bootstrap.market,fundingBootstrapAccount:bootstrap.account,policyId:bootstrap.circuits[1].policyId,before,denialSelector:trace.output,afterDeposit,afterWithdraw,after,
  minted,withdrawn,redeemed,receipts},(_,v)=>typeof v==='bigint'?v.toString():v,2))

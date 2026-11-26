// Versioned, optional 1952 savings profile. Run at the repo root after the base v2 suite.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {relative,resolve} from 'node:path'
import {createPublicClient,encodeDeployData,encodeFunctionData,getAddress,http,keccak256,parseAbi,parseEventLogs} from 'viem'
import {openSession,publicRpc,readJson,retryRead,writeJson} from '../session6-transactions.mjs'

const [mode,...options]=process.argv.slice(2)
const sourceArg=options.find(x=>x.startsWith('--source-commit='))?.slice(16)
const fixture=options.find(x=>x.startsWith('--core-manifest='))?.slice(16)
const preflight=options.includes('--preflight-only')
assert(['testnet','fork'].includes(mode))
assert(options.every(x=>x==='--preflight-only' || /^--source-commit=[0-9a-f]{7,40}$/i.test(x) || (mode==='fork' && x.startsWith('--core-manifest='))))
if(mode==='testnet')assert(sourceArg && !fixture,'Pass --source-commit=<reviewed SHA>')
const live=mode==='testnet'
const corePath=fixture??'packages/chain-config/expansion/deployments/1952.json'
const core=readJson(corePath)
assert.equal(core.chainId,1952)
assert.equal(core.execution.mode,'development-reference')
if(live)assert.equal(core.profile,'1952')
const names={mockVault:'TestnetSavingsVault',vaultAdapter:'SingleVaultAdapter',vaultFactory:'VaultSentinelAccountFactoryV2',vaultAccount:'VaultSentinelAccountV2'}
const root='contracts/expansion'
function getArtifacts(prefix) {
  return Object.fromEntries(Object.entries(names).map(([key,name])=>[key,readJson(prefix+'/out/'+name+'.sol/'+name+'.json')]))
}
const compiled=getArtifacts(root)
const sourceHashes={}
const git=(...args)=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']})
const sha=sourceArg?git('rev-parse','--verify',sourceArg+'^{commit}').toString().trim():null
const inputs=new Set([root+'/foundry.toml',root+'/script/vault/deploy.mjs',root+'/script/session6-transactions.mjs'])
for(const a of Object.values(compiled)){
  for(const [source,meta] of Object.entries(a.metadata.sources)){
    const file=relative(process.cwd(),resolve(root,source))
    assert(file.startsWith('contracts/'))
    assert.equal(keccak256(readFileSync(file)),meta.keccak256,'artifact source mismatch: '+file)
    inputs.add(file)
  }
}
for(const file of [...inputs].sort()) {
  sourceHashes[file]=keccak256(readFileSync(file))
  if(sha)assert.equal(keccak256(git('show',sha+':'+file)),sourceHashes[file],'checkpoint mismatch: '+file)
}
if(sha) {
  mkdirSync('.research',{recursive:true})
  const dir=mkdtempSync(resolve('.research','vault-rebuild-'))
  try {
    const tar=dir+'/source.tar'
    git('archive','--output='+tar,sha,root+'/src',root+'/foundry.toml','contracts/lib')
    execFileSync('tar',['-xf',tar,'-C',dir])
    execFileSync('forge',['build','--offline'],{cwd:dir+'/'+root,stdio:['ignore','pipe','pipe']})
    const replay=getArtifacts(dir+'/'+root)
    for(const key of Object.keys(names)){
      assert.deepEqual(replay[key].abi,compiled[key].abi,key+' ABI mismatch')
      for(const field of ['bytecode','deployedBytecode'])assert.equal(replay[key][field].object,compiled[key][field].object,key+' '+field+' mismatch')
    }
  } finally {rmSync(dir,{recursive:true})}
}
const client=createPublicClient({transport:http(live?publicRpc:'http://127.0.0.1:19637',{retryCount:0}),cacheTime:0})
assert.equal(await retryRead(()=>client.getChainId()),1952)
if(!live)assert.equal((await client.request({method:'anvil_nodeInfo'})).forkConfig.forkUrl,publicRpc)
const anchor=readJson('evidence/testnet/keeper-auto-repay-1952.json')
assert.equal((await retryRead(()=>client.getTransactionReceipt({hash:anchor.txHash}))).blockNumber,BigInt(anchor.block))
const coreKeys=['lending','swap','execution','mockUsdc']
for(const key of coreKeys)await retryRead(async()=>{
  const code=await client.getCode({address:core.contracts[key]})
  assert(code && core.runtimeCodeHashes[key]===keccak256(code),'base manifest runtime mismatch: '+key)
  return true
})
const build={sourceCommit:sha,sourceHashes,creationHashes:Object.fromEntries(Object.entries(compiled).map(([k,a])=>[k,keccak256(a.bytecode.object)]))}
if(preflight){
  console.log('Keyless vault preflight passed. Chain 1952, four base bindings, '+Object.keys(sourceHashes).length+' source hashes, four artifacts.',sha??'uncommitted fork fixture')
  process.exit(0)
}
const s=await openSession({mode,slug:'vault',forkPort:19637})
const addresses={}
const hashes={}
const tokenAbi=parseAbi(['function mint(address,uint256)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)'])
const contractCall=(label,address,abi,fn,args)=>s.send(label,{to:address,data:encodeFunctionData({abi,functionName:fn,args})})
const view=(address,abi,functionName,args=[],blockNumber)=>s.readContract({address,abi,functionName,args,blockNumber})
async function verifyCode(key,address){
  const a=compiled[key]
  const code=await retryRead(()=>client.getCode({address}),v=>v && v!=='0x')
  function normalized(hex) {
    const bytes=Buffer.from(hex.slice(2),'hex')
    for(const refs of Object.values(a.deployedBytecode.immutableReferences??{}))
      for(const {start,length} of refs)bytes.fill(0,start,start+length)
    return bytes
  }
  assert.deepEqual(normalized(code),normalized(a.deployedBytecode.object),key+' runtime mismatch')
  hashes[key]=keccak256(code)
}
async function deploy(key,args){
  const a=compiled[key]
  const r=await s.send('deploy-'+key,{data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args})})
  addresses[key]=getAddress(r.contractAddress)
  await verifyCode(key,addresses[key])
  return r
}
const summaries={}
const receiptData=r=>({hash:r.transactionHash,block:String(r.blockNumber),blockHash:r.blockHash,gasUsed:String(r.gasUsed),status:r.status})
try {
  const {mockUsdc,lending,swap,execution}=core.contracts
  if(s.state.data.build)assert.deepEqual(s.state.data.build.creationHashes,build.creationHashes)
  if(s.state.data.core)assert.deepEqual(s.state.data.core,Object.fromEntries(coreKeys.map(k=>[k,core.contracts[k]])))
  s.state.data.build=build;s.state.data.core=Object.fromEntries(coreKeys.map(k=>[k,core.contracts[k]]));s.save()
  const first=await deploy('mockVault',[mockUsdc])
  await deploy('vaultAdapter',[addresses.mockVault,mockUsdc])
  await deploy('vaultFactory',[lending,swap,execution,addresses.vaultAdapter])
  const {vaultFactory,vaultAdapter,mockVault}=addresses
  const created=await contractCall('create-optional-vault-account',vaultFactory,compiled.vaultFactory.abi,'createAccount',[core.m4.accountPolicy])
  const createdEvent=parseEventLogs({abi:compiled.vaultFactory.abi,eventName:'AccountCreated',logs:created.logs.filter(l=>getAddress(l.address)===vaultFactory)})[0]
  assert.equal(getAddress(createdEvent.args.owner),s.actor)
  const a=getAddress(createdEvent.args.account)
  addresses.vaultAccount=a
  await verifyCode('vaultAccount',a)
  const abi=compiled.vaultAccount.abi
  const at=created.blockNumber
  await retryRead(async()=>{
    assert.equal(getAddress(await view(vaultFactory,compiled.vaultFactory.abi,'accountOf',[s.actor],at)),a)
    for(const [field,address] of Object.entries({owner:s.actor,lendingAdapter:lending,swapAdapter:swap,executionPolicy:execution,vaultAdapter,vault:mockVault,vaultAsset:mockUsdc}))
      assert.equal(getAddress(await view(a,abi,field,[],at)),getAddress(address))
    for(const [field,address] of Object.entries({vault:mockVault,asset:mockUsdc,implementation:mockVault}))
      assert.equal(getAddress(await view(vaultAdapter,compiled.vaultAdapter.abi,field,[],at)),getAddress(address))
    return true
  })
  await contractCall('mint-valueless-mUSDC',mockUsdc,tokenAbi,'mint',[a,12_000_000n])
  await contractCall('set-vault-deposit-limits',a,abi,'setVaultDepositLimits',[20_000_000n,1_000_000_000_000_000_000n])
  async function settle(label,fn,op,inputs,assets,shares) {
    const key='deadline-'+label
    if(!s.state.steps[label]) {
      const block=await retryRead(()=>client.getBlock())
      if(!s.state.data[key] || BigInt(s.state.data[key])<=block.timestamp+120n) {
        s.state.data[key]=String(block.timestamp+3600n);s.save()
      }
    }
    const r=await contractCall(label,a,abi,fn,[...inputs,BigInt(s.state.data[key])])
    const settled=parseEventLogs({abi,logs:r.logs.filter(l=>getAddress(l.address)===a),eventName:'VaultSettled'})[0].args
    assert.equal(getAddress(settled.vault),mockVault);assert.equal(getAddress(settled.operator),s.actor)
    assert.equal(settled.operation,op);assert.equal(settled.shares,shares);assert.equal(settled.assets,assets)
    const e=parseEventLogs({abi:compiled.mockVault.abi,logs:r.logs.filter(l=>getAddress(l.address)===mockVault),eventName:op===6?'Deposit':'Withdraw'})[0].args
    assert.equal(getAddress(e.owner),a);assert.equal(getAddress(e.sender),a);if(op!==6)assert.equal(getAddress(e.receiver),a)
    assert.equal(e.assets,assets);assert.equal(e.shares,shares)
    await retryRead(async()=>{
      assert.equal(await view(mockUsdc,tokenAbi,'allowance',[a,mockVault],r.blockNumber),0n)
      return true
    })
    summaries[label]={...receiptData(r),operation:op,assets:String(assets),shares:String(shares)}
    return r
  }
  await settle('deposit-10-mUSDC','depositToVault',6,[10_000_000n,10_000_000n],10_000_000n,10_000_000n)
  await settle('withdraw-2-mUSDC','withdrawFromVault',8,[2_000_000n,2_000_000n],2_000_000n,2_000_000n)
  const red=await settle('redeem-4-mock-vault-shares','redeemFromVault',7,[4_000_000n,4_000_000n],4_000_000n,4_000_000n)
  const position=await retryRead(()=>view(a,abi,'vaultPosition',[],red.blockNumber),p=>p.length===4 && p.every(v=>v===4_000_000n))
  await retryRead(async()=>{
    assert.equal(await view(mockUsdc,tokenAbi,'balanceOf',[a],red.blockNumber),8_000_000n)
    assert.equal(await view(mockUsdc,tokenAbi,'balanceOf',[mockVault],red.blockNumber),4_000_000n)
    return true
  })
  const path=live?'packages/chain-config/expansion/deployments/vault-1952.json':s.dir+'/manifest.json'
  writeJson(path,{schemaVersion:1,profile:live?'1952':'private-fork-1952',chainId:1952,public:live,uiEnabled:false,
    label:(live?'Public X Layer testnet 1952':'Private Anvil fork of X Layer testnet')+'; inventory-backed mock ERC-4626 savings vault and valueless mUSDC',
    deploymentBlock:String(first.blockNumber),contracts:addresses,runtimeCodeHashes:hashes,baseContracts:s.state.data.core,build,
    asset:mockUsdc,assetDecimals:6,shareDecimals:6,sourcePolicy:core.m4.accountPolicy,journal:s.dir+'/deployer.json',
    demo:{owner:s.actor,receipts:summaries,block:String(red.blockNumber),blockHash:red.blockHash,
      shares:String(position[0]),claimAssets:String(position[1]),liquidShares:String(position[2]),liquidAssets:String(position[3])}})
  console.log('Verified optional vault profile at',path)
}finally{s.close()}

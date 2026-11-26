// Additive development deployment. Works against verified M4 state on 1952 or a private fork of it.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {resolve,dirname,relative} from 'node:path'
import {createPublicClient,createWalletClient,decodeEventLog,encodeDeployData,encodeFunctionData,getAddress,http,keccak256,toHex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {executionCircuit} from '../policy/compile.mjs'

const [mode,...options]=process.argv.slice(2)
const preflight=options.includes('--preflight-only')
const sourceArg=options.find(v=>v.startsWith('--source-commit='))?.slice('--source-commit='.length)
assert(['fork','testnet'].includes(mode) && options.every(arg=>arg==='--preflight-only'||/^--source-commit=[0-9a-f]{7,40}$/i.test(arg)))
if(mode==='testnet') assert(sourceArg,'Pass the source checkpoint using --source-commit=<SHA>')
const live=mode==='testnet'
const id=1952 // V1 policy IDs include the chain ID; preserve it in the isolated rehearsal.
const endpoint=live?'https://testrpc.xlayer.tech':'http://127.0.0.1:19626'
const transport=http(endpoint,{retryCount:0,timeout:15000})
const c=createPublicClient({transport,cacheTime:0})
const w=createWalletClient({transport})
const witness=live?createPublicClient({transport:http('https://xlayertestrpc.okx.com',{retryCount:0,timeout:15000}),cacheTime:0}):c
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n'
const load=path=>JSON.parse(readFileSync(path,'utf8'))
function save(path,data) { mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',json(data));renameSync(path+'.tmp',path) }
async function read(fn,validate=()=>true) {
  let last
  for(let i=0;i<12;i++){
    try { const result=await fn(); if(!validate(result)) throw Error('RPC has not converged'); return result } catch(e){last=e}
    await new Promise(r=>setTimeout(r,Math.min(1000,150*(i+1))))
  }
  throw last
}
assert.equal(await read(()=>c.getChainId()),id)
if(!live) {const node=await c.request({method:'anvil_nodeInfo'});assert.equal(node.forkConfig.forkUrl,'https://testrpc.xlayer.tech')}
const base=load('packages/chain-config/deployments/1952.json')
const m4=load('evidence/testnet/keeper-auto-repay-1952.json')
assert.equal((await read(()=>c.getTransactionReceipt({hash:m4.txHash}))).blockNumber,BigInt(m4.block))
const profile=live?'1952':'session6-fork-'+(await c.request({method:'anvil_metadata'})).instanceId.slice(2,18)
const dir='deployments/expansion/'+profile
mkdirSync(dir,{recursive:true})
const path=dir+'/journal.json'
const artifact=(name,file=name,legacy=false)=>load('contracts/'+(legacy?'':'expansion/')+'out/'+file+'.sol/'+name+'.json')
const types={
  mockWokb:artifact('TestnetToken','TestnetToken',true),mockUsdc:artifact('TestnetToken','TestnetToken',true),
  mockOracle:artifact('TestnetOracle','TestnetOracle',true),cpu:artifact('DevelopmentReferenceProcessor','DevelopmentReferenceProcessor',true),
  source:artifact('TestnetSwapQuoteSource','TestnetInventoryVenue'),venue:artifact('TestnetInventoryVenue'),
  swap:artifact('SinglePoolSwapAdapter'),lending:artifact('PeridotLendingAdapter'),execution:artifact('ExecutionPolicy'),
  factory:artifact('SentinelAccountFactoryV2'),account:artifact('SentinelAccountV2')
}
const artifacts=Object.fromEntries(Object.entries(types).map(([name,a])=>[name,keccak256(a.bytecode.object)]))
// Restrict attestation to deployment inputs so a concurrent UI checkpoint is harmless.
const inputs = new Set(['contracts/expansion/foundry.toml','contracts/expansion/policy/compile.mjs',
  'contracts/expansion/policy/execution.json','contracts/expansion/script/deploy-expansion.mjs',
  'packages/chain-config/deployments/1952.json'])
for (const [name,a] of Object.entries(types)) {
  const legacy=['mockWokb','mockUsdc','mockOracle','cpu'].includes(name)
  for (const [source,info] of Object.entries(a.metadata.sources)) {
    const file=relative(process.cwd(),resolve(legacy?'contracts':'contracts/expansion',source))
    assert(file.startsWith('contracts/'))
    assert.equal(keccak256(readFileSync(file)),info.keccak256,'artifact source mismatch: '+file)
    inputs.add(file)
  }
}
const sourceHashes=Object.fromEntries([...inputs].sort().map(file=>[file,keccak256(readFileSync(file))]))
const head=execFileSync('git',['rev-parse','--verify',(sourceArg??'HEAD')+'^{commit}'],{encoding:'utf8'}).trim()
function matchesHead(file) {
  try {return keccak256(execFileSync('git',['show',head+':'+file],{stdio:['ignore','pipe','ignore']}))===sourceHashes[file]}
  catch {return false}
}
const matchingCommit=Object.keys(sourceHashes).every(matchesHead)?head:null
if(live) assert(matchingCommit,'Public deployment needs the expansion deployment inputs in a Claude checkpoint')
if(preflight) {
  assert.equal(keccak256(executionCircuit.netlist),load('contracts/expansion/policy/execution.json').netlistHash)
  const m4Policy=base.tapeout.circuits.find(p=>p.kind==='ACCOUNT')
  const registry=artifact('PolicyRegistry','PolicyRegistry',true)
  const [cpu,cid]=await read(()=>c.readContract({address:base.contracts.PolicyRegistry,abi:registry.abi,functionName:'requirePolicy',args:[m4Policy.policyId,1]}))
  assert.equal(getAddress(cpu),getAddress(base.tapeout.processor))
  assert.equal(String(cid),m4Policy.circuitId)
  console.log('Keyless v2 preflight passed on chain',id,'commit',matchingCommit,'source hashes',Object.keys(sourceHashes).length,'creation artifacts',Object.keys(artifacts).length)
  process.exit(0)
}
const testnetKey=live?(process.env.PERIDOT_TESTNET_KEY??'').trim().replace(/^0x/i,''):''
if(live && !/^[a-f0-9]{64}$/i.test(testnetKey)) throw Error('Dedicated 1952 deployer environment required')
const account=live?privateKeyToAccount('0x'+testnetKey):
  privateKeyToAccount(keccak256(toHex('Peridot public fork fixture - never use for public transactions')))
if(live) assert.equal(account.address.toLowerCase(),'0x8c1741a53d5fb97d74c1d105b0fbfbb4740d5d67')
if(!live && !existsSync(path)) await c.request({method:'anvil_setBalance',params:[account.address,'0xde0b6b3a7640000']})
const state=existsSync(path)?load(path):{chainId:id,sender:account.address,artifacts,steps:{}}
assert.equal(state.sender,account.address)
assert.deepEqual(state.artifacts,artifacts,'rebuild matches the journal')
const chain={id,name:profile,nativeCurrency:{name:'OKB',symbol:'OKB',decimals:18},rpcUrls:{default:{http:[endpoint]}}}
const addresses={}
async function receipt(hash) {
  return read(async()=>{
    const r=await c.getTransactionReceipt({hash})
    assert.equal((await c.getBlock({blockNumber:r.blockNumber})).hash,r.blockHash)
    assert((await c.getBlockNumber())>=r.blockNumber+(live?2n:0n))
    return r
  })
}
async function transact(label,to,data) {
  const prior=state.steps[label]
  if(prior) {
    assert.equal(prior.dataHash,keccak256(data))
    assert.equal(prior.to,to??null)
  } else {
    const last=Object.values(state.steps).at(-1)
    const nonce=await read(async()=>{
      const [pending,confirmed,second]=await Promise.all([
        c.getTransactionCount({address:account.address,blockTag:'pending'}),
        c.getTransactionCount({address:account.address}),witness.getTransactionCount({address:account.address})])
      assert(pending===confirmed && pending===second,'deployer nonce is busy or RPCs disagree')
      return pending
    },n=>!last || n>last.nonce)
    const gas=await read(()=>c.estimateGas({account:account.address,to,data,value:0n}))
    const prepared=await read(()=>w.prepareTransactionRequest({account,chain,to,data,value:0n,nonce,gas:gas+(gas+2n)/3n+30_000n}))
    const signed=await account.signTransaction(prepared)
    const hash=keccak256(signed)
    state.steps[label]={hash,nonce,to:to??null,dataHash:keccak256(data)}
    save(path,state) // Record the deterministic hash before the ONE network submission.
    try { assert.equal(await w.sendRawTransaction({serializedTransaction:signed}),hash) }
    catch { console.error('Submission response unavailable; reconciling recorded hash',hash) }
  }
  const item=state.steps[label]
  const r=await receipt(item.hash)
  assert.equal(r.status,'success',label+' reverted')
  assert.equal(r.from.toLowerCase(),account.address.toLowerCase())
  assert.equal(r.to?.toLowerCase()??null,to?.toLowerCase()??null)
  item.block=String(r.blockNumber);item.blockHash=r.blockHash;item.gas=String(r.gasUsed)
  save(path,state)
  console.log(label,r.transactionHash,r.blockNumber.toString())
  return r
}
async function verifyCode(address,a) {
  const code=await read(()=>c.getCode({address}),x=>x && x!=='0x')
  const normalize=x=>{
    const b=Buffer.from(x.slice(2),'hex')
    for(const refs of Object.values(a.deployedBytecode.immutableReferences??{})) {
      for(const {start,length} of refs)b.fill(0,start,start+length)
    }
    return b
  }
  assert.deepEqual(normalize(code),normalize(a.deployedBytecode.object))
  return keccak256(code)
}
async function deploy(key,args=[]) {
  const a=types[key]
  const data=encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args})
  const r=await transact('deploy-'+key,undefined,data)
  addresses[key]=r.contractAddress
  await verifyCode(addresses[key],a)
}
function action(label,key,fn,args) {
  return transact(label,addresses[key],encodeFunctionData({abi:types[key].abi,functionName:fn,args}))
}
function view(key,fn,args=[],blockNumber) {
  return c.readContract({address:addresses[key],abi:types[key].abi,functionName:fn,args,blockNumber})
}
const lock=path+'.lock'
const fd=openSync(lock,'wx')
try {
  const wad=10n**18n
  await deploy('mockWokb',['Testnet Mock WOKB','mWOKB',18])
  await deploy('mockUsdc',['Testnet Mock USDC','mUSDC',6])
  await deploy('mockOracle')
  await action('price-mWOKB','mockOracle','setPrice',[addresses.mockWokb,80n*wad])
  await action('price-mUSDC','mockOracle','setPrice',[addresses.mockUsdc,wad])
  await deploy('cpu')
  const program=await action('reference-program','cpu','addReferenceCircuit',[executionCircuit.netlist])
  const event=program.logs.map(log=>{try{return decodeEventLog({...log,abi:types.cpu.abi})}catch{return null}}).find(e=>e?.eventName==='ReferenceCircuitAdded')
  assert.equal(event.args.netlistHash,executionCircuit.netlistHash)
  const circuitId=event.args.id
  await deploy('execution',[addresses.cpu,circuitId])
  await deploy('source',[addresses.mockOracle])
  await deploy('venue',[addresses.mockWokb,addresses.mockUsdc,80n*wad,wad])
  await action('inventory-mWOKB','mockWokb','mint',[addresses.venue,100n*wad])
  await action('inventory-mUSDC','mockUsdc','mint',[addresses.venue,8000n*10n**6n])
  await deploy('swap',[addresses.venue,addresses.venue,addresses.mockWokb,addresses.mockUsdc,addresses.source,86400n,500])
  await deploy('lending',[base.contracts.MarketFactory,base.markets[0].controller])
  await deploy('factory',[addresses.lending,addresses.swap,addresses.execution])
  const accountPolicy=base.tapeout.circuits.find(p=>p.kind==='ACCOUNT').policyId
  const created=await action('create-account','factory','createAccount',[accountPolicy])
  addresses.account=await read(()=>view('factory','accountOf',[account.address],created.blockNumber),a=>BigInt(a)!==0n)
  await action('fund-account','mockWokb','mint',[addresses.account,2n*wad])
  if(!state.steps['swap-exact-input']) {
    const fundingBlock=BigInt(state.steps['fund-account'].block)
    const head=await read(()=>c.getBlock(),b=>b.number>=fundingBlock)
    for(const [asset,price] of [['mockWokb',80n*wad],['mockUsdc',wad]]) {
      const [observed,updated]=await read(()=>view('mockOracle','quotes',[addresses[asset]],head.number),v=>v[0]>0n)
      if(observed!==price || head.timestamp>=updated+86400n-120n) {
        // Old observation timestamp uniquely identifies this refresh across restarts.
        await action('refresh-'+asset+'-'+updated,'mockOracle','setPrice',[addresses[asset],price])
      }
    }
    if(!state.deadline || BigInt(state.deadline)<=head.timestamp+120n) {
      state.deadline=String(head.timestamp+3600n)
      delete state.denial
      save(path,state)
    }
  }
  const args=[addresses.mockWokb,wad,79_200_000n,BigInt(state.deadline)]
  if(!state.denial) {
    const evidenceFloor=Object.values(state.steps).reduce((max,s)=>s.block && BigInt(s.block)>max ? BigInt(s.block) : max,0n)
    const head=await read(()=>c.getBlock(),block=>block.number>=evidenceFloor)
    const denied=encodeFunctionData({abi:types.account.abi,functionName:'swapExactIn',args:[args[0],wad,79_192_000n,args[3]]})
    const selector=keccak256(toHex('ExecutionPolicyDenied()')).slice(0,10)
    await read(async()=>{
      try {await c.call({account:account.address,to:addresses.account,data:denied,blockNumber:head.number})}
      catch(e){if(e.walk?.(x=>x.data===selector || x.data?.data===selector) || e.message.includes(selector))return true;throw e}
      throw Error('Expected execution-policy denial')
    })
    state.denial={method:'eth_call',block:String(head.number),blockHash:head.hash,lossBps:101,revertSelector:selector}
    save(path,state)
  }
  const swap=await action('swap-exact-input','account','swapExactIn',args)
  const logs=swap.logs.filter(l=>getAddress(l.address)===getAddress(addresses.account))
  const {args:settled}=logs.map(l=>decodeEventLog({...l,abi:types.account.abi})).find(e=>e.eventName==='SwapSettled')
  assert.equal(settled.amountIn,wad);assert.equal(settled.amountOut,79_960_000n)
  await read(async()=>{
    const height=swap.blockNumber
    assert.equal(await view('mockUsdc','balanceOf',[addresses.account],height),settled.amountOut)
    assert.equal(await view('mockWokb','balanceOf',[addresses.account],height),wad)
    assert.equal(await view('mockWokb','allowance',[addresses.account,addresses.swap],height),0n)
    assert.equal(await view('mockWokb','allowance',[addresses.swap,addresses.venue],height),0n)
    assert.equal(getAddress(await view('account','owner',[],height)),account.address)
    assert.equal(getAddress(await view('swap','pool',[],height)),getAddress(addresses.venue))
    return true
  })
  const codeHashes={}
  for(const [key,address] of Object.entries(addresses))codeHashes[key]=await verifyCode(address,types[key])
  const manifest={schemaVersion:2,profile,chainId:id,label:live?'Public testnet with inventory-funded mock swap venue and development reference processor':'Local Anvil fork of public testnet with inventory-funded mock venue and development reference processor',
    uiEnabled:false,source:{baseSourceCommit:base.commit,expansionCommit:matchingCommit,sourceHashes,creationHashes:artifacts},contracts:addresses,runtimeCodeHashes:codeHashes,
    m4:{controller:base.markets[0].controller,accountPolicy},execution:{mode:'development-reference',circuitId:String(circuitId),netlistHash:executionCircuit.netlistHash},
    swap:{feePpm:500,hardMaxLossBps:500,policyMaxLossBps:100,mockWokbDecimals:18,mockUsdcDecimals:6,receipt:swap.transactionHash,block:String(swap.blockNumber),amountIn:String(settled.amountIn),amountOut:String(settled.amountOut),denial:state.denial},journal:dir+'/journal.json'}
  const target=live?'packages/chain-config/expansion/deployments/1952.json':dir+'/manifest.json'
  save(target,manifest)
} finally {closeSync(fd);unlinkSync(lock)}

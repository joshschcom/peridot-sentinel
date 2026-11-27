// A wallet is created only by withFork(), after the upstream fork and loopback checks.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {checkedPath,configPath,forkReader,forkUrl,loadData,publicationFork,publicUrl,saveData} from './publication-io.mjs'
import {formatEther,getAddress,encodeFunctionData,keccak256,size,toHex,zeroHash} from 'viem'
import {abi as sponsor,mainnet,packet,stringify,verifyBindings,verifyCalls} from '../../../../evidence/session6-d8b/checks.mjs'
import {receiptEvent} from '../../../../docs/coordination/D8b-postpublish.mjs'
import {artifact,cpu,inputMode,loggedEvent,programs,withFork} from './fork.mjs'
import {financialChecks} from './settlement.mjs'

const {values}=parseArgs({options:{published:{type:'boolean'},rehearse:{type:'boolean'},fork:{type:'boolean'},config:{type:'string'},out:{type:'string'}}})
assert(Boolean(values.published)!==Boolean(values.rehearse),'Choose --published or --rehearse')
assert(!values.fork || (values.published && values.config && values.out),'Fork publication requires --published, --config and --out')
const input=values.config ?? configPath
if(values.fork)checkedPath(input)
const config=loadData(input,{canonical:!values.fork})
const output=values.out
checkedPath(output)
assert.notEqual(input,output)
assert.notEqual(config.evidence,output,'Use a distinct financial proof output')
const origin=values.fork?await publicationFork():null
const pin=inputMode(values.published?'--published':'--rehearse',config,origin)
const upstream=origin?forkReader:mainnet
const upstreamUrl=origin?forkUrl:publicUrl
execFileSync('forge',['build','--root','contracts','--offline','script/DemoRateModel.sol','src/markets/MarketFactory.sol','src/mocks/TestnetOracle.sol','src/mocks/TestnetToken.sol','src/policies/DevelopmentReferenceProcessor.sol','src/policies/TapeOutPolicyAdapter.sol'],{stdio:'inherit'})
execFileSync('forge',['build','--root','contracts/expansion','--offline','src/native7/NativeFinancialPolicy.sol','src/account/SentinelAccountFactoryV2.sol','src/swap/TestnetInventoryVenue.sol'],{stdio:'inherit'})

const bindings=await verifyBindings(origin?BigInt(origin.originBlock):pin.number)
const calls=verifyCalls(packet.proposedMainnetCalls)
const rpcAbi=packet.readOnlyAbi
await withFork(pin,async ctx=>{
  const {node,source,owner,receipts,contracts,call,send,deploy,read}=ctx
  const d={chainId:31337,label:origin?'FORK: fabricated IDs verified via the post-publication pipeline on a private fork of 196':pin.published?'FORK of 196 using finalized public publication':'FORK of 196, circuits fabricated locally on real CPU 410',
    ...(origin?{origin}:{}),upstream:{rpc:upstreamUrl,chainId:origin?31337:196,block:pin.number,hash:source.hash,timestamp:source.timestamp},
    publicCircuitIds:pin.published && !origin?config.circuits.map(c=>c.publishedId):null,bindings,contracts,receipts,programs:[]}
  const programIds=[]
  let publisher,previousReceipt
  if(pin.published && !origin)assert((await upstream.getBlock({blockTag:'finalized'})).number>=pin.number,'Publication block is not finalized')
  if(!pin.published)await send('FORK mint 209 NAND components',{to:calls[0].to,data:calls[0].data,value:BigInt(calls[0].value)})
  for(const [i,c] of config.circuits.entries()){
    const tx=calls[i+1]
    const receipt=pin.published ? await upstream.getTransactionReceipt({hash:c.publicReceipt}) :
      await send('FORK fabricate '+c.kind,{to:tx.to,data:tx.data,value:BigInt(tx.value)})
    assert.equal(receipt.status,'success')
    assert.equal(getAddress(receipt.to),cpu)
    const id=receiptEvent(receipt,receipt.from,c.gates)
    if(publisher)assert.equal(getAddress(receipt.from),publisher)
    publisher=getAddress(receipt.from)
    if(previousReceipt)assert(receipt.blockNumber>previousReceipt.blockNumber ||
      (receipt.blockNumber===previousReceipt.blockNumber && receipt.transactionIndex>previousReceipt.transactionIndex))
    previousReceipt=receipt
    if(pin.published){
      assert.equal(id,BigInt(c.publishedId))
      assert(receipt.blockNumber<=pin.number)
      if(i===2)assert.equal(receipt.blockNumber,pin.number)
      assert.equal(receipt.blockHash,(await upstream.getBlock({blockNumber:receipt.blockNumber})).hash)
      const publishedTx=await upstream.getTransaction({hash:c.publicReceipt})
      assert.equal(publishedTx.input,tx.data)
      assert.equal(publishedTx.value,BigInt(tx.value))
      assert.equal(publishedTx.chainId,origin?31337:196)
    }
    programIds.push(id)
    const netlist=await read(cpu,rpcAbi,'netlist',[id])
    const dims=await read(cpu,rpcAbi,'circuitInfo',[id])
    assert.equal(netlist,programs[i].netlist)
    assert.equal(keccak256(netlist),c.netlistHash)
    assert.deepEqual(dims,[20,1,0,c.gates])
    d.programs.push({kind:c.kind,schema:c.schema,id,netlistHash:c.netlistHash,dimensions:dims,publication:pin.published && !origin?'public-196':'fork-only',
      fabricationHash:receipt.transactionHash,publisher})
  }
  const witness=await deploy('Witness','NativeCircuitWitness',programIds,true)
  const dev=await deploy('Parity control only','DevelopmentReferenceProcessor')
  const registry=await deploy('Registry','PolicyRegistry',[owner])
  const basePolicy=await deploy('Lending policy adapter','TapeOutPolicyAdapter',[registry.address])
  await call('Register only native CPU as trusted',registry,'setProcessorTrust',[cpu,true])
  assert.equal(await read(registry.address,registry.abi,'trustedCodeHash',[dev.address]),zeroHash)
  for(const [i,p] of d.programs.entries()){
    const ref=await call('Add parity control '+p.kind,dev,'addReferenceCircuit',[programs[i].netlist])
    p.devId=loggedEvent(ref,dev.abi,dev.address,'ReferenceCircuitAdded').id
    const evals=await Promise.all(packet.evaluations[i].vectors.map(async v=>{
      const args=[p.id,v.inputs],data=encodeFunctionData({abi:rpcAbi,functionName:'eval',args})
      const [observed,control,witnessResult,estimate]=await Promise.all([read(cpu,rpcAbi,'eval',args),read(dev.address,dev.abi,'eval',[p.devId,v.inputs]),
        read(witness.address,witness.abi,'evaluate',[i,v.inputs]),node.estimateGas({to:cpu,data,account:owner})])
      assert.equal(observed,control)
      assert.equal(observed,v.output)
      assert.equal(witnessResult,observed==='0x01')
      return {inputs:v.inputs,native:observed,dev:control,gasEstimate:estimate}
    }))
    p.vectors=evals
    if(i===2)continue
    const registered=await call('Register native '+p.kind,registry,'register',[cpu,p.id,i,p.netlistHash,programs[i].configHash,zeroHash])
    p.policyId=loggedEvent(registered,registry.abi,registry.address,'PolicyRegistered').policyId
    const entry=await read(registry.address,registry.abi,'getPolicy',[p.policyId])
    assert.equal(getAddress(entry.processor),cpu)
    assert.equal(entry.circuitId,p.id)
    assert.equal(entry.processorCodeHash,bindings.codeHashes[cpu])
    assert.equal(entry.netlistHash,p.netlistHash)
    assert.equal(entry.gateCount,p.dimensions[3])
    assert.equal(entry.schemaVersion,1)
    assert.equal(entry.templateVersion,0)
    assert.equal(entry.configHash,programs[i].configHash)
  }
  const execution=await deploy('Execution policy adapter','ExecutionPolicy',[cpu,programIds[2]],true)
  const guard=await deploy('Native financial policy','NativeFinancialPolicy',[witness.address,basePolicy.address,execution.address,d.programs[0].policyId,d.programs[1].policyId],true)
  await financialChecks(ctx,{d,guard,registry,witness,dev})
  // This test allows a malformed response at the same proxy/implementation code hashes.
  // The Foundry VM forks our local node; it never broadcasts and cannot reach a public wallet.
  execFileSync('forge',['script','--offline','test/native7/NativeResponseProof.sol:NativeResponseProof',
    '--evm-version','cancun','--out','../../.research/session7-native-return-test/out','--cache-path','../../.research/session7-native-return-test/cache',
    '--fork-url','http://127.0.0.1:19710','--no-storage-caching'],{
    cwd:'contracts/expansion',env:{...process.env,NATIVE7_FORK_ACCOUNT:d.wiring.account},stdio:'inherit'})
  d.responseTest={label:'Foundry simulation on the completed private fork, no transaction',
    faults:['reverted eval','one raw return byte','nonbinary decision 2','trailing ABI word'],paths:['v2 borrow','direct book borrow','v2 swap'],passed:12}

  // An ordinary CREATE needs no recipient prediction. Read calls after mining target receipt.contractAddress.
  const gas=witness.receipt.gasUsed+((witness.receipt.gasUsed+3n)/4n)+30000n
  const maxFeePerGas=50_000_000n
  const publicRead=(functionName,args)=>upstream.readContract({address:packet.bindings.gasOracle,abi:sponsor,functionName,args,blockNumber:pin.number})
  const [l1,operatorFee]=await Promise.all([publicRead('getL1FeeUpperBound',[BigInt(size(witness.init)+300)]),publicRead('getOperatorFee',[gas])])
  const maximum=gas*maxFeePerGas+l1+operatorFee
  const views=config.circuits.map((c,i)=>({kind:c.kind,schema:c.schema,inputs:d.programs[i].vectors[1].inputs,
    calldata:encodeFunctionData({abi:witness.abi,functionName:'evaluate',args:[i,d.programs[i].vectors[1].inputs]}),output:d.programs[i].vectors[1].native}))
  assert.equal(await node.getBalance({address:witness.address}),0n)
  d.witnessProposal={status:pin.published && !origin?'Unsigned proposal; founder authorization required':'FORK illustration with provisional IDs; rerun --published before requesting authorization',
    transaction:{chainId:196,type:'0x2',to:null,value:'0x0',data:witness.init,gas:toHex(gas),maxFeePerGas:toHex(maxFeePerGas),maxPriorityFeePerGas:'0x1',accessList:[]},
    creationDataHash:keccak256(witness.init),constructorIds:programIds,observedGas:witness.receipt.gasUsed,feeObservationBlock:pin.number,baseFeeWei:source.baseFeePerGas,
    l1UpperWei:l1,operatorUpperWei:operatorFee,totalUpperWei:maximum,totalUpperOKB:formatEther(maximum),verificationCalls:views,
    nonce:'Sender selects next unused nonce. Each verification is an eth_call to the resulting CREATE receipt address.'}
  saveData(output,d)
  console.log(output)
},upstream,upstreamUrl)

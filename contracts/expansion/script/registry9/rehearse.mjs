// From the repo root: node contracts/expansion/script/registry9/rehearse.mjs --out-dir evidence/session9-registry/<fresh-run>
import assert from 'node:assert/strict'
import {appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {resolve, join} from 'node:path'
import {parseArgs} from 'node:util'
import {getAddress, keccak256, size, stringToHex} from 'viem'
import {curatedStrategies} from '../../../../packages/strategy-sdk/index.ts'
import {buildStrategyPublication, discoverPublishedStrategies, readPublishedStrategy} from '../../../../packages/strategy-sdk/registry.ts'
import {selectFork, withPrivateNode} from './private-nodes.mjs'
import {adopt} from './adoption.mjs'

const {values} = parseArgs({options:{'out-dir':{type:'string'},'fork-block':{type:'string'},'fork-hash':{type:'string'},'export-abi':{type:'boolean'}}})
const stringify = (v,space=2) => JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,space)
const artifactFile = 'contracts/expansion/out/StrategyRegistry.sol/StrategyRegistry.json'
const exportedAbi = 'packages/chain-config/expansion/abi/StrategyRegistry.json'
const artifact = JSON.parse(readFileSync(artifactFile,'utf8'))
const prettyAbi = stringify(artifact.abi) + '\n'
if (values['export-abi']) {
  assert.equal(Object.keys(values).length,1)
  writeFileSync(exportedAbi,prettyAbi)
  console.log(exportedAbi)
  process.exit(0)
}
assert.equal(readFileSync(exportedAbi,'utf8'),prettyAbi,'Generated registry ABI differs from the Foundry artifact')
const output = values['out-dir']
assert(/^evidence\/session9-registry\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(output??''),'Choose a fresh child of evidence/session9-registry with --out-dir')
const parent = resolve('evidence/session9-registry')
assert.equal(realpathSync(parent),parent,'Evidence directory must be real')
assert(!existsSync(output),'Choose a fresh output directory; prior results are immutable')
mkdirSync(output)
const save = (name,v) => writeFileSync(join(output,name),stringify(v)+'\n',{flag:'wx'})
const jsonl = join(output,'receipts.ndjson')
const log = r => appendFileSync(jsonl,stringify(r,0)+'\n')
if (values['fork-block'] || values['fork-hash']) {
  assert(/^\d+$/.test(values['fork-block']??'') && /^0x[\da-f]{64}$/i.test(values['fork-hash']??''),'Supply both --fork-block and --fork-hash')
}
const origin = await selectFork(values['fork-block'] ? BigInt(values['fork-block']) : undefined, values['fork-hash'])
save('origin.json',origin)
const creation = artifact.bytecode.object
const expectedRuntime = artifact.deployedBytecode.object
const templates = curatedStrategies()
for(const fork of [null,origin]) {
  const evidence = await withPrivateNode(fork, async ctx => {
    const {chainId,node,identities,confirm,send} = ctx
    const mode = fork?'PRIVATE_FORK_1952':'LOCAL_31337'
    const receipts = []
    const record = async (...args) => {
      const receipt=await send(...args)
      receipts.push(receipt)
      log({mode,...receipt})
      console.log(mode,receipt.label,receipt.hash)
      return receipt
    }
    const {creator} = identities
    const deployed = await record('Deploy StrategyRegistry',creator,{data:creation})
    await confirm()
    const address = getAddress(deployed.created)
    const runtime = await node.getCode({address,blockNumber:deployed.block})
    assert.equal(runtime,expectedRuntime,'Deployed registry differs from compiled runtime')
    const pin = {chainId, address, runtimeCodeHash:keccak256(runtime),deploymentBlock:deployed.block,confirmations:1}
    const publications = [], verified = []
    for (const {template,hash,canonical} of templates) {
      const seriesId=keccak256(stringToHex('peridot:s9:' + template.profile))
      const key={creator,seriesId,version:1}
      const plan=await buildStrategyPublication(node,pin,{creator,seriesId,expectedVersion:1,json:canonical})
      assert.equal(plan.value,0n)
      assert.equal(plan.chainId,chainId)
      assert.equal(plan.from,creator)
      assert.equal(plan.to,address)
      assert.equal(plan.contentHash,hash)
      const receipt=await record('Publish '+template.profile,creator,{to:address,data:plan.data})
      await confirm()
      const loaded=await readPublishedStrategy(node,pin,key,{blockNumber:receipt.block})
      const page=await discoverPublishedStrategies(node,pin,{fromBlock:pin.deploymentBlock,toBlock:receipt.block,...plan.topics})
      assert.equal(page.rejected.length,0)
      assert.equal(page.accepted.length,1)
      assert.equal(page.accepted[0].transactionHash,receipt.hash)
      assert.equal(loaded.hash,hash)
      assert.equal(page.accepted[0].canonical,canonical)
      assert.deepEqual(loaded.template,template)
      publications.push({profile:template.profile,...key,topics:plan.topics,contentHash:hash,canonicalJsonBytes:Buffer.byteLength(canonical),
        publishCalldataBytes:size(plan.data),gasUsed:receipt.gasUsed,feeWei:receipt.feeWei,hash:receipt.hash,
        readBlock:loaded.blockNumber,readBlockHash:loaded.blockHash,filterMatches:page.accepted.length,filterRejected:page.rejected.length})
      verified.push(loaded)
    }
    const adoptions=[]
    if (fork) {
      const accountPolicy=templates.find(t=>t.template.profile==='debt-protection-v1').template.policy.policyId
      for (const publication of verified) adoptions.push(await adopt({...ctx,record},publication,accountPolicy))
    }
    return {schemaVersion:1,mode,chainId,publicDeployment:'NOT DEPLOYED',origin:fork,
      fixture:'Distinct deterministic addresses on private Anvil, no private key required.',
      identities,pin,creationBytes:size(creation),creationCodeHash:keccak256(creation),runtimeBytes:size(runtime),
      deploymentHash:deployed.hash,deploymentGasUsed:deployed.gasUsed,publications,adoptions,
      receiptCount:receipts.length,totalGas:receipts.reduce((total,r)=>total+r.gasUsed,0n),
      totalFeeWei:receipts.reduce((total,r)=>total+r.feeWei,0n),receipts}
  })
  save(fork?'fork-1952.json':'local-31337.json',evidence)
}

// Run from the repository root. Build clean, self-contained archives under .research.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createPublicClient, http, keccak256 } from 'viem'

const basePin = '81fb45770d3bc36ae9006fbd60e72a5475c3ded4'
const vaultPin = 'a48f203a802f15d34502f56e2ec0c0a2b74d1434'
const block = 47249530n
const limit = 24576
const initLimit = 49152
const baseManifest = JSON.parse(readFileSync('packages/chain-config/expansion/deployments/1952.json'))
const vaultManifest = JSON.parse(readFileSync('packages/chain-config/expansion/deployments/vault-1952.json'))
const paths = {
  SentinelAccountFactoryV2: 'src/account/SentinelAccountFactoryV2.sol',
  VaultSentinelAccountFactoryV2: 'src/vault/VaultSentinelAccountFactoryV2.sol',
  SplitVaultFactory: 'src/size7/SplitVaultFactory.sol',
}
mkdirSync('.research', { recursive: true })
const temporary = mkdtempSync(resolve('.research/session7-size-build-'))
function archive(pin, label) {
  const root = join(temporary, label)
  mkdirSync(root)
  const tar = execFileSync('git', ['archive', pin, 'contracts/expansion', 'contracts/lib/openzeppelin'], { maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', root], { input: tar })
  return join(root, 'contracts/expansion')
}
function build(root, files, flags = []) {
  execFileSync('forge', ['build', '--root', root, '--offline', ...flags, ...files], { stdio: ['ignore', 2, 2] })
}
function artifact(root, name, out = 'out') {
  return JSON.parse(readFileSync(join(root, out, name + '.sol', name + '.json')))
}
function totals(a) {
  const size = bytes => (bytes.length - 2) / 2
  const ctor = a.abi.find(x => x.type === 'constructor')
  assert(ctor.inputs.every(i => i.type === 'address' || i.type === 'bytes32'))
  const args = ctor.inputs.length * 32
  const creationBytes = size(a.bytecode.object)
  const runtimeBytes = size(a.deployedBytecode.object)
  return {runtimeBytes, runtimeHeadroom: limit - runtimeBytes, creationBytes, constructorArgumentBytes: args,
    initcodeBytes: creationBytes + args, initcodeHeadroom: initLimit - creationBytes - args, creationHash: keccak256(a.bytecode.object)}
}
function masked(code, artifact) {
  const buf = Buffer.from(code.slice(2), 'hex')
  for (const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) {
    for (const ref of refs) buf.fill(0, ref.start, ref.start + ref.length)
  }
  return buf
}
async function attest(artifacts) {
  const endpoints = ['https://testrpc.xlayer.tech', 'https://xlayertestrpc.okx.com']
  return Promise.all(endpoints.map(async rpc => {
    const client = createPublicClient({ transport: http(rpc, { retryCount: 3, timeout: 18000 }), cacheTime: 0 })
    assert.equal(await client.getChainId(), 1952)
    const observed = await client.getBlock({ blockNumber: block })
    assert.equal(observed.hash, vaultManifest.demo.blockHash)
    const codes = {}
    const items = [
      [baseManifest, 'factory', 'SentinelAccountFactoryV2'],
      [baseManifest, 'account', 'SentinelAccountV2'],
      [vaultManifest, 'vaultFactory', 'VaultSentinelAccountFactoryV2'],
      [vaultManifest, 'vaultAccount', 'VaultSentinelAccountV2'],
    ]
    for (const [manifest, key, name] of items) {
      const address = manifest.contracts[key]
      const code = await client.getCode({ address, blockNumber: block })
      assert.equal(keccak256(code), manifest.runtimeCodeHashes[key])
      const a = artifacts[name]
      assert.deepEqual(masked(code, a), masked(a.deployedBytecode.object, a))
      codes[name] = { address, codeBytes: (code.length - 2) / 2, keccak256: keccak256(code) }
    }
    assert.equal((await client.getBlock({ blockNumber: block })).hash, observed.hash)
    return {rpc, block: String(block), blockHash: observed.hash, contracts: codes}
  }))
}
try {
  const baseDir = archive(basePin, 'base')
  const vaultDir = archive(vaultPin, 'vault')
  build(baseDir, [paths.SentinelAccountFactoryV2])
  build(vaultDir, [paths.VaultSentinelAccountFactoryV2])
  const original = Object.fromEntries(['SentinelAccountFactoryV2','SentinelAccountV2','VaultSentinelAccountFactoryV2','VaultSentinelAccountV2'].map(n =>
    [n, artifact(n.startsWith('Vault') ? vaultDir : baseDir, n)]))
  assert.equal(keccak256(original.VaultSentinelAccountFactoryV2.bytecode.object), vaultManifest.build.creationHashes.vaultFactory)
  assert.equal(keccak256(original.VaultSentinelAccountV2.bytecode.object), vaultManifest.build.creationHashes.vaultAccount)
  const factoryRuntime = original.VaultSentinelAccountFactoryV2.deployedBytecode.object.slice(2)
  const embedded = factoryRuntime.indexOf(original.VaultSentinelAccountV2.bytecode.object.slice(2))
  assert(embedded >= 0 && embedded % 2 === 0)
  const compiled = Object.fromEntries(Object.entries(original).map(([n, a]) => [n, totals(a)]))
  build(vaultDir, [paths.VaultSentinelAccountFactoryV2], ['--optimizer-runs','1','--out','out-tuned','--cache-path','cache-tuned'])
  const tuned = Object.fromEntries(['VaultSentinelAccountFactoryV2','VaultSentinelAccountV2'].map(n => [n, totals(artifact(vaultDir, n, 'out-tuned'))]))
  for (const [part, file] of [['src', 'SplitVaultFactory.sol'], ['test', 'SplitComparison.t.sol']]) {
    const dest = join(vaultDir, part, 'size7')
    mkdirSync(dest, {recursive: true})
    copyFileSync(join('evidence/session7-size',file),join(dest,file))
  }
  build(vaultDir, [paths.SplitVaultFactory])
  const accountImage = compiled.VaultSentinelAccountV2.creationBytes
  const split = {factory: totals(artifact(vaultDir, 'SplitVaultFactory')), fragmentRuntimeBytes: [Math.floor(accountImage/2)+1, Math.ceil(accountImage/2)+1]}
  const live = await attest(original)
  const output = execFileSync('forge', ['test','--root',vaultDir,'--offline','--match-path','test/size7/SplitComparison.t.sol',
    '--fork-url',live[0].rpc,'--fork-block-number',String(block),'--no-storage-caching','-vv'], {encoding: 'utf8'})
  const passed = output.match(/\[PASS\] testSameRuntimeFreshStorageAndUniqueRegistration\(\) \(gas: (\d+)\)/)
  assert(passed && output.includes('1 tests passed, 0 failed, 0 skipped'))
  console.log(JSON.stringify({basePin,vaultPin,compiler:original.VaultSentinelAccountFactoryV2.metadata.compiler.version,
    forge:execFileSync('forge',['--version'],{encoding:'utf8'}).split('\n')[0],optimizerRuns:200,viaIR:true,evm:'paris',
    baseline:compiled,childCreationCodeOffset:embedded/2,optimizerRuns1:tuned,splitPrototype:split,
    testnetReadOnly:live,forkTest:{chainId:1952,block:String(block),test:'testSameRuntimeFreshStorageAndUniqueRegistration',
      passed:1,failed:0,skipped:0,wholeTestGas:passed[1]}},null,2))
} finally {
  rmSync(temporary, {recursive:true,force:true})
}

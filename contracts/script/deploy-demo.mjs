// Run from the repository root after npm install and (cd contracts && forge build).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createPublicClient, createWalletClient, decodeAbiParameters, decodeFunctionData, defineChain, encodeDeployData, encodeErrorResult, encodeFunctionData,
  getAddress, http, keccak256, parseEventLogs, toHex, zeroHash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { preparePosition, runDemoOps } from './demo-ops.mjs';
import { verifyBuildCommit } from './verify-build.mjs';
import { checkManifest } from '../../packages/chain-config/scripts/check-manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.env.FOUNDRY_PROFILE && process.env.FOUNDRY_PROFILE !== 'default') {
  throw Error('Demo deployments require the default development Foundry profile');
}
const operation = process.argv.find(arg => arg.startsWith('--ops='))?.slice(6);
if (operation !== undefined && !['fresh','price','isolate','liquidate','all'].includes(operation)) {
  throw Error('Use --ops=fresh, price, isolate, liquidate, or all');
}
const mode = process.argv[2];
if (!['testnet', 'local', 'sponsor-fork'].includes(mode)) throw Error('Specify local, testnet or sponsor-fork');
const fork = mode === 'sponsor-fork';
const local = mode !== 'testnet';
const profile = local ? 'local' : 'testnet';
const id = local ? 31337 : 1952;
// The local, fork and testnet demos all model X Layer at one block per second.
const blocksPerYear = 31_536_000n;
const url = local ? process.env.LOCAL_ANVIL_RPC ?? (fork ? 'http://127.0.0.1:19622' : 'http://127.0.0.1:18545') : 'https://testrpc.xlayer.tech';
if (local && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw Error('Local deployment requires a loopback Anvil RPC');
}
const chain = defineChain({ id, name: profile, nativeCurrency: { name: 'Test gas', symbol: 'TEST', decimals: 18 },
  rpcUrls: { default: { http: [url] } } });
const rpc = createPublicClient({ chain, transport: http(url), pollingInterval: local ? 100 : 1000 });
if (await rpc.getChainId() !== id) throw Error('Unexpected chain ID');
const metadata = local ? await rpc.request({ method: 'anvil_metadata' }) : null;
if (local && (!metadata.instanceId || Boolean(metadata.forkedNetwork) !== fork)) throw Error('Unexpected Anvil fork mode');
const forkProof = fork ? JSON.parse(readFileSync(resolve(root,'evidence/a1/fork-policy-evaluations.json'),'utf8')) : null;
if (fork) {
  const info = await rpc.request({method:'anvil_nodeInfo'});
  const source = await rpc.getBlock({blockNumber:BigInt(forkProof.sourceBlock)});
  if (!['127.0.0.1','localhost','[::1]'].includes(new URL(info.forkConfig.forkUrl).hostname) || forkProof.sourceChainId !== 196 ||
      source.hash !== '0xa2558795a0e1feb6aa6e03b5226362b752c1308bd5e26e6be13897fd9f6e3bc8') {
    throw Error('Expected the isolated fork of A1’s fabricated X Layer policy circuits');
  }
}
const fixturePath = 'packages/circuit-sdk/fixtures/policies-v1.json';
const requestedCommit = process.argv.find(arg => arg.startsWith('--source-commit='))?.slice('--source-commit='.length);
const publicInputs = [
  'package.json','package-lock.json','contracts/foundry.toml','contracts/remappings.txt',
  ':(glob)contracts/src/**/*.sol',':(glob)contracts/lib/**/*.sol',
  'contracts/script/DemoRateModel.sol','contracts/script/deploy-demo.mjs','contracts/script/demo-ops.mjs',
  'contracts/script/verify-build.mjs','packages/chain-config/scripts/check-manifest.mjs',
  'packages/circuit-sdk/src','packages/circuit-sdk/package.json','packages/circuit-sdk/tsconfig.json',fixturePath,
];
function checkPublicInputs(ref) {
  if (!ref || !/^[0-9a-f]{7,40}$/i.test(ref)) throw Error('Chain 1952 requires --source-commit=<reviewed Git SHA>');
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const commit = git(['rev-parse','--verify',ref + '^{commit}']);
  const changes = git(['status','--porcelain=v1','--untracked-files=all','--',...publicInputs]);
  if (changes) throw Error('Dirty deployment inputs for chain 1952:\n' + changes);
  const mismatch = git(['diff','--name-only',commit,'HEAD','--',...publicInputs]);
  if (mismatch) throw Error('Deployment inputs differ from the pinned commit:\n' + mismatch);
  return commit;
}
const publicCommit = local ? undefined : checkPublicInputs(requestedCommit);
async function loadSdk() {
  if (local) return import('@peridot/circuit-sdk');
  // The workspace dist is ignored by Git. Build from the checked sources into a new directory.
  mkdirSync(resolve(root,'.research'),{recursive:true});
  const output = mkdtempSync(resolve(root,'.research/testnet-sdk-'));
  writeFileSync(resolve(output,'package.json'),'{"type":"module"}');
  execFileSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),
    '-p',resolve(root,'packages/circuit-sdk/tsconfig.json'),'--outDir',output],{cwd:root});
  return import(pathToFileURL(resolve(output,'index.js')).href);
}
const {compilePolicy,encodeContext,studioMarketTemplate,STUDIO_MARKET_ROOT} = await loadSdk();
const fixtures = JSON.parse(readFileSync(resolve(root, fixturePath), 'utf8')).policies;
for (const fixture of fixtures) {
  const compiled = compilePolicy(fixture.spec);
  for (const field of ['configHash','netlist','netlistHash','gateCount','nIn','nOut','nState']) {
    if (compiled[field] !== fixture[field]) throw Error(`Policy fixture differs from the compiler at ${field}`);
  }
}
const artifacts = new Map();
for (const name of ['TestnetToken','TestnetOracle','DemoRateModel','MarketPToken','PolicyRegistry',
  'TapeOutPolicyAdapter','DevelopmentReferenceProcessor','MarketFactory','SentinelAccountFactory','IsolatedController']) {
  artifacts.set(name, JSON.parse(readFileSync(resolve(root, `contracts/out/${name}.sol/${name}.json`), 'utf8')));
}
const base = execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding:'utf8' }).trim();
const dirty = execFileSync('git', ['status','--porcelain','--','contracts/src','contracts/lib','contracts/foundry.toml',
  'contracts/script/DemoRateModel.sol', fixturePath], { cwd: root, encoding:'utf8' }).trim();
const buildHashes = Object.fromEntries([...artifacts].map(([name, artifact]) => [name, keccak256(artifact.bytecode.object)]));
// Solc records the Keccak-256 hash of every source in each artifact, including imports.
const sourceHashes = new Map();
for (const artifact of artifacts.values()) {
  for (const [path, source] of Object.entries(artifact.metadata.sources)) {
    if (sourceHashes.has(path) && sourceHashes.get(path) !== source.keccak256) throw Error(`Mixed builds for ${path}`);
    sourceHashes.set(path,source.keccak256);
  }
}
const sourceDigest = keccak256(toHex(JSON.stringify([...sourceHashes].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0))));
// Preserve the original journal hash schema while also validating the account artifact used by seeded operations.
const publicAccountArtifact = local ? undefined : JSON.parse(readFileSync(
  resolve(root,'contracts/out/SentinelAccount.sol/SentinelAccount.json'),'utf8'));
const publicMatch = local ? undefined : verifyBuildCommit(root,publicCommit,
  new Map([...artifacts,['SentinelAccount',publicAccountArtifact]]),sourceHashes,fixturePath,true);
if (!local) {
  checkPublicInputs(publicCommit);
  if (process.argv.includes('--preflight-only')) {
    console.log(`Chain 1952 preflight passed at ${publicMatch.commit}: ${publicMatch.sourceCount} source hashes, ${publicMatch.artifactCount} matching ABI and bytecode artifacts. No signing or transactions.`);
    process.exit(0);
  }
} else if (process.argv.includes('--preflight-only')) {
  throw Error('--preflight-only is for the public 1952 deployment profile');
}
const testnetKey = local ? '' : (process.env.PERIDOT_TESTNET_KEY ?? '').replace(/^0x/i,'');
if (!local && !/^[0-9a-f]{64}$/i.test(testnetKey)) {
  throw Error('Expected the isolated 32-byte PERIDOT_TESTNET_KEY for chain 1952');
}
const signer = local ? (await rpc.request({ method: 'eth_accounts' }))[fork ? 3 : 0]
  : privateKeyToAccount('0x' + testnetKey);
const sender = getAddress(local ? signer : signer.address);
if (!local && sender !== getAddress('0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67')) {
  throw Error('Unexpected testnet signer');
}
const wallet = createWalletClient({ account: signer, chain, transport: http(url, { retryCount: 0 }) });

const genesis = await rpc.getBlock({ blockNumber: 0n });
const runId = local ? metadata.instanceId : genesis.hash;
const directory = operation
  ? resolve(root,'evidence/session2-ops',`${mode}-${runId.slice(2,14)}`)
  : fork ? resolve(root,'evidence/a5') : resolve(root,'deployments',profile);
mkdirSync(directory, { recursive:true });
const stateDir = resolve(root, '.research', 'deployment-journals');
mkdirSync(stateDir, { recursive:true });
const journalPath = resolve(stateDir, `${id}-${runId}-${sender}.json`);
const lockPath = journalPath + '.lock';
function acquire() {
  try { writeFileSync(lockPath, String(process.pid), { flag:'wx' }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = Number(readFileSync(lockPath,'utf8'));
    try { process.kill(owner, 0); }
    catch (status) { if (status.code === 'ESRCH') { unlinkSync(lockPath); return acquire(); } throw status; }
    throw Error('Another deployment process holds the journal');
  }
}
acquire();
process.on('exit', () => { unlinkSync(lockPath); });
const encodeJson = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
function save(path, value) {
  const tmp = path + '.' + process.pid;
  writeFileSync(tmp, encodeJson(value));
  renameSync(tmp, path);
}
const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath,'utf8'))
  : { chainId:id, runId, sender, baseCommit:base, sourcesDirty:!!dirty, buildHashes, steps:{} };
if (JSON.stringify(journal.buildHashes) !== JSON.stringify(buildHashes)) throw Error('Deployment bytes changed since this run');
if (publicMatch) {
  if (journal.sourceMatch && journal.sourceMatch.commit !== publicMatch.commit) {
    throw Error('Resume the public deployment with its original verified source commit');
  }
  journal.sourceMatch = publicMatch;
  save(journalPath,journal);
} else if (requestedCommit || (!journal.sourcesDirty && !journal.sourceMatch)) {
  journal.sourceMatch = verifyBuildCommit(root,requestedCommit ?? journal.baseCommit,artifacts,sourceHashes,fixturePath);
  save(journalPath,journal);
}
const receipts = {};
const retried = new Set();
async function transact(label, to, data, expectedRevert, actor = sender) {
  let step = journal.steps[label];
  if (!step) {
    step = { actor, to, dataHash:keccak256(data), nonce:await rpc.getTransactionCount({ address:actor, blockTag:'pending' }),
      startBlock:String(await rpc.getBlockNumber({ cacheTime:0 })) };
    journal.steps[label] = step;
    save(journalPath, journal);
  }
  if ((step.actor ?? sender) !== actor || step.to !== to || step.dataHash !== keccak256(data)) throw Error(`Changed call for ${label}`);
  // If a process died between submission and journaling the hash, find the exact sender/nonce.
  if (!step.hash && await rpc.getTransactionCount({ address:actor, blockTag:'pending' }) > step.nonce) {
    const tip = await rpc.getBlockNumber({ cacheTime:0 });
    for (let n = BigInt(step.startBlock); n <= tip && !step.hash; ++n) {
      const block = await rpc.getBlock({ blockNumber:n, includeTransactions:true });
      const tx = block.transactions.find(tx => tx.from.toLowerCase() === actor.toLowerCase() && tx.nonce === step.nonce);
      if (!tx) continue;
      if ((tx.to ?? '').toLowerCase() !== (to ?? '').toLowerCase() || keccak256(tx.input) !== step.dataHash) {
        throw Error(`Nonce occupied by another transaction at ${label}`);
      }
      step.hash = tx.hash;
    }
    if (!step.hash) throw Error(`Nonce for ${label} is pending. Resume when mined.`);
  }
  if (!step.hash) {
    // Recheck the provider before signing each transaction. The local signer is a node-managed Anvil account.
    if (await rpc.getChainId() !== id) throw Error('Provider chain ID changed');
    // Accrual can take a costlier branch in the next block than it did during estimation.
    const estimate = expectedRevert && fork ? 1500000n : await rpc.estimateGas({ account:actor, to, data });
    if (!local) checkPublicInputs(publicCommit);
    step.hash = await wallet.sendTransaction({ account:actor === sender ? signer : actor, to, data, nonce:step.nonce, gas:estimate + estimate / 3n + 30000n });
  }
  save(journalPath, journal);
  const receipt = await rpc.waitForTransactionReceipt({ hash:step.hash, timeout:120000 });
  if (expectedRevert) {
    if (!fork || receipt.status !== 'reverted') throw Error('Expected a reverted local fork transaction');
    const trace = await rpc.request({method:'debug_traceTransaction',params:[step.hash,{tracer:'callTracer'}]});
    if (trace.output?.toLowerCase() !== expectedRevert.toLowerCase()) throw Error('Unexpected revert data');
    receipts[label] = {hash:step.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:receipt.gasUsed,
      status:'reverted',returnData:trace.output};
    return receipt;
  }
  if (receipt.status !== 'success') {
    if (process.argv.includes('--retry-failed=' + label) && !retried.has(label)) {
      retried.add(label);
      (journal.failures ??= []).push({ label, hash:step.hash, block:receipt.blockNumber.toString(), gasUsed:receipt.gasUsed.toString() });
      delete journal.steps[label];
      save(journalPath,journal);
      return transact(label,to,data,expectedRevert,actor);
    }
    throw Error(`Mined failure for ${label} at ${step.hash}. Diagnose before using --retry-failed=${label}`);
  }
  receipts[label] = { hash:step.hash, block:receipt.blockNumber, blockHash:receipt.blockHash, gasUsed:receipt.gasUsed };
  console.log(`${label} ${step.hash}`);
  return receipt;
}
const contracts = {};
async function deploy(name, args = [], alias = name) {
  const {abi, bytecode} = artifacts.get(name);
  const receipt = await transact('deploy-' + alias, undefined, encodeDeployData({ abi, bytecode:bytecode.object, args }));
  if (!receipt.contractAddress) throw Error(`Deployment missing address: ${alias}`);
  contracts[alias] = getAddress(receipt.contractAddress);
  return contracts[alias];
}
async function call(label, name, target, functionName, args = [], actor = sender) {
  return transact(label,target,encodeFunctionData({abi:artifacts.get(name).abi,functionName,args}),undefined,actor);
}
function read(name, address, functionName, args = []) {
  return rpc.readContract({ abi:artifacts.get(name).abi, address, functionName, args });
}
function readAt(name, address, functionName, args, blockNumber) {
  return rpc.readContract({abi:artifacts.get(name).abi,address,functionName,args,blockNumber});
}
async function anchor(label) {
  journal.observations ??= {};
  if (journal.observations[label] === undefined) {
    journal.observations[label] = String(await rpc.getBlockNumber({cacheTime:0}));
    save(journalPath,journal);
  }
  return BigInt(journal.observations[label]);
}
function event(receipt, name, eventName, emitter) {
  const logs = receipt.logs.filter(l => l.address.toLowerCase() === emitter.toLowerCase());
  const events = parseEventLogs({ abi:artifacts.get(name).abi, logs, eventName });
  if (events.length !== 1) throw Error(`Missing or ambiguous ${eventName}`);
  return events[0].args;
}

const collateral = await deploy('TestnetToken', ['Mock collateral','mCOL',18], 'MockCollateral');
const debt = await deploy('TestnetToken', ['Mock dollar','mUSD',6], 'MockDebt');
const oracle = await deploy('TestnetOracle');
const model = await deploy('DemoRateModel',[blocksPerYear]);
if (await read('DemoRateModel',model,'blocksPerYear') !== blocksPerYear) {
  throw Error('Deployed rate model has the wrong X Layer cadence');
}
const book = await deploy('MarketPToken');
const registry = await deploy('PolicyRegistry',[sender]);
const adapter = await deploy('TapeOutPolicyAdapter',[registry]);
const processor = fork ? getAddress(forkProof.processor) : await deploy('DevelopmentReferenceProcessor');
if (!fork && await rpc.getCode({address:processor}) !== artifacts.get('DevelopmentReferenceProcessor').deployedBytecode.object) {
  throw Error('Reference processor runtime differs from this build');
}
await call(fork ? 'trust-fork-processor' : 'trust-development-processor','PolicyRegistry',registry,'setProcessorTrust',[processor,true]);
const studioRoot = await read('PolicyRegistry',registry,'MARKET_TEMPLATE_ROOT');
if (studioRoot !== STUDIO_MARKET_ROOT) throw Error('Deployed Studio market template commitment differs from SDK');
const studioPublisher = local ? getAddress((await rpc.request({method:'eth_accounts'}))[6]) : sender;
const circuits = [];
const evaluations = [];
for (const [kind, fixture] of fixtures.entries()) {
  const policyKind = ['MARKET','ACCOUNT'][kind];
  if (fixture.spec.kind !== policyKind) throw Error('Unexpected policy fixture');
  let circuitId;
  if (fork) {
    circuitId = BigInt(forkProof.policies.find(p => p.kind === policyKind).id);
    const observed = await read('DevelopmentReferenceProcessor',processor,'netlist',[circuitId]);
    if (keccak256(observed) !== fixture.netlistHash) throw Error('Fork sponsor circuit differs from the compiled policy');
  } else {
    const added = await call('compile-fixture-' + policyKind,'DevelopmentReferenceProcessor',processor,'addReferenceCircuit',[fixture.netlist]);
    circuitId = event(added,'DevelopmentReferenceProcessor','ReferenceCircuitAdded',processor).id;
  }
  const { configHash, netlistHash } = fixture;
  let policyId;
  if (kind === 0) {
    const { maxLtvBps, requireCashReserve } = fixture.spec.params;
    const { compiled, proof } = studioMarketTemplate(maxLtvBps,requireCashReserve);
    if (compiled.netlistHash !== netlistHash || compiled.configHash !== configHash) throw Error('Studio fixture mismatch');
    await call('register-market-template','PolicyRegistry',registry,'registerMarketTemplate',
      [processor,circuitId,maxLtvBps,requireCashReserve,netlistHash,configHash,proof],studioPublisher);
    policyId = await read('PolicyRegistry',registry,'marketTemplatePolicy',[processor,configHash]);
    const entry = await read('PolicyRegistry',registry,'getPolicy',[policyId]);
    if (entry.netlistHash !== netlistHash || entry.configHash !== configHash || getAddress(entry.processor) !== processor) {
      throw Error('Unexpected canonical Studio policy');
    }
    circuitId = entry.circuitId;
  } else {
    const registered = await call('register-' + policyKind,'PolicyRegistry',registry,'register',
      [processor,circuitId,kind,netlistHash,configHash,zeroHash]);
    policyId = event(registered,'PolicyRegistry','PolicyRegistered',registry).policyId;
  }
  circuits.push({ kind:policyKind, circuitId:String(circuitId), policyId, netlistHash, configHash });
  for (const vector of fixture.vectors) {
    const output = await read('DevelopmentReferenceProcessor',processor,'eval',[circuitId,vector.inputs]);
    if (output !== vector.output) throw Error(`Unexpected ${policyKind} circuit output`);
    evaluations.push({ kind:policyKind, inputs:vector.inputs, output });
  }
}
const marketFactory = await deploy('MarketFactory',[registry,adapter,oracle,model,book,collateral,debt]);
await deploy('SentinelAccountFactory',[marketFactory]);
const wad = 10n ** 18n, usd = 10n ** 6n;
await call('price-collateral','TestnetOracle',oracle,'setPrice',[collateral,2n*wad]);
await call('price-debt','TestnetOracle',oracle,'setPrice',[debt,wad]);
const created = await call('create-market','MarketFactory',marketFactory,'createMarket',
  [circuits[0].policyId,7500,8500,500n*wad,1000n*usd,900n*usd,10n*usd]);
const { controller, collateralMarket, debtMarket } = event(created,'MarketFactory','MarketCreated',marketFactory);
await call('mint-test-liquidity','TestnetToken',debt,'mint',[sender,200n*usd]);
await call('approve-seed','TestnetToken',debt,'approve',[debtMarket,200n*usd]);
await call('supply-seed','MarketPToken',debtMarket,'mint',[200n*usd]);
await call('activate-market','IsolatedController',controller,'activate');
if (!await read('IsolatedController',controller,'active') || !await read('MarketFactory',marketFactory,'isMarket',[controller])) {
  throw Error('Activation postcondition failed');
}
const manifest = { schemaVersion:1, abiVersion:'v1', profile, chainId:id, status:'deployed',
  commit:journal.sourceMatch?.commit ?? null, capabilities:{studioMarketTemplateRoot:studioRoot,policyAllowedEvents:true},
  deploymentBlock:String(receipts['deploy-MockCollateral'].block),
  provenance:{baseCommit:journal.baseCommit,sourceDigest,sourcesDirty:journal.sourcesDirty,sourceMatch:journal.sourceMatch ?? null}, contracts, markets:[{ controller, collateralMarket, debtMarket }],
  tapeout:{ mode:fork ? 'official' : 'development-reference', processor, circuits },
  mocks:['MockCollateral','MockDebt','TestnetOracle',...(fork ? [] : ['DevelopmentReferenceProcessor'])] };
console.log(await checkManifest(manifest,url));
if (fork && journal.sourceMatch) {
  save(resolve(directory,`provenance-${runId.slice(2,14)}.json`),manifest.provenance);
}
const receiptFile = resolve(directory,`demo-${runId.slice(2,14)}.json`);
const evidence = { label:fork ? 'Local nested Anvil fork / sponsor processor with fork-only fabricated circuits' : local ? 'Local Anvil simulation / development reference processor' : 'X Layer testnet / development reference processor',
  chainId:id, ...(fork ? {source:{chainId:196,pinnedBlock:forkProof.sourceBlock,localForkParent:metadata.forkedNetwork}} : {}), sender, genesisHash:genesis.hash, runId, baseCommit:journal.baseCommit, sourcesDirty:journal.sourcesDirty,
  buildHashes, policyVectors:evaluations, transactions:receipts, market:manifest.markets[0], manifest };
if (!existsSync(receiptFile)) save(receiptFile,evidence);
function publishManifest() {
  if (operation) save(resolve(directory,'manifest.json'),manifest);
  if (!fork && process.argv.includes('--publish-manifest')) save(resolve(root,`packages/chain-config/deployments/${id}.json`),manifest);
}
console.log(`Evidence: ${receiptFile}`);

if (operation || fork || process.argv.includes('--position')) {
  const deploymentSteps = new Set(Object.keys(receipts));
  const operatorAddress = process.env.DEMO_OPERATOR ?? (local ? (await rpc.request({ method:'eth_accounts' }))[fork ? 4 : 1] : undefined);
  if (!operatorAddress || getAddress(operatorAddress) === sender) throw Error('Set a separate DEMO_OPERATOR address');
  const operator = getAddress(operatorAddress);
  const accountAbi = publicAccountArtifact ?? JSON.parse(readFileSync(resolve(root,'contracts/out/SentinelAccount.sol/SentinelAccount.json'),'utf8'));
  artifacts.set('SentinelAccount',accountAbi);
  const accounts = local ? await rpc.request({method:'eth_accounts'}) : [];
  const ops = {call,event,readAt,rpc,anchor,sender,operator,market:manifest.markets[0],collateral,debt,oracle,
    sentinelFactory:contracts.SentinelAccountFactory,marketFactory,marketPolicy:circuits[0].policyId,
    accountPolicy:circuits[1].policyId,liquidator:local ? getAddress(accounts[5]) : sender};
  if (operation) {
    const outcome = await runDemoOps(ops,operation);
    if (outcome.isolation) manifest.markets.push(outcome.isolation.market);
    else if (journal.steps['ops-create-independent-market']?.hash) {
      const receipt = await rpc.getTransactionReceipt({hash:journal.steps['ops-create-independent-market'].hash});
      const {controller,collateralMarket,debtMarket} = event(receipt,'MarketFactory','MarketCreated',marketFactory);
      manifest.markets.push({controller,collateralMarket,debtMarket});
    }
    console.log(await checkManifest(manifest,url));
    const operationEvidence = {label:evidence.label,chainId:id,runId,operation,sourceDigest,contracts,
      ...outcome,transactions:Object.fromEntries(Object.entries(receipts).filter(([k]) => !deploymentSteps.has(k)))};
    save(resolve(directory,operation + '.json'),operationEvidence);
    console.log(`Sentinel account ${outcome.fresh.account}; repay-only operator ${operator}`);
    publishManifest();
    process.exit(0);
  }
  const {account,borrowed,snapshot} = await preparePosition(ops);
  const before = snapshot.ltvBps;
  const moved = await call('move-mock-price','TestnetOracle',oracle,'setPrice',[collateral,16n*wad/10n]);
  const after = await rpc.readContract({ abi:artifacts.get('IsolatedController').abi,address:controller,
    functionName:'currentLtvBps',args:[account],blockNumber:moved.blockNumber });
  if (before !== 4000n || after !== 5000n) throw Error('Unexpected demo position');
  const positionPath = resolve(directory,`position-${runId.slice(2,14)}.json`);
  const position = { label:evidence.label, chainId:id, owner:sender, operator, account, controller,
    referenceAccountPolicy:circuits[1].policyId, borrowedUnits:80n*usd, triggerBps:4500,
    grantedDebtUnits:20n*usd, ltvBpsBeforeMockMove:before, ltvBpsAfterMockMove:after, failedAttempts:journal.failures ?? [],
    transactions:Object.fromEntries(Object.entries(receipts).filter(([k]) => !deploymentSteps.has(k))) };
  if (!existsSync(positionPath)) save(positionPath,position);
  // Replay three counterfactuals on the same post-borrow block without sending a transaction.
  // The direct book calls use the Sentinel address as eth_call's simulated sender.
  const probes = [];
  for (const [surface,caller,callee,amount,failure,policy] of [
    ['SentinelAccount',sender,account,35n*usd,'AccountPolicyRejected',circuits[1].policyId],
    ['MarketPToken',account,debtMarket,35n*usd,null,null],
    ['MarketPToken',account,debtMarket,60n*usd,'MarketPolicyRejected',circuits[0].policyId],
  ]) {
    const data = encodeFunctionData({ abi:artifacts.get(surface).abi,functionName:'borrow',args:[amount] });
    const res = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{from:caller,to:callee,data},toHex(borrowed.blockNumber)]})});
    const body = await res.json();
    const expected = failure ? encodeErrorResult({abi:artifacts.get('TapeOutPolicyAdapter').abi,errorName:failure,args:[policy,1]}) : null;
    if (expected ? body.error?.data !== expected : BigInt(body.result) !== 0n) throw Error('Unexpected borrow preview');
    probes.push({surface,from:caller,to:callee,calldata:data,debtUnits:amount,expected:failure ?? 'allowed',
      returnData:body.error?.data ?? body.result});
  }
  const checksPath = resolve(directory,`checks-${runId.slice(2,14)}.json`);
  if (!existsSync(checksPath)) save(checksPath,{label:evidence.label,method:'eth_call',chainId:id,
    block:borrowed.blockNumber,blockHash:borrowed.blockHash,probes});
  if (fork) {
    // Check actual nested STATICCALLs during settlement, then mine separate policy denials.
    const trace = await rpc.request({method:'debug_traceTransaction',params:[borrowed.transactionHash,{tracer:'callTracer'}]});
    function cpuReads(node) {
      const isEval = node.type === 'STATICCALL' && node.from.toLowerCase() === adapter.toLowerCase() &&
        node.to.toLowerCase() === processor.toLowerCase() && node.input.startsWith('0x934d06ea');
      return [...(isEval ? [node] : []),...(node.calls ?? []).flatMap(cpuReads)];
    }
    const evaluations = cpuReads(trace).map(node => {
      const {args} = decodeFunctionData({abi:artifacts.get('DevelopmentReferenceProcessor').abi,data:node.input});
      return {from:node.from,to:node.to,circuitId:args[0],context:args[1],gasUsed:BigInt(node.gasUsed),output:node.output};
    });
    if (evaluations.length !== 2 || evaluations[0].circuitId !== BigInt(circuits[1].circuitId) ||
        evaluations[1].circuitId !== BigInt(circuits[0].circuitId) ||
        evaluations.some(e => e.context !== encodeContext({op:2,oracleFresh:true,postLtvBps:4000,cashOk:true}) ||
          decodeAbiParameters([{type:'bytes'}],e.output)[0] !== '0x01')) {
      throw Error('Both sponsor evals must see the same borrow context');
    }
    const firstRejection = 'mined-account-denial';
    const secondRejection = 'mined-direct-market-denial';
    const failureData = (name,policyId) => encodeErrorResult({abi:artifacts.get('TapeOutPolicyAdapter').abi,errorName:name,args:[policyId,1]});
    await transact(firstRejection,account,encodeFunctionData({abi:accountAbi.abi,functionName:'borrow',args:[10n*usd]}),
      failureData('AccountPolicyRejected',circuits[1].policyId));
    await call('mint-direct-collateral','TestnetToken',collateral,'mint',[sender,50n*wad]);
    await call('approve-direct-collateral','TestnetToken',collateral,'approve',[collateralMarket,50n*wad]);
    await call('supply-direct-collateral','MarketPToken',collateralMarket,'mint',[50n*wad]);
    await call('enter-direct-collateral','IsolatedController',controller,'enterMarkets',[[collateralMarket]]);
    await transact(secondRejection,debtMarket,encodeFunctionData({abi:artifacts.get('MarketPToken').abi,functionName:'borrow',args:[56n*usd]}),
      failureData('MarketPolicyRejected',circuits[0].policyId));
    const summaryPath = resolve(directory,`settlement-${runId.slice(2,14)}.json`);
    if (!existsSync(summaryPath)) save(summaryPath,{label:evidence.label,source:evidence.source,chainId:id,account,controller,
      processor,borrowReceipt:receipts['borrow-demo-dollars'],borrowContextEvaluations:evaluations,
      accountDenial:{amount:10n*usd,...receipts[firstRejection]},directMarketDenial:{amount:56n*usd,...receipts[secondRejection]},
      directSupply:receipts['supply-direct-collateral'],directCollateralEntry:receipts['enter-direct-collateral']});
  }
  console.log(`KEEPER_ACCOUNT=${account} KEEPER_OPERATOR=${operator} KEEPER_CHAIN_ID=${id} KEEPER_RPC=${url}`);
}

publishManifest();

// Run from the repository root after npm install and (cd contracts && forge build).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, defineChain, encodeDeployData, encodeErrorResult, encodeFunctionData,
  getAddress, http, keccak256, parseEventLogs, toHex, zeroHash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compilePolicy } from '@peridot/circuit-sdk';
import { checkManifest } from '../../packages/chain-config/scripts/check-manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = process.argv[2];
if (!['testnet', 'local'].includes(profile)) throw Error('Specify local or testnet');
const local = profile === 'local';
const id = local ? 31337 : 1952;
const url = local ? (process.env.LOCAL_ANVIL_RPC ?? 'http://127.0.0.1:18545') : 'https://testrpc.xlayer.tech';
if (local && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw Error('Local deployment requires a loopback Anvil RPC');
}
const chain = defineChain({ id, name: profile, nativeCurrency: { name: 'Test gas', symbol: 'TEST', decimals: 18 },
  rpcUrls: { default: { http: [url] } } });
const rpc = createPublicClient({ chain, transport: http(url), pollingInterval: local ? 100 : 1000 });
if (await rpc.getChainId() !== id) throw Error('Unexpected chain ID');
const metadata = local ? await rpc.request({ method: 'anvil_metadata' }) : null;
if (local && (!metadata.instanceId || metadata.forkedNetwork)) throw Error('Use an unforked development node');
const testnetKey = local ? '' : (process.env.PERIDOT_TESTNET_KEY ?? '').replace(/^0x/i,'');
if (!local && !/^[0-9a-f]{64}$/i.test(testnetKey)) {
  throw Error('Expected the isolated 32-byte PERIDOT_TESTNET_KEY for chain 1952');
}
const signer = local ? (await rpc.request({ method: 'eth_accounts' }))[0]
  : privateKeyToAccount('0x' + testnetKey);
const sender = getAddress(local ? signer : signer.address);
if (!local && sender !== getAddress('0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67')) {
  throw Error('Unexpected testnet signer');
}
const wallet = createWalletClient({ account: signer, chain, transport: http(url, { retryCount: 0 }) });

const fixturePath = 'packages/circuit-sdk/fixtures/policies-v1.json';
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
const genesis = await rpc.getBlock({ blockNumber: 0n });
const runId = local ? metadata.instanceId : genesis.hash;
const directory = resolve(root, 'deployments', profile);
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
const receipts = {};
const retried = new Set();
async function transact(label, to, data) {
  let step = journal.steps[label];
  if (!step) {
    step = { to, dataHash:keccak256(data), nonce:await rpc.getTransactionCount({ address:sender, blockTag:'pending' }),
      startBlock:String(await rpc.getBlockNumber({ cacheTime:0 })) };
    journal.steps[label] = step;
    save(journalPath, journal);
  }
  if (step.to !== to || step.dataHash !== keccak256(data)) throw Error(`Changed call for ${label}`);
  // If a process died between submission and journaling the hash, find the exact sender/nonce.
  if (!step.hash && await rpc.getTransactionCount({ address:sender, blockTag:'pending' }) > step.nonce) {
    const tip = await rpc.getBlockNumber({ cacheTime:0 });
    for (let n = BigInt(step.startBlock); n <= tip && !step.hash; ++n) {
      const block = await rpc.getBlock({ blockNumber:n, includeTransactions:true });
      const tx = block.transactions.find(tx => tx.from.toLowerCase() === sender.toLowerCase() && tx.nonce === step.nonce);
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
    const estimate = await rpc.estimateGas({ account:sender, to, data });
    step.hash = await wallet.sendTransaction({ to, data, nonce:step.nonce, gas:estimate + estimate / 3n + 30000n });
  }
  save(journalPath, journal);
  const receipt = await rpc.waitForTransactionReceipt({ hash:step.hash, timeout:120000 });
  if (receipt.status !== 'success') {
    if (process.argv.includes('--retry-failed=' + label) && !retried.has(label)) {
      retried.add(label);
      (journal.failures ??= []).push({ label, hash:step.hash, block:receipt.blockNumber.toString(), gasUsed:receipt.gasUsed.toString() });
      delete journal.steps[label];
      save(journalPath,journal);
      return transact(label,to,data);
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
async function call(label, name, target, functionName, args = []) {
  return transact(label, target, encodeFunctionData({ abi:artifacts.get(name).abi, functionName, args }));
}
function read(name, address, functionName, args = []) {
  return rpc.readContract({ abi:artifacts.get(name).abi, address, functionName, args });
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
const model = await deploy('DemoRateModel');
const book = await deploy('MarketPToken');
const registry = await deploy('PolicyRegistry',[sender]);
const adapter = await deploy('TapeOutPolicyAdapter',[registry]);
const processor = await deploy('DevelopmentReferenceProcessor');
await call('trust-development-processor','PolicyRegistry',registry,'setProcessorTrust',[processor,true]);
const cpuBytecode = await rpc.getCode({ address:processor });
if (cpuBytecode !== artifacts.get('DevelopmentReferenceProcessor').deployedBytecode.object) {
  throw Error('Reference processor runtime differs from this build');
}
const circuits = [];
const evaluations = [];
for (const [kind, fixture] of fixtures.entries()) {
  const policyKind = ['MARKET','ACCOUNT'][kind];
  if (fixture.spec.kind !== policyKind) throw Error('Unexpected policy fixture');
  const added = await call('compile-fixture-' + policyKind,'DevelopmentReferenceProcessor',processor,'addReferenceCircuit',[fixture.netlist]);
  const circuitId = event(added,'DevelopmentReferenceProcessor','ReferenceCircuitAdded',processor).id;
  const { configHash, netlistHash } = fixture;
  const registered = await call('register-' + policyKind,'PolicyRegistry',registry,'register',
    [processor,circuitId,kind,netlistHash,configHash,zeroHash]);
  const policyId = event(registered,'PolicyRegistry','PolicyRegistered',registry).policyId;
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
  commit:journal.sourcesDirty ? null : journal.baseCommit,
  provenance:{baseCommit:journal.baseCommit,sourceDigest,sourcesDirty:journal.sourcesDirty}, contracts, markets:[{ controller, collateralMarket, debtMarket }],
  tapeout:{ mode:'development-reference', processor, circuits }, mocks:['MockCollateral','MockDebt','TestnetOracle','DevelopmentReferenceProcessor'] };
console.log(await checkManifest(manifest,url));
const receiptFile = resolve(directory,`demo-${runId.slice(2,14)}.json`);
const evidence = { label:local ? 'Local Anvil simulation / development reference processor' : 'X Layer testnet / development reference processor',
  chainId:id, sender, genesisHash:genesis.hash, runId, baseCommit:journal.baseCommit, sourcesDirty:journal.sourcesDirty,
  buildHashes, policyVectors:evaluations, transactions:receipts, market:manifest.markets[0], manifest };
if (!existsSync(receiptFile)) save(receiptFile,evidence);
save(resolve(root,`packages/chain-config/deployments/${id}.json`),manifest);
console.log(`Evidence: ${receiptFile}`);

if (process.argv.includes('--position')) {
  const deploymentSteps = new Set(Object.keys(receipts));
  const operatorAddress = process.env.DEMO_OPERATOR ?? (local ? (await rpc.request({ method:'eth_accounts' }))[1] : undefined);
  if (!operatorAddress || getAddress(operatorAddress) === sender) throw Error('Set a separate DEMO_OPERATOR address');
  const operator = getAddress(operatorAddress);
  const accountAbi = JSON.parse(readFileSync(resolve(root,'contracts/out/SentinelAccount.sol/SentinelAccount.json'),'utf8'));
  artifacts.set('SentinelAccount',accountAbi);
  const sf = contracts.SentinelAccountFactory;
  const made = await call('create-demo-account','SentinelAccountFactory',sf,'createAccount',[controller,circuits[1].policyId]);
  const { account } = event(made,'SentinelAccountFactory','AccountCreated',sf);
  await call('mint-demo-collateral','TestnetToken',collateral,'mint',[account,100n*wad]);
  await call('enter-collateral','SentinelAccount',account,'enterCollateral');
  await call('supply-collateral','SentinelAccount',account,'supply',[100n*wad]);
  const borrowed = await call('borrow-demo-dollars','SentinelAccount',account,'borrow',[80n*usd]);
  const before = await rpc.readContract({ abi:artifacts.get('IsolatedController').abi, address:controller,
    functionName:'currentLtvBps', args:[account], blockNumber:borrowed.blockNumber });
  await call('configure-trigger','SentinelAccount',account,'setAutoRepayTrigger',[4500]);
  const { timestamp } = await rpc.getBlock({ blockNumber:borrowed.blockNumber });
  await call('grant-repay-only','SentinelAccount',account,'setOperator',[operator,8,20n*usd,timestamp+86400n]);
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
  console.log(`KEEPER_ACCOUNT=${account} KEEPER_OPERATOR=${operator} KEEPER_CHAIN_ID=${id} KEEPER_RPC=${url}`);
}

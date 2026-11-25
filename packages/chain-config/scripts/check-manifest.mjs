import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const profiles = new Map([[196,'read-only'], [1952,'testnet'], [31337,'local']]);
const required = ['MarketFactory','PolicyRegistry','TapeOutPolicyAdapter','SentinelAccountFactory'];
const address = /^0x[0-9a-f]{40}$/i;
const hash = /^0x[0-9a-f]{64}$/i;

export async function checkManifest(m, rpcUrl) {
  const fail = message => { throw Error(message); };
  if (m.schemaVersion !== 1 || m.abiVersion !== 'v1' || !profiles.has(m.chainId) ||
      profiles.get(m.chainId) !== m.profile) fail('Unsupported chain, profile or schema');
  let id = 0;
  async function rpc(method, params) {
    const res = await fetch(rpcUrl, { method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({ jsonrpc:'2.0', id:++id, method, params }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) fail(`HTTP ${res.status}`);
    const reply = await res.json();
    if (reply.error || reply.result == null) fail(`${method} failed`);
    return reply.result;
  }
  if (BigInt(await rpc('eth_chainId', [])) !== BigInt(m.chainId)) fail('RPC chain ID mismatch');
  if (m.status === 'not-deployed') {
    if (Object.keys(m.contracts).length || m.markets.length || m.tapeout.processor !== null ||
        m.tapeout.circuits.length || m.tapeout.mode !== 'unavailable' || m.mocks.length) fail('Undeployed manifest contains live data');
    return 'Undeployed, writes disabled';
  }
  if (m.status !== 'deployed' || m.profile === 'read-only' || !m.markets.length ||
      required.some(key => !m.contracts[key])) fail('Incomplete or unauthorized deployment');
  if (!['development-reference','official','self-deployed-reference'].includes(m.tapeout.mode) ||
      !['ACCOUNT','MARKET'].every(kind => m.tapeout.circuits.some(c => c.kind === kind)) ||
      m.tapeout.circuits.some(c => !/^[1-9][0-9]*$/.test(c.circuitId) ||
        ![c.policyId,c.netlistHash,c.configHash].every(v => hash.test(v)))) fail('Invalid circuit identity');
  const targets = new Set([...Object.values(m.contracts), m.tapeout.processor,
    ...m.markets.flatMap(v => [v.controller, v.collateralMarket, v.debtMarket])]);
  const block = await rpc('eth_blockNumber', []);
  for (const target of targets) {
    if (!address.test(target) || /^0x0{40}$/i.test(target)) fail(`Invalid address ${target}`);
    const code = await rpc('eth_getCode', [target, block]);
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(code)) fail(`Missing code at ${target} on ${m.chainId}`);
  }
  return `Verified ${targets.size} code addresses on chain ${m.chainId} at block ${BigInt(block)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, url] = process.argv.slice(2);
  if (!path || !url) throw Error('Usage: node check-manifest.mjs MANIFEST RPC');
  console.log(await checkManifest(JSON.parse(await readFile(path, 'utf8')), url));
}

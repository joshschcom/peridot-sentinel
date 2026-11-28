// Keeps the public testnet (1952) demo's four mock prices fresh. Testnet only. Maintained by Claude (DECISIONS D26).
//
// It does exactly one kind of thing: for the four pinned (oracle, asset) pairs, if the on-chain quote is older than
// REFRESH_AFTER, it calls setPrice(asset, <the price already on chain>) from the oracle owner. Values never change.
// It refuses to run on any chain but 1952, refuses if the signer is not the pinned owner, and caps the gas price.
//
//   PERIDOT_TESTNET_KEY_FILE=/etc/peridot/deployer.key node refresh.mjs          # refresh what is due
//   node refresh.mjs --check                                                      # read-only: print ages, send nothing
//
// The key is read from a file (mode 600) and never printed. Output: one line per pair, transaction hashes only.
import { readFileSync, statSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, formatGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPCS = ["https://testrpc.xlayer.tech", "https://xlayertestrpc.okx.com"];
const OWNER = "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67";
const PAIRS = [
  { name: "mWOKB (v2 swap venue)", oracle: "0x0386eA8906A1CB9Fa34C7a4A2433F5CEAB5210c8", asset: "0x3a5F909912c4adbEE8776264E6b9faD130321b26" },
  { name: "mUSDC (v2 swap venue)", oracle: "0x0386eA8906A1CB9Fa34C7a4A2433F5CEAB5210c8", asset: "0x3A6cb8BEdc251C37dc8258a27575127990A67E95" },
  { name: "MockCollateral (v1 market)", oracle: "0x2257293155CF9a52590BA289E599F9Adf297ac57", asset: "0xe1dA369f92596c3c10c353E200c05343C9F19c92" },
  { name: "MockDebt (v1 market)", oracle: "0x2257293155CF9a52590BA289E599F9Adf297ac57", asset: "0x0D5042F66e5D3Cb3CF3ce708F82208707e2B0dd9" },
];
const REFRESH_AFTER = BigInt(process.env.REFRESH_AFTER_SECONDS ?? 12 * 3600); // maxAge is 86,400 s
const MAX_GAS_PRICE = 1_000_000_000n; // 1 gwei; testnet normally charges about 0.02
const abi = parseAbi([
  "function quotes(address) view returns (uint192 price, uint64 updatedAt)",
  "function owner() view returns (address)",
  "function setPrice(address asset, uint256 priceWad)",
]);
const chain = defineChain({ id: 1952, name: "X Layer testnet", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: RPCS } } });
const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

async function main() {
  const checkOnly = process.argv.includes("--check");
  let client = null;
  for (const url of RPCS) {
    const candidate = createPublicClient({ chain, transport: http(url, { timeout: 15_000, retryCount: 2 }) });
    try { if ((await candidate.getChainId()) === 1952) { client = candidate; break; } } catch {}
  }
  if (!client) throw Error("no X Layer testnet (1952) RPC reachable");
  const block = await client.getBlock({ blockTag: "latest" });
  const due = [];
  for (const pair of PAIRS) {
    const [price, updatedAt] = await client.readContract({ address: pair.oracle, abi, functionName: "quotes", args: [pair.asset] });
    const age = block.timestamp - BigInt(updatedAt);
    log(`${pair.name}: price ${price} age ${age}s${age >= REFRESH_AFTER ? " -> due" : ""}`);
    if (price === 0n) throw Error(`${pair.name} has no price on chain; refusing to invent one`);
    if (age >= REFRESH_AFTER) due.push({ ...pair, price });
  }
  if (checkOnly || due.length === 0) return;

  const file = process.env.PERIDOT_TESTNET_KEY_FILE;
  if (!file) throw Error("set PERIDOT_TESTNET_KEY_FILE");
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) throw Error("the key file must not be readable by group or others (chmod 600)");
  let key = readFileSync(file, "utf8").trim();
  if (!key.startsWith("0x")) key = `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw Error("the key file does not hold one 32-byte hex key");
  const account = privateKeyToAccount(key);
  key = null;
  if (account.address.toLowerCase() !== OWNER.toLowerCase()) throw Error("the key is not the pinned testnet oracle owner");
  const wallet = createWalletClient({ account, chain, transport: http(client.transport.url) });

  for (const pair of due) {
    const owner = await client.readContract({ address: pair.oracle, abi, functionName: "owner" });
    if (owner.toLowerCase() !== OWNER.toLowerCase()) throw Error(`${pair.name}: oracle owner changed; refusing`);
    const gasPrice = await client.getGasPrice();
    if (gasPrice > MAX_GAS_PRICE) throw Error(`gas price ${formatGwei(gasPrice)} gwei is above the 1 gwei cap; not sending`);
    const hash = await wallet.writeContract({ address: pair.oracle, abi, functionName: "setPrice", args: [pair.asset, pair.price], gas: 80_000n });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    log(`${pair.name}: refreshed at unchanged price, tx ${hash} status ${receipt.status}`);
    if (receipt.status !== "success") throw Error(`${pair.name}: refresh reverted`);
  }
}

main().catch((error) => { log(`ERROR ${String(error?.shortMessage ?? error?.message ?? error).split("\n")[0]}`); process.exit(1); });

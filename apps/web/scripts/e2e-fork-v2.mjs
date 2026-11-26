// Sentinel v2 and vault OWNER flows in a real browser on the PUBLIC 1952 configuration, against a PRIVATE FORK of
// X Layer testnet 1952. Nothing here touches the public chain, and no hash this script produces exists there.
//   Node:   a loopback Anvil fork of 1952 with --chain-id 1952 and --auto-impersonate. Claude runs it; this script never starts one.
//   Build:  the app is built for chain 1952 with the fork label, pointed at the fork, from a COPY of the expansion
//           manifests in which only the vault's own switch is turned on (packages/ is never edited):
//             mkdir -p $DIR && cp packages/chain-config/expansion/deployments/*.json $DIR/ && set "uiEnabled": true in $DIR/vault-1952.json
//             NEXT_PUBLIC_PERIDOT_FORK=1 NEXT_PUBLIC_TESTNET_RPC_URL=http://127.0.0.1:19750 PERIDOT_EXPANSION_DIR=$DIR npm run build
//             NEXT_PUBLIC_PERIDOT_FORK=1 NEXT_PUBLIC_TESTNET_RPC_URL=http://127.0.0.1:19750 npx next start -p 3213 -H 127.0.0.1
//   Run:    EXPANSION_DIR=$DIR PLAYWRIGHT_BROWSERS_PATH=0 node scripts/e2e-fork-v2.mjs
// The "wallet" is the test-only EIP-1193 provider: it reports the public demo owner and forwards to the fork, which
// signs by impersonation. There is no private key anywhere.
//
// Accepted here, from the app, on the PUBLIC accounts the demo owner owns (addresses from the public manifests):
//   v2 account     a new swap-only grant (the public one was revoked by the owner's emergency stop), then revoke-all;
//   vault account  deposit limits, deposit with a minimum of shares, withdraw with a maximum of shares, redeem with a
//                  minimum of assets. The bound shown on screen must be the bound in the mined calldata.
// NOT an app flow: the operator's swap. The script sends that one transaction itself from the operator's address
// (impersonated by the fork, gas balance set with anvil_setBalance), only to prove the grant the app signed works.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, http, zeroAddress } from "viem";
import { LOOPBACK_RPC, connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const json = (path) => JSON.parse(readFileSync(resolve(repo, path), "utf8"));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3213";
const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:19750";
const owner = process.env.FORK_OWNER ?? "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67"; // public demo owner, impersonated by the fork
const operator = process.env.FORK_OPERATOR ?? "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"; // an address only for the app; the fork impersonates it for the one script-sent swap
// The addresses asserted against are the PUBLIC manifests', never the override copy's.
const M = json("packages/chain-config/expansion/deployments/1952.json");
const V = json("packages/chain-config/expansion/deployments/vault-1952.json");
const served = process.env.EXPANSION_DIR ? JSON.parse(readFileSync(resolve(process.env.EXPANSION_DIR, "vault-1952.json"), "utf8")) : null;
const abi = (name) => json(`packages/chain-config/expansion/abi/${name}.json`);
const ACCOUNT = abi("SentinelAccountV2");
const VAULT_ACCOUNT = abi("VaultSentinelAccountV2");
const FACTORY = abi("SentinelAccountFactoryV2");
const VAULT_FACTORY = abi("VaultSentinelAccountFactoryV2");
const SWAP = abi("SinglePoolSwapAdapter");
const RUN_ID = `run-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
const SHOTS = resolve(repo, "evidence/screenshots/fork-v2-vault", RUN_ID);
const OUT = resolve(repo, "evidence/fable/run6");
if (!LOOPBACK_RPC.test(RPC)) throw new Error("This script only runs against a loopback fork");
if ((await jsonRpc(RPC, "eth_chainId")) !== "0x7a0") throw new Error("Expected a fork that reports chain 1952");
const version = await jsonRpc(RPC, "web3_clientVersion");
if (!/anvil/i.test(version)) throw new Error(`The node is not Anvil (${version}): refusing to send`);
if (served) {
  // The override copy may differ from the public vault manifest in exactly one field.
  const { uiEnabled: servedSwitch, ...servedRest } = served;
  const { uiEnabled: publicSwitch, ...publicRest } = V;
  if (JSON.stringify(servedRest) !== JSON.stringify(publicRest) || servedSwitch !== true) throw new Error("The override vault manifest differs from the public one in more than uiEnabled");
  console.log(`override vault manifest: identical to the public one except uiEnabled ${publicSwitch} -> ${servedSwitch}`);
}
const startBlock = Number(await jsonRpc(RPC, "eth_blockNumber"));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const chain = createPublicClient({ transport: http(RPC) });
const read = (address, contractAbi, functionName, args = []) => chain.readContract({ address, abi: contractAbi, functionName, args });
const balance = (token, holder) => read(token, erc20Abi, "balanceOf", [holder]);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const WOKB = M.contracts.mockWokb;
const USDC = M.contracts.mockUsdc;
const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
// Ownership, read from the fork before anything is clicked.
const account = M.contracts.account;
const vaultAccount = V.contracts.vaultAccount;
const preflight = {
  v2AccountOf: await read(M.contracts.factory, FACTORY, "accountOf", [owner]),
  v2Owner: await read(account, ACCOUNT, "owner"),
  vaultAccountOf: await read(V.contracts.vaultFactory, VAULT_FACTORY, "accountOf", [owner]),
  vaultOwner: await read(vaultAccount, VAULT_ACCOUNT, "owner"),
};
if (!same(preflight.v2AccountOf, account) || !same(preflight.v2Owner, owner) || !same(preflight.vaultAccountOf, vaultAccount) || !same(preflight.vaultOwner, owner)) throw new Error(`The demo owner does not own the public accounts on this fork: ${JSON.stringify(preflight)}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", reducedMotion: "reduce" });
const { sent } = await installTestWallet(context, { rpcUrl: RPC, account: owner, walletChainId: "0x7a0" });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${String(error).slice(0, 300)}`));
page.on("console", (message) => message.type() === "error" && !/Failed to load resource/.test(message.text()) && problems.push(`console: ${message.text().slice(0, 300)}`));
const steps = [];
const scriptSent = [];
const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await connectWallet(page);
  await page.waitForFunction(() => !document.querySelector("[data-loading]"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
};
/** Clicks a button inside `scope`, waits for this run's confirmed result there, checks every hash, then verifies on chain. */
async function transact(scope, button, label, verify) {
  const before = sent.length;
  await scope.locator('[data-testid="tx-success"]').evaluateAll((nodes) => nodes.forEach((node) => node.setAttribute("data-stale", "1")));
  await button.click();
  const done = scope.locator('[data-testid="tx-success"]:not([data-stale]), [data-testid="tx-feedback"] [data-rejection]').first();
  await done.waitFor({ timeout: 90000 }).catch(async () => {
    throw new Error(`${label}: no result. Visible: ${(await scope.locator('[data-testid="tx-feedback"]').innerText().catch(() => "no feedback")).slice(0, 400)}`);
  });
  if ((await done.getAttribute("data-rejection")) !== null) throw new Error(`${label}: failed in the app: ${(await done.innerText()).slice(0, 300)}`);
  const txs = sent.slice(before);
  assert(txs.length === 1, `${label}: expected one transaction, the wallet sent ${txs.length}`);
  const receipt = await chain.getTransactionReceipt({ hash: txs[0].hash });
  assert(receipt.status === "success", `${label}: ${txs[0].hash} did not succeed`);
  const tx = await chain.getTransaction({ hash: txs[0].hash });
  assert(same(tx.from, owner), `${label}: not sent by the owner`);
  const asserted = await verify(tx, receipt);
  steps.push({ label, sender: "app (owner wallet)", hash: tx.hash, to: tx.to, selector: tx.input.slice(0, 10), block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), gasLimit: tx.gas.toString(), asserted });
  console.log(`${label}: ${tx.hash} | on chain: ${asserted}`);
  await page.waitForTimeout(600);
  return { tx, receipt };
}
async function revertName(from, address, contractAbi, functionName, args) {
  try {
    await chain.simulateContract({ account: from, address, abi: contractAbi, functionName, args });
    return null;
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
    return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? `unknown(${revert.raw ?? ""})`) : `non-revert: ${String(error).slice(0, 160)}`;
  }
}

let failure = null;
try {
  await go("/trade");
  await page.locator('[data-testid="v2-verify"][data-state="ok"]').waitFor({ timeout: 60000 });
  const root = page.locator('[data-testid="v2-owner"]');
  assert((await root.getAttribute("data-chain")) === "1952", "the owner flows are not on chain 1952");
  const pill = await page.locator('[data-testid="network-pill"]:visible').first().innerText();
  assert(/fork/i.test(pill), `the network is not labelled as a fork (got "${pill}")`);
  assert((await page.locator('a[href*="okx.com/web3/explorer"]').count()) === 0, "a fork build shows an explorer link");
  const base = page.locator('[data-testid="v2-base"]');
  await page.locator(`[data-testid="v2-base"][data-account="${account}"]`).waitFor({ timeout: 30000 });
  await shot("01-trade-owner-flows-on-the-fork");

  /* ---------- v2 account: new swap-only grant, operator swap (script-sent), revoke-all ---------- */
  const before = { operators: await read(account, ACCOUNT, "operatorCount"), wokb: await balance(WOKB, account), usdc: await balance(USDC, account) };
  assert(before.operators === 0n, `the public v2 account already lists ${before.operators} operator(s) on this fork: run on a state where the emergency stop is the last owner action, or revoke first`);
  await page.locator('[data-testid="v2-grant-operator"]').fill(operator);
  await page.locator('[data-testid="v2-grant-percall"]').fill("0.5");
  await page.locator('[data-testid="v2-grant-total"]').fill("1");
  await page.locator('[data-testid="v2-grant-lifetime"]').selectOption("86400");
  await transact(base, page.locator('[data-testid="v2-grant-submit"]'), "v2 swap-only grant: 0.5 mWOKB per swap, 1 in total, 1 day", async (tx, receipt) => {
    const [perCall, remaining, expiry] = await read(account, ACCOUNT, "grants", [operator, M.contracts.swap, 5, WOKB]);
    const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
    assert(same(tx.to, account), "the grant was not sent to the public v2 account");
    assert(perCall === E18 / 2n && remaining === E18 && BigInt(expiry) > block.timestamp && BigInt(expiry) <= block.timestamp + 86400n, `grant on chain is ${perCall}, ${remaining}, ${expiry}`);
    assert((await read(account, ACCOUNT, "operatorCount")) === 1n && same(await read(account, ACCOUNT, "operatorAt", [0n]), operator), "the account does not list exactly this operator");
    return `grants(operator, swap, 5, mWOKB) = (5e17, 1e18, ${expiry}); operatorCount 1`;
  });
  await page.locator(`[data-testid="v2-grants"] li[data-remaining="${E18}"]`).waitFor({ timeout: 30000 });
  await shot("02-v2-grant-set");
  await go("/strategies");
  const row = page.locator(`[data-active-strategy^="v2:${account}"]`);
  await row.waitFor({ timeout: 30000 });
  assert((await row.getAttribute("data-budget-left")) === String(E18), "Strategies does not list the new grant as an active strategy with its budget");

  // The operator's own transaction: sent by this script, not by the app. Fork-only: the address is impersonated.
  const [expectedOut] = await read(M.contracts.swap, SWAP, "executionQuote", [WOKB, E18 / 4n]);
  const minOut = (expectedOut * 9900n) / 10000n; // 1% under the adapter's expected output: the most the execution circuit accepts
  const deadline = (await chain.getBlock()).timestamp + 1200n;
  const wouldRevert = await revertName(operator, account, ACCOUNT, "swapExactIn", [WOKB, E18 / 4n, minOut, deadline]);
  let operatorSwap = null;
  if (wouldRevert === null) {
    if ((await chain.getBalance({ address: operator })) < E18 / 100n) {
      await jsonRpc(RPC, "anvil_setBalance", [operator, `0x${(E18).toString(16)}`]);
      scriptSent.push({ label: "anvil_setBalance(operator, 1 test OKB): a fork-only cheat so the impersonated operator can pay gas", notATransaction: true });
    }
    const wallet = createWalletClient({ account: operator, transport: http(RPC) });
    const hash = await wallet.writeContract({ chain: null, address: account, abi: ACCOUNT, functionName: "swapExactIn", args: [WOKB, E18 / 4n, minOut, deadline], gas: 1_500_000n });
    const receipt = await chain.waitForTransactionReceipt({ hash });
    assert(receipt.status === "success", "the operator's swap reverted");
    const [, remainingAfter] = await read(account, ACCOUNT, "grants", [operator, M.contracts.swap, 5, WOKB]);
    const gained = (await balance(USDC, account)) - before.usdc;
    assert(remainingAfter === (3n * E18) / 4n && gained >= minOut && (await balance(WOKB, account)) === before.wokb - E18 / 4n, "the operator's swap did not settle to the account inside the grant");
    operatorSwap = { hash, minOut: minOut.toString(), expectedOut: expectedOut.toString(), received: gained.toString(), grantRemaining: remainingAfter.toString() };
    scriptSent.push({ label: "operator swap 0.25 mWOKB (sent by this script from the impersonated operator address, NOT by the app)", from: operator, block: receipt.blockNumber.toString(), ...operatorSwap });
    console.log(`operator swap (script-sent): ${hash} | account +${gained} raw mUSDC, grant left ${remainingAfter}`);
  } else {
    // Not an app failure: the grant is on chain either way. Recorded so the report can say the swap was not exercised.
    steps.push({ label: "operator swap (script-sent)", skipped: `eth_call as the operator reverts with ${wouldRevert}; not sent` });
    console.log(`operator swap NOT sent: the simulation reverts with ${wouldRevert}`);
  }

  await go("/trade");
  await page.locator(`[data-testid="v2-base"][data-account="${account}"]`).waitFor({ timeout: 30000 });
  const stop = page.locator('[data-testid="v2-emergency-stop"]');
  await stop.waitFor({ timeout: 30000 });
  assert((await stop.getAttribute("data-operators")) === "1", "the stop card does not list the operator");
  await transact(stop, page.locator('[data-testid="v2-stop-submit"]'), "v2 revoke all operators", async (tx) => {
    const grant = await read(account, ACCOUNT, "grants", [operator, M.contracts.swap, 5, WOKB]);
    assert(same(tx.to, account) && (await read(account, ACCOUNT, "operatorCount")) === 0n && grant.every((value) => BigInt(value) === 0n), "operators or the grant remain after revoke-all");
    const refused = await revertName(operator, account, ACCOUNT, "swapExactIn", [WOKB, E18 / 4n, minOut, deadline]);
    assert(refused === "OperatorNotAuthorized", `the operator's swap after the stop simulates as ${refused}`);
    return "operatorCount 0, grant (0,0,0); the same operator swap now simulates OperatorNotAuthorized";
  });
  await page.locator('[data-testid="v2-grants-empty"]').waitFor({ timeout: 30000 });
  await shot("03-v2-after-revoke-all");

  /* ---------- the public vault account ---------- */
  const vault = page.locator('[data-testid="vault-card"]');
  await page.locator(`[data-testid="vault-card"][data-account="${vaultAccount}"]`).waitFor({ timeout: 30000 });
  assert((await root.getAttribute("data-vault-writes")) === "true", "the vault is not writable in this build");
  const position0 = await read(vaultAccount, VAULT_ACCOUNT, "vaultPosition");
  const idle0 = await balance(USDC, vaultAccount);
  console.log(`vault account before: idle ${idle0}, shares ${position0[0]}, cap ${await read(vaultAccount, VAULT_ACCOUNT, "maxVaultPositionAssets")}`);
  await page.locator('[data-testid="vault-limit-cap"]').fill("1000");
  await page.locator('[data-testid="vault-limit-floor"]').fill("1");
  await transact(vault, page.locator('[data-testid="vault-limits-submit"]'), "vault deposit limits: cap 1000 mUSDC, floor 1 share per asset", async (tx) => {
    const [cap, floor] = await Promise.all([read(vaultAccount, VAULT_ACCOUNT, "maxVaultPositionAssets"), read(vaultAccount, VAULT_ACCOUNT, "minVaultSharesPerAssetWad")]);
    assert(same(tx.to, vaultAccount) && cap === 1000n * E6 && floor === E18, `limits on chain are ${cap}, ${floor}`);
    return `maxVaultPositionAssets ${cap}, minVaultSharesPerAssetWad ${floor}`;
  });

  /** One vault action: the bound on screen must be the bound in the mined calldata, and the result must respect it. */
  const vaultAction = async (action, amountText, functionName, check) => {
    await page.locator(`[data-testid="vault-action-${action}"]`).click();
    await page.locator('[data-testid="vault-tolerance"]').selectOption("50");
    await page.locator('[data-testid="vault-amount"]').fill(amountText);
    const quoteBox = page.locator('[data-testid="vault-quote"][data-state="ok"]');
    await quoteBox.waitFor({ timeout: 20000 });
    const shownQuote = BigInt(await quoteBox.getAttribute("data-quote"));
    const shownBound = BigInt(await quoteBox.getAttribute("data-bound"));
    const before = await read(vaultAccount, VAULT_ACCOUNT, "vaultPosition");
    const idleBefore = await balance(USDC, vaultAccount);
    await shot(`vault-${action}-review`);
    return transact(vault, page.locator('[data-testid="vault-submit"]'), `vault ${action} ${amountText}`, async (tx) => {
      const call = decodeFunctionData({ abi: VAULT_ACCOUNT, data: tx.input });
      assert(call.functionName === functionName && call.args[1] === shownBound, `the mined ${call.functionName} carries bound ${call.args[1]}, the page showed ${shownBound}`);
      const after = await read(vaultAccount, VAULT_ACCOUNT, "vaultPosition");
      const idleAfter = await balance(USDC, vaultAccount);
      assert((await read(USDC, erc20Abi, "allowance", [vaultAccount, V.contracts.mockVault])) === 0n, "an allowance to the vault was left behind");
      return `${check({ shownQuote, shownBound, sharesBefore: before[0], sharesAfter: after[0], idleBefore, idleAfter, input: call.args[0] })}; bound in calldata = bound shown (${shownBound}); allowance to the vault 0`;
    });
  };
  // Amounts fit what the public account holds on the fork (8 mUSDC idle, 4 shares at the fork point).
  assert(idle0 >= 5n * E6, `the vault account holds only ${idle0} raw mUSDC idle on this fork; 5 are needed`);
  await vaultAction("deposit", "5", "depositToVault", ({ shownQuote, shownBound, sharesBefore, sharesAfter, idleBefore, idleAfter, input }) => {
    assert(input === 5n * E6 && idleBefore - idleAfter === 5n * E6 && sharesAfter - sharesBefore >= shownBound && shownBound <= shownQuote && shownBound > 0n, "the deposit did not respect its minimum shares");
    return `assets 5000000 in, shares +${sharesAfter - sharesBefore} (minimum ${shownBound}, quote ${shownQuote})`;
  });
  await vaultAction("withdraw", "2", "withdrawFromVault", ({ shownQuote, shownBound, sharesBefore, sharesAfter, idleBefore, idleAfter, input }) => {
    assert(input === 2n * E6 && idleAfter - idleBefore === 2n * E6 && sharesBefore - sharesAfter <= shownBound && shownBound >= shownQuote, "the withdrawal burned more than its maximum shares");
    return `assets 2000000 out, shares -${sharesBefore - sharesAfter} (maximum ${shownBound}, quote ${shownQuote})`;
  });
  await vaultAction("redeem", "3", "redeemFromVault", ({ shownQuote, shownBound, sharesBefore, sharesAfter, idleBefore, idleAfter, input }) => {
    assert(input === 3n * E6 && sharesBefore - sharesAfter === 3n * E6 && idleAfter - idleBefore >= shownBound && shownBound <= shownQuote && shownBound > 0n, "the redemption paid less than its minimum assets");
    return `shares 3000000 in, assets +${idleAfter - idleBefore} (minimum ${shownBound}, quote ${shownQuote})`;
  });
  await shot("04-vault-after-deposit-withdraw-redeem");

  // A bound the vault cannot meet is refused in simulation; nothing is sent. Asked of the fork directly, as the owner.
  const impossible = await revertName(owner, vaultAccount, VAULT_ACCOUNT, "redeemFromVault", [E6, 10n * E6, (await chain.getBlock()).timestamp + 1200n]);
  assert(impossible !== null, "a redemption with an impossible minimum would have been accepted");
  steps.push({ label: "redeem 1 share with a minimum of 10 mUSDC (eth_call as the owner, nothing sent)", revertsWith: impossible });

  // Portfolio shows the same vault position the chain reports.
  await go("/portfolio");
  const vaultRow = page.locator('[data-portfolio-row="v2-vault"]');
  await vaultRow.waitFor({ timeout: 30000 });
  const positionEnd = await read(vaultAccount, VAULT_ACCOUNT, "vaultPosition");
  assert((await vaultRow.getAttribute("data-shares")) === String(positionEnd[0]) && (await vaultRow.getAttribute("data-idle")) === String(await balance(USDC, vaultAccount)), "Portfolio's vault row differs from the chain");
  steps.push({ label: "Portfolio vault row equals the chain", shares: String(positionEnd[0]) });
  await shot("05-portfolio-vault-row");
} catch (error) {
  failure = String(error?.message ?? error);
  await shot("zz-failure").catch(() => {});
}

const endBlock = Number(await jsonRpc(RPC, "eth_blockNumber"));
const file = `${OUT}/fork-v2-vault-${RUN_ID}.json`;
writeFileSync(
  file,
  `${JSON.stringify(
    {
      label: "PRIVATE FORK of X Layer testnet 1952 (loopback Anvil, chain id 1952, auto-impersonation). Mock tokens, inventory-backed mock venue, mock ERC-4626 vault, development reference processor. These transactions exist only on the fork: they are NOT public transactions and must never be linked to an explorer.",
      driver: "Playwright Chromium + injected test EIP-1193 provider reporting the public demo owner and forwarding to the fork, which signs by impersonation; no private key",
      build: "production build (next build + next start) for chain 1952 with the private-fork label, RPC pointed at the fork; expansion manifests from a copy in which only vault-1952.json uiEnabled is true (the base v2 write switch is treated as on by the fork build)",
      rpc: RPC,
      chainId: 1952,
      nodeClient: version,
      runId: RUN_ID,
      owner,
      operator,
      publicAccounts: { v2Account: account, vaultAccount },
      ownershipPreflight: preflight,
      startBlock,
      endBlock,
      result: failure ? `FAILED: ${failure}` : "passed",
      appTransactions: steps,
      scriptTransactions: scriptSent,
      walletSent: sent,
      pageProblems: problems,
    },
    null,
    2,
  )}\n`,
);
await browser.close();
console.log(`${failure ? `E2E FAILED: ${failure}\n` : "E2E passed. "}${sent.length} app transactions, ${scriptSent.filter((entry) => !entry.notATransaction).length} script transaction(s), ${problems.length} page problem(s). Evidence: ${file}, screenshots: ${SHOTS}`);
process.exit(failure || problems.length ? 1 : 0);

// Sentinel v2 and vault OWNER flows in a real browser, against the shared local development chain (Anvil 31337).
//   Server: NEXT_PUBLIC_PERIDOT_TARGET=local npm run dev -- -p 3211 -H 127.0.0.1
//   Run:    PLAYWRIGHT_BROWSERS_PATH=0 node scripts/e2e-local-v2.mjs
// The wallet is the test-only EIP-1193 provider forwarding to Anvil's unlocked account (#3-#9 only). No private key.
// Everything the app shows is asserted against a direct RPC read; a green toast is not evidence.
//
// Accepted here, from the app: account creation at both factories, funding by mint, collateral supply through the
// lending adapter, a swap-only grant, revoke-all, vault limits, and vault deposit / withdraw / redeem where the bound
// shown on screen is the bound in the mined calldata.
// NOT an app flow: the operator's swap. The app has no operator screen. The script sends that one transaction itself
// from a second unlocked account, only to prove that the grant the app signed works and that revoke-all ends it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, http, zeroAddress } from "viem";
import { LOOPBACK_RPC, connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const json = (path) => JSON.parse(readFileSync(resolve(repo, path), "utf8"));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:18545";
const OWNER_INDEX = Number(process.env.E2E_ACCOUNT_INDEX ?? 6);
const OPERATOR_INDEX = Number(process.env.E2E_OPERATOR_INDEX ?? 7);
const M = json("packages/chain-config/expansion/deployments/31337.json");
const V = json("packages/chain-config/expansion/deployments/vault-31337.json");
const abi = (name) => json(`packages/chain-config/expansion/abi/${name}.json`);
const ACCOUNT = abi("SentinelAccountV2");
const VAULT_ACCOUNT = abi("VaultSentinelAccountV2");
const FACTORY = abi("SentinelAccountFactoryV2");
const VAULT_FACTORY = abi("VaultSentinelAccountFactoryV2");
const SWAP = abi("SinglePoolSwapAdapter");
const RUN_ID = `run-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
const SHOTS = resolve(repo, "evidence/screenshots/local-v2", RUN_ID);
const OUT = resolve(repo, "evidence/fable/run5");
if (!LOOPBACK_RPC.test(RPC)) throw new Error("E2E only runs against a loopback RPC");
for (const index of [OWNER_INDEX, OPERATOR_INDEX]) if (!(index >= 3 && index <= 9)) throw new Error("Use accounts #3-#9 only");
if (OWNER_INDEX === OPERATOR_INDEX) throw new Error("Owner and operator must differ");
if ((await jsonRpc(RPC, "eth_chainId")) !== "0x7a69") throw new Error("Expected chain 31337");
const metadata = await jsonRpc(RPC, "anvil_metadata");
if (metadata.instanceId.toLowerCase() !== M.anvil.instanceId.toLowerCase()) throw new Error("This is not the Anvil instance the local v2 manifest was written for");
const accounts = await jsonRpc(RPC, "eth_accounts");
const owner = accounts[OWNER_INDEX];
const operator = accounts[OPERATOR_INDEX];
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
const COL = M.lendingMarket.collateralAsset;
const E18 = 10n ** 18n;
const E6 = 10n ** 6n;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", reducedMotion: "reduce" });
const { sent } = await installTestWallet(context, { rpcUrl: RPC, account: owner, walletChainId: "0x7a69" });
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
  await page.locator('[data-testid="v2-verify"][data-state="ok"]').waitFor({ timeout: 30000 });
  assert((await page.locator('[data-testid="v2-owner"]').getAttribute("data-chain")) === "31337", "the owner flows are not on the local chain");
  assert(/Local/.test(await page.locator('[data-testid="network-pill"]:visible').first().innerText()), "the page is not labelled as the local chain");
  const base = page.locator('[data-testid="v2-base"]');

  /* ---------- base account ---------- */
  let account = await read(M.contracts.factory, FACTORY, "accountOf", [owner]);
  if (account === zeroAddress) {
    await shot("01-no-account");
    await transact(base, page.locator('[data-testid="v2-create-base"]'), "create v2 account", async () => {
      account = await read(M.contracts.factory, FACTORY, "accountOf", [owner]);
      assert(account !== zeroAddress && same(await read(account, ACCOUNT, "owner"), owner), "the factory does not map the wallet to an account it owns");
      assert(same(await read(account, ACCOUNT, "swapAdapter"), M.contracts.swap) && same(await read(account, ACCOUNT, "lendingAdapter"), M.contracts.lending) && same(await read(account, ACCOUNT, "controller"), M.lendingMarket.controller) && same(await read(account, ACCOUNT, "policyId"), M.m4.accountPolicy), "the new account's bindings differ from the manifest");
      return `accountOf(owner) = ${account}, owner() = wallet, adapters, controller and policy as in the manifest`;
    });
  } else steps.push({ label: "create v2 account", skipped: `already exists: ${account}` });
  await page.locator(`[data-testid="v2-base"][data-account="${account}"]`).waitFor({ timeout: 20000 });

  const wokbBefore = await balance(WOKB, account);
  await transact(base, page.locator('[data-testid="v2-mint-wokb"]'), "mint 1 mWOKB to the account", async () => {
    assert((await balance(WOKB, account)) === wokbBefore + E18, "the account did not receive 1 mWOKB");
    return `account mWOKB ${wokbBefore} -> ${wokbBefore + E18}`;
  });
  const colBefore = await balance(COL, account);
  await transact(base, page.locator('[data-testid="v2-mint-collateral"]'), "mint 1 mCOL to the account", async () => {
    assert((await balance(COL, account)) === colBefore + E18, "the account did not receive 1 mCOL");
    return `account mCOL ${colBefore} -> ${colBefore + E18}`;
  });
  const [sharesBefore] = await read(account, ACCOUNT, "exposure");
  const pTokenBefore = await balance(M.lendingMarket.collateralMarket, account);
  await page.locator('[data-testid="v2-supply-amount"]').fill("1");
  await transact(base, page.locator('[data-testid="v2-supply-submit"]'), "supply 1 mCOL through the lending adapter", async () => {
    const [sharesAfter, debt] = await read(account, ACCOUNT, "exposure");
    const pTokenAfter = await balance(M.lendingMarket.collateralMarket, account);
    assert(sharesAfter > sharesBefore && pTokenAfter > pTokenBefore && (await balance(COL, account)) === colBefore, "the supply did not move 1 mCOL into the acceptance book");
    assert((await read(COL, erc20Abi, "allowance", [account, M.lendingMarket.collateralMarket])) === 0n, "an allowance to the book was left behind");
    return `exposure shares ${sharesBefore} -> ${sharesAfter}, debt ${debt}, pTokens ${pTokenBefore} -> ${pTokenAfter}, allowance to the book 0`;
  });
  await shot("02-account-funded-and-supplied");

  /* ---------- grant, operator swap (script-sent), revoke-all ---------- */
  await page.locator('[data-testid="v2-grant-operator"]').fill(operator);
  await page.locator('[data-testid="v2-grant-percall"]').fill("1");
  await page.locator('[data-testid="v2-grant-total"]').fill("2");
  await page.locator('[data-testid="v2-grant-lifetime"]').selectOption("86400");
  await transact(base, page.locator('[data-testid="v2-grant-submit"]'), "swap-only grant: 1 mWOKB per swap, 2 in total, 1 day", async (tx, receipt) => {
    const [perCall, remaining, expiry] = await read(account, ACCOUNT, "grants", [operator, M.contracts.swap, 5, WOKB]);
    const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
    assert(perCall === E18 && remaining === 2n * E18 && BigInt(expiry) > block.timestamp && BigInt(expiry) <= block.timestamp + 86400n, `grant on chain is ${perCall}, ${remaining}, ${expiry}`);
    assert((await read(account, ACCOUNT, "operatorCount")) === 1n && same(await read(account, ACCOUNT, "operatorAt", [0n]), operator), "the account does not list exactly this operator");
    return `grants(operator, swap, 5, mWOKB) = (1e18, 2e18, ${expiry}); operatorCount 1`;
  });
  await page.locator(`[data-testid="v2-grants"] li[data-remaining="${2n * E18}"]`).waitFor({ timeout: 20000 });
  await go("/strategies");
  const row = page.locator(`[data-active-strategy^="v2:${account}"]`);
  await row.waitFor({ timeout: 20000 });
  assert((await row.getAttribute("data-budget-left")) === String(2n * E18) && /Restricted agent swap/.test(await row.innerText()), "Strategies does not list the grant as an active strategy with its budget");
  await shot("03-strategies-lists-the-v2-grant");

  // The operator's own transaction: sent by this script, not by the app.
  const wallet = createWalletClient({ account: operator, transport: http(RPC) });
  // Minimum output 1% under the adapter's expected output: the most the execution circuit accepts (inclusive 100 bps).
  const [expectedOut] = await read(M.contracts.swap, SWAP, "executionQuote", [WOKB, E18 / 4n]);
  const floorOut = (expectedOut * 9900n) / 10000n;
  const wouldRevert = await revertName(operator, account, ACCOUNT, "swapExactIn", [WOKB, E18 / 4n, floorOut, (await chain.getBlock()).timestamp + 1200n]);
  assert(wouldRevert === null, `the operator's swap would revert with ${wouldRevert}`);
  const usdcBefore = await balance(USDC, account);
  const deadline = (await chain.getBlock()).timestamp + 1200n;
  const swapHash = await wallet.writeContract({ chain: null, address: account, abi: ACCOUNT, functionName: "swapExactIn", args: [WOKB, E18 / 4n, floorOut, deadline], gas: 1_500_000n });
  const swapReceipt = await chain.waitForTransactionReceipt({ hash: swapHash });
  assert(swapReceipt.status === "success", "the operator's swap reverted");
  const [, remainingAfter] = await read(account, ACCOUNT, "grants", [operator, M.contracts.swap, 5, WOKB]);
  const usdcAfter = await balance(USDC, account);
  assert(remainingAfter === (7n * E18) / 4n && usdcAfter - usdcBefore >= floorOut && (await balance(USDC, operator)) === 0n, "the operator's swap did not settle to the account inside the grant");
  scriptSent.push({ label: "operator swap 0.25 mWOKB (sent by this script from the operator account, NOT by the app)", hash: swapHash, from: operator, block: swapReceipt.blockNumber.toString(), minOut: floorOut.toString(), received: (usdcAfter - usdcBefore).toString(), grantRemaining: remainingAfter.toString() });
  console.log(`operator swap (script-sent): ${swapHash} | account +${usdcAfter - usdcBefore} raw mUSDC, grant left ${remainingAfter}`);

  await go("/trade");
  await page.locator(`[data-testid="v2-grants"] li[data-remaining="${remainingAfter}"]`).waitFor({ timeout: 20000 });
  const stop = page.locator('[data-testid="v2-emergency-stop"]');
  assert((await stop.getAttribute("data-operators")) === "1", "the stop card does not list the operator");
  await transact(stop, page.locator('[data-testid="v2-stop-submit"]'), "revoke all operators", async () => {
    const grant = await read(account, ACCOUNT, "grants", [operator, M.contracts.swap, 5, WOKB]);
    assert((await read(account, ACCOUNT, "operatorCount")) === 0n && grant.every((value) => BigInt(value) === 0n), "operators or the grant remain after revoke-all");
    const refused = await revertName(operator, account, ACCOUNT, "swapExactIn", [WOKB, E18 / 4n, floorOut, deadline]);
    assert(refused === "OperatorNotAuthorized", `the operator's swap after the stop simulates as ${refused}`);
    return "operatorCount 0, grant (0,0,0); the same operator swap now simulates OperatorNotAuthorized";
  });
  await page.locator('[data-testid="v2-grants-empty"]').waitFor({ timeout: 20000 });
  await shot("04-after-revoke-all");

  /* ---------- vault sibling ---------- */
  const vault = page.locator('[data-testid="vault-card"]');
  let vaultAccount = await read(V.contracts.vaultFactory, VAULT_FACTORY, "accountOf", [owner]);
  if (vaultAccount === zeroAddress) {
    await transact(vault, page.locator('[data-testid="vault-create"]'), "create vault account", async () => {
      vaultAccount = await read(V.contracts.vaultFactory, VAULT_FACTORY, "accountOf", [owner]);
      assert(vaultAccount !== zeroAddress && same(await read(vaultAccount, VAULT_ACCOUNT, "owner"), owner) && same(await read(vaultAccount, VAULT_ACCOUNT, "vaultAdapter"), V.contracts.vaultAdapter) && same(await read(vaultAccount, VAULT_ACCOUNT, "vault"), V.contracts.mockVault), "the vault account's owner or bindings are wrong");
      assert(!same(vaultAccount, account), "the vault account is the base account");
      return `vault accountOf(owner) = ${vaultAccount}, owner() = wallet, adapter and vault as in the manifest`;
    });
  } else steps.push({ label: "create vault account", skipped: `already exists: ${vaultAccount}` });
  await page.locator(`[data-testid="vault-card"][data-account="${vaultAccount}"]`).waitFor({ timeout: 20000 });
  const idle0 = await balance(USDC, vaultAccount);
  await transact(vault, page.locator('[data-testid="vault-mint"]'), "mint 12 mUSDC to the vault account", async () => {
    assert((await balance(USDC, vaultAccount)) === idle0 + 12n * E6, "the vault account did not receive 12 mUSDC");
    return `idle mUSDC ${idle0} -> ${idle0 + 12n * E6}`;
  });
  await page.locator('[data-testid="vault-limit-cap"]').fill("1000");
  await page.locator('[data-testid="vault-limit-floor"]').fill("1");
  await transact(vault, page.locator('[data-testid="vault-limits-submit"]'), "set vault deposit limits: cap 1000 mUSDC, floor 1 share per asset", async () => {
    const [cap, floor] = await Promise.all([read(vaultAccount, VAULT_ACCOUNT, "maxVaultPositionAssets"), read(vaultAccount, VAULT_ACCOUNT, "minVaultSharesPerAssetWad")]);
    assert(cap === 1000n * E6 && floor === E18, `limits on chain are ${cap}, ${floor}`);
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
  await vaultAction("deposit", "10", "depositToVault", ({ shownQuote, shownBound, sharesBefore, sharesAfter, idleBefore, idleAfter, input }) => {
    assert(input === 10n * E6 && idleBefore - idleAfter === 10n * E6 && sharesAfter - sharesBefore >= shownBound && shownBound <= shownQuote, "the deposit did not respect its minimum shares");
    return `assets 10000000 in, shares +${sharesAfter - sharesBefore} (minimum ${shownBound}, quote ${shownQuote})`;
  });
  await vaultAction("withdraw", "2", "withdrawFromVault", ({ shownQuote, shownBound, sharesBefore, sharesAfter, idleBefore, idleAfter, input }) => {
    assert(input === 2n * E6 && idleAfter - idleBefore === 2n * E6 && sharesBefore - sharesAfter <= shownBound && shownBound >= shownQuote, "the withdrawal burned more than its maximum shares");
    return `assets 2000000 out, shares -${sharesBefore - sharesAfter} (maximum ${shownBound}, quote ${shownQuote})`;
  });
  await vaultAction("redeem", "4", "redeemFromVault", ({ shownQuote, shownBound, sharesBefore, sharesAfter, idleBefore, idleAfter, input }) => {
    assert(input === 4n * E6 && sharesBefore - sharesAfter === 4n * E6 && idleAfter - idleBefore >= shownBound && shownBound <= shownQuote, "the redemption paid less than its minimum assets");
    return `shares 4000000 in, assets +${idleAfter - idleBefore} (minimum ${shownBound}, quote ${shownQuote})`;
  });
  await shot("05-vault-after-deposit-withdraw-redeem");

  // A bound the vault cannot meet is refused in simulation; nothing is sent. Asked of the chain directly, as the owner.
  const impossible = await revertName(owner, vaultAccount, VAULT_ACCOUNT, "redeemFromVault", [E6, 10n * E6, (await chain.getBlock()).timestamp + 1200n]);
  assert(impossible !== null, "a redemption with an impossible minimum would have been accepted");
  steps.push({ label: "redeem 1 share with a minimum of 10 mUSDC (eth_call as the owner, nothing sent)", revertsWith: impossible });
} catch (error) {
  failure = String(error?.message ?? error);
  await shot("zz-failure").catch(() => {});
}

const endBlock = Number(await jsonRpc(RPC, "eth_blockNumber"));
const file = `${OUT}/local-v2-vault-${RUN_ID}.json`;
writeFileSync(
  file,
  `${JSON.stringify(
    {
      label: "LOCAL development chain (unforked Anvil 31337). Mock tokens, fixed simulated prices, inventory-backed mock venue, mock ERC-4626 vault, development reference processor. Not public transactions.",
      driver: "Playwright Chromium + injected test EIP-1193 provider forwarding to Anvil's unlocked account; no private key",
      rpc: RPC,
      chainId: 31337,
      nodeInstanceId: metadata.instanceId,
      runId: RUN_ID,
      owner,
      ownerIndex: OWNER_INDEX,
      operator,
      operatorIndex: OPERATOR_INDEX,
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
console.log(`${failure ? `E2E FAILED: ${failure}\n` : "E2E passed. "}${sent.length} app transactions, ${scriptSent.length} script transaction(s), ${problems.length} page problem(s). Evidence: ${file}, screenshots: ${SHOTS}`);
process.exit(failure || problems.length ? 1 : 0);

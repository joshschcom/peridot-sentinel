// Local wallet E2E against the shared development chain (Anvil 31337, development reference processor).
//   Server: NEXT_PUBLIC_PERIDOT_TARGET=local next dev -p 3211
//   Run:    PLAYWRIGHT_BROWSERS_PATH=0 node scripts/e2e-local.mjs
// The "wallet" is a test-only EIP-1193 provider injected into the page. It forwards to the loopback RPC and
// lets Anvil sign with one of its unlocked accounts: there is no private key anywhere in this repo.
// It refuses to run against anything but a loopback RPC on chain 31337.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createPublicClient, http, parseAbi } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:18545";
const MARKET_FACTORY = JSON.parse(readFileSync(resolve(here, "../../../packages/chain-config/deployments/31337.json"), "utf8")).contracts.MarketFactory;
const ACCOUNT_INDEX = Number(process.env.E2E_ACCOUNT_INDEX ?? 3); // not #0 (deployer/demo owner), not #1 (keeper operator)
const ACTIVITY_ONLY = process.argv.includes("--activity-only"); // read-only: loads the activity view, sends nothing
// Evidence is run-scoped so a later run (for example after the shared node is redeployed) never overwrites it.
const RUN_ID = `run-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
const SHOTS = resolve(here, "../../../evidence/screenshots/local-e2e", ACTIVITY_ONLY ? "activity-only" : RUN_ID);
const OUT = resolve(here, "../../../evidence/fable");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(RPC)) throw new Error("E2E only runs against a loopback RPC");
if (ACCOUNT_INDEX < 2) throw new Error("Use a dedicated account (index >= 2)");

const rpc = async (method, params = []) => {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
};
const chainId = await rpc("eth_chainId");
if (chainId !== "0x7a69") throw new Error(`Expected chain 31337, got ${chainId}`);
const account = (await rpc("eth_accounts"))[ACCOUNT_INDEX];
const startBlock = Number(await rpc("eth_blockNumber"));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const sent = [];
const steps = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", reducedMotion: "reduce" });
await context.exposeBinding("__recordTx", (_source, tx) => sent.push(tx));
await context.addInitScript(
  ({ RPC, account, chainId }) => {
    let id = 0;
    const call = async (method, params) => {
      const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
      const json = await response.json();
      if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data });
      return json.result;
    };
    const listeners = {};
    window.ethereum = {
      isPeridotTestProvider: true,
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
        if (method === "eth_chainId") return chainId;
        if (method === "net_version") return String(parseInt(chainId, 16));
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
        if (method === "wallet_revokePermissions") return null;
        if (method === "eth_sendTransaction") {
          const tx = { ...params[0], from: account };
          const hash = await call(method, [tx]);
          window.__recordTx({ hash, to: tx.to, selector: (tx.data ?? "0x").slice(0, 10) });
          return hash;
        }
        return call(method, params);
      },
      on: (event, handler) => void (listeners[event] ??= []).push(handler),
      removeListener: (event, handler) => void (listeners[event] = (listeners[event] ?? []).filter((entry) => entry !== handler)),
    };
  },
  { RPC, account, chainId },
);

const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${String(error).slice(0, 300)}`));
page.on("console", (message) => message.type() === "error" && !/Failed to load resource/.test(message.text()) && problems.push(`console: ${message.text().slice(0, 300)}`));

const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const record = (label, before, extra = {}) => {
  const txs = sent.slice(before).map((tx) => tx.hash);
  steps.push({ label, txs, ...extra });
  console.log(`${label}: ${txs.length} tx ${txs.join(" ")}`);
};
const connect = async () => {
  if (await page.locator('[data-testid="wallet-connected"]:visible').count()) return;
  await page.locator('[data-testid="wallet-connect"]:visible').first().click();
  await page.locator("dialog[open] ul button").first().click();
  await page.locator('[data-testid="wallet-connected"]:visible').first().waitFor({ timeout: 15000 });
};
const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await connect();
  await page.waitForTimeout(600);
};
/** Clicks a button that starts a transaction plan and waits for its confirmed result inside `scope`. */
const transact = async (scope, button, label, expectTx = 1) => {
  const before = sent.length;
  await button.click();
  const outcome = scope.locator('[data-testid="tx-success"], [data-rejection]').last();
  await page.waitForFunction((count) => window.__e2eSent?.() >= count, before + expectTx, { timeout: 100 }).catch(() => {});
  const deadline = Date.now() + 60000;
  while (sent.length < before + expectTx && Date.now() < deadline) await page.waitForTimeout(250);
  await scope.locator('[data-testid="tx-success"]').waitFor({ timeout: 60000 }).catch(async () => {
    throw new Error(`${label}: no confirmed result. Visible: ${(await scope.locator('[data-testid="tx-feedback"]').innerText().catch(() => "no feedback")).slice(0, 400)}`);
  });
  void outcome;
  record(label, before);
};

try {
  // 0. The displayed borrow rate of market #0 must equal ratePerBlock x blocksPerYear() read from chain right now.
  const chain = createPublicClient({ transport: http(RPC) });
  const rateAbi = parseAbi(["function marketAt(uint256) view returns (address)", "function debtMarket() view returns (address)", "function borrowRatePerBlock() view returns (uint256)", "function interestRateModel() view returns (address)", "function blocksPerYear() view returns (uint256)"]);
  const controller0 = await chain.readContract({ address: MARKET_FACTORY, abi: rateAbi, functionName: "marketAt", args: [0n] });
  const debt0 = await chain.readContract({ address: controller0, abi: rateAbi, functionName: "debtMarket" });
  const perBlock = await chain.readContract({ address: debt0, abi: rateAbi, functionName: "borrowRatePerBlock" });
  const blocksPerYear = await chain.readContract({ address: await chain.readContract({ address: debt0, abi: rateAbi, functionName: "interestRateModel" }), abi: rateAbi, functionName: "blocksPerYear" });
  const expectedBps = (perBlock * blocksPerYear * 10000n) / 10n ** 18n;
  const expectedText = `${(Number(expectedBps) / 100).toFixed(2).replace(/\.?0+$/, "")}% APR`;
  await go("/markets");
  const shownRate = (await page.locator("main li").first().locator("dd").nth(2).innerText()).trim();
  console.log(`market #0 borrow rate: shown "${shownRate}", on-chain ${perBlock} x ${blocksPerYear} blocks/yr = ${expectedBps} bps ("${expectedText}")`);
  if (shownRate !== expectedText) throw new Error(`Displayed borrow rate ${shownRate} does not match the on-chain rate ${expectedText}`);
  steps.push({ label: "rate display check (read-only)", txs: [], shown: shownRate, ratePerBlock: perBlock.toString(), blocksPerYear: blocksPerYear.toString(), expectedBps: expectedBps.toString() });

  let marketId = null;
  let sentinelRejection = "account-policy";
  let marketRejection = "market-policy";
  if (!ACTIVITY_ONLY) {
  // 1. Studio: create a market with a new policy threshold (55%, reserve on): circuit -> register -> create.
  await go("/studio/create");
  if ((await page.locator('[data-testid="fixture-banner"]').count()) !== 0) throw new Error("App is in fixture mode: start the server with NEXT_PUBLIC_PERIDOT_TARGET=local");
  if (!(await page.locator('[data-testid="network-pill"]:visible').first().innerText()).includes("Local development chain")) throw new Error("Network label is not 'Local development chain'");
  await page.getByLabel("Cash reserve").fill("10");
  await page.locator('[data-testid="wizard-next"]').click();
  await page.getByRole("radio", { name: /Custom/ }).click();
  // Policy cap 55% with a 70% borrowing limit and 80% liquidation: a threshold the demo deployment has not registered.
  await page.locator("#cap").fill("5500");
  await page.locator("#borrow").fill("7000");
  await page.locator("#liq").fill("8000");
  await page.locator('[data-testid="wizard-next"]').click();
  await page.getByText("Roots match").waitFor({ timeout: 15000 });
  await shot("01-studio-circuit-step");
  await page.locator('[data-testid="wizard-next"]').click();
  const wizard = page.locator("main");
  await transact(wizard, page.locator('[data-testid="create-market"]'), "studio: (circuit on processor, register market template when the policy is new) + create market", 1);
  await shot("02-studio-market-created");
  await page.locator('[data-testid="open-created-market"]').click();
  await page.waitForURL(/\/studio\/0x[0-9a-fA-F]{40}$/);
  marketId = page.url().split("/").pop();
  console.log("market", marketId);

  // 2. Seed lending liquidity directly from the wallet, then activate as the owner.
  await go(`/markets/${marketId}`);
  const panel = page.locator('aside [data-testid="action-panel"]');
  const amount = panel.locator('input[inputmode="decimal"]');
  const submit = panel.locator('[data-testid="submit"]');
  await transact(panel, panel.locator('[data-testid="mint-test-tokens"]'), "wallet: mint test tokens (permissionless mock tokens)", 2);
  await panel.getByRole("tab", { name: "Supply" }).click();
  await panel.getByRole("button", { name: /^Lend / }).click();
  await amount.fill("500");
  await panel.getByText("Before you sign").waitFor();
  await transact(panel, submit, "wallet: approve + supply 500 debt-asset liquidity (direct pToken mint)", 2);
  await shot("03-market-liquidity-supplied");

  await go(`/studio/${marketId}`);
  await transact(page.locator("main"), page.locator('[data-testid="activate-market"]'), "studio: activate market", 1);
  await shot("04-studio-market-activated");

  // 3. Sentinel: create the account, fund + supply + enable collateral, see a rejection, then borrow.
  await go("/sentinel");
  const index = await page.evaluate(async (id) => id, marketId);
  void index;
  const createButton = page.locator('[data-testid^="create-account-"]').last();
  await transact(page.locator("main"), createButton, "sentinel: create account for the new market", 1);
  await shot("05-sentinel-account-created");

  await go(`/markets/${marketId}`);
  await panel.getByRole("button", { name: /^Sentinel account/ }).click();
  await panel.getByRole("tab", { name: "Supply" }).click();
  await amount.fill("10");
  await panel.getByText("Before you sign").waitFor();
  await transact(panel, submit, "sentinel: fund account (plain transfer) + supply 10 collateral + enable collateral", 3);
  await shot("06-sentinel-collateral-supplied");

  await panel.getByRole("tab", { name: "Borrow" }).click();
  await amount.fill("9"); // 9 / (10 x 1.6) = 56.25% > 55% account cap
  await panel.locator("[data-rejection]").first().waitFor({ timeout: 20000 });
  sentinelRejection = await panel.locator("[data-rejection]").first().getAttribute("data-rejection");
  steps.push({ label: "sentinel: borrow 9 rejected in eth_call simulation (nothing sent)", txs: [], rejection: sentinelRejection });
  console.log("sentinel rejection:", sentinelRejection);
  await shot("07-sentinel-borrow-rejected-by-account-policy");
  await amount.fill("5"); // 31.25%
  await panel.getByText("Before you sign").waitFor();
  await page.waitForFunction(() => !document.querySelector('aside [data-testid="action-panel"] [data-rejection]'), null, { timeout: 20000 });
  await transact(panel, submit, "sentinel: borrow 5 (allowed by account policy and market policy)", 1);
  await shot("08-sentinel-borrow-confirmed");

  // 4. Direct path: the market policy alone rejects a wallet borrow above its 55% cap.
  await panel.getByRole("button", { name: /^Wallet/ }).click();
  await panel.getByRole("tab", { name: "Supply" }).click();
  await panel.getByRole("button", { name: /collateral$/ }).click();
  await amount.fill("10");
  await panel.getByText("Before you sign").waitFor();
  await transact(panel, submit, "wallet: approve + supply 10 collateral + enter market (direct)", 3);
  await panel.getByRole("tab", { name: "Borrow" }).click();
  await amount.fill("9");
  await panel.locator("[data-rejection]").first().waitFor({ timeout: 20000 });
  marketRejection = await panel.locator("[data-rejection]").first().getAttribute("data-rejection");
  steps.push({ label: "wallet: direct borrow 9 rejected in eth_call simulation (nothing sent)", txs: [], rejection: marketRejection });
  console.log("direct rejection:", marketRejection);
  await shot("09-direct-borrow-rejected-by-market-policy");

  }

  // 5. Activity: settled PolicyAllowed decisions with their transaction hashes.
  await go("/sentinel/activity");
  await page.locator("li[data-result]").first().waitFor({ timeout: 20000 });
  const activity = await page.locator("li[data-result]").allInnerTexts();
  const blocks = activity.map((text) => Number(/block (\d+)\./.exec(text)?.[1] ?? -1));
  if (blocks.some((block, index) => index > 0 && block > blocks[index - 1])) throw new Error(`Activity is not newest-first: ${blocks.join(",")}`);
  if (ACTIVITY_ONLY) {
    await shot("10-sentinel-activity");
    console.log(`activity view: ${activity.length} entries, newest first (blocks ${blocks.join(",")}); nothing sent (${sent.length} tx)`);
    await browser.close();
    process.exit(sent.length === 0 && problems.length === 0 ? 0 : 1);
  }
  steps.push({ label: "activity view", txs: [], entries: activity.length });
  await shot("10-sentinel-activity");
  await go("/sentinel");
  await shot("11-sentinel-overview");

  const receipts = await Promise.all(sent.map(async (tx) => {
    const receipt = await rpc("eth_getTransactionReceipt", [tx.hash]);
    return { hash: tx.hash, to: tx.to, selector: tx.selector, block: Number(receipt.blockNumber), status: receipt.status === "0x1" ? "success" : "reverted", gasUsed: Number(receipt.gasUsed) };
  }));
  const evidence = {
    label: "Local development chain (unforked Anvil 31337) with the development reference processor. Not TapeOut, not a public transaction: these hashes exist only on this local node and must never be linked to an explorer.",
    driver: "apps/web/scripts/e2e-local.mjs: real browser (Playwright Chromium), the app's own wagmi wallet path, test-only injected EIP-1193 provider forwarding to Anvil's unlocked account",
    rpc: RPC,
    chainId: 31337,
    runId: RUN_ID,
    account,
    accountIndex: ACCOUNT_INDEX,
    startBlock,
    endBlock: Number(await rpc("eth_blockNumber")),
    market: marketId,
    steps,
    receipts,
    activityEntriesShown: activity.length,
    pageProblems: problems,
  };
  writeFileSync(`${OUT}/local-e2e-${RUN_ID}.json`, JSON.stringify(evidence, null, 2) + "\n");
  const failed = receipts.filter((receipt) => receipt.status !== "success");
  console.log(`\n${receipts.length} transactions, ${failed.length} reverted, ${problems.length} page problem(s). Evidence: evidence/fable/local-e2e-${RUN_ID}.json, screenshots: evidence/screenshots/local-e2e/${RUN_ID}/`);
  if (failed.length || sentinelRejection !== "account-policy" || marketRejection !== "market-policy" || activity.length === 0) process.exitCode = 1;
} catch (error) {
  console.error("E2E FAILED:", error.message);
  for (const problem of problems.slice(0, 8)) console.error(" ", problem);
  await page.screenshot({ path: `${SHOTS}/zz-failure.png`, fullPage: true }).catch(() => {});
  console.error("sent so far:", JSON.stringify(sent));
  process.exitCode = 1;
} finally {
  await browser.close();
}

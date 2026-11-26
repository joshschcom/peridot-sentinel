// Local wallet E2E against the shared development chain (Anvil 31337, development reference processor).
//   Server: KEEPER_API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_PERIDOT_TARGET=local npm run dev -- -p 3211 -H 127.0.0.1
//   Run:    PLAYWRIGHT_BROWSERS_PATH=0 node scripts/e2e-local.mjs [--activity-only] [--stop-after=<stage>]
// The "wallet" is a test-only EIP-1193 provider (scripts/lib/test-wallet.mjs). It forwards to the loopback RPC and
// lets Anvil sign with one of its unlocked accounts: there is no private key anywhere in this repo.
// It refuses to run against anything but a loopback RPC on chain 31337, and only with accounts #3-#9.
//
// The run is resumable: every stage first reads the chain and skips what already exists (markets are found by
// owner + policy, accounts through the factory), so a failed run does not leave a new pair of markets behind.
// After every write the script reads the chain itself and asserts the new state; a green toast is not evidence.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IsolatedControllerAbi, MarketFactoryAbi, MarketPTokenAbi, PolicyRegistryAbi, SentinelAccountAbi, SentinelAccountFactoryAbi, TapeOutPolicyAdapterAbi, TestnetOracleAbi, TestnetTokenAbi, DemoRateModelAbi } from "@peridot/chain-config";
import { studioMarketTemplate } from "@peridot/circuit-sdk";
import { chromium } from "playwright";
import { BaseError, ContractFunctionRevertedError, createPublicClient, http, parseEventLogs, zeroAddress } from "viem";
import { LOOPBACK_RPC, connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:18545";
const MANIFEST = JSON.parse(readFileSync(resolve(here, "../../../packages/chain-config/deployments/31337.json"), "utf8"));
const C = MANIFEST.contracts;
const OWNER_INDEX = Number(process.env.E2E_ACCOUNT_INDEX ?? 4); // never #0 (deployer/demo owner) or #1 (keeper operator)
const OPERATOR_INDEX = Number(process.env.E2E_OPERATOR_INDEX ?? 5); // an address only: it never signs anything
const ACTIVITY_ONLY = process.argv.includes("--activity-only"); // read-only: loads the activity view, sends nothing
const KEEPER_URL = process.env.KEEPER_URL === "" ? null : (process.env.KEEPER_URL ?? "http://127.0.0.1:8787"); // read directly only to compare with what the app shows
const STOP_AFTER = process.argv.find((arg) => arg.startsWith("--stop-after="))?.slice(13) ?? null;
// Evidence is run-scoped so a later run (for example after the shared node is redeployed) never overwrites it.
const RUN_ID = `run-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
const SHOTS = resolve(here, "../../../evidence/screenshots/local-e2e", ACTIVITY_ONLY ? `activity-only-${RUN_ID}` : RUN_ID);
const OUT = resolve(here, "../../../evidence/fable");
if (!LOOPBACK_RPC.test(RPC)) throw new Error("E2E only runs against a loopback RPC");
for (const index of [OWNER_INDEX, OPERATOR_INDEX]) if (!(index >= 3 && index <= 9)) throw new Error("Use accounts #3-#9 only");
if (OWNER_INDEX === OPERATOR_INDEX) throw new Error("Owner and operator must differ");

const chainId = await jsonRpc(RPC, "eth_chainId");
if (chainId !== "0x7a69") throw new Error(`Expected chain 31337, got ${chainId}`);
const accounts = await jsonRpc(RPC, "eth_accounts");
const account = accounts[OWNER_INDEX];
const operator = accounts[OPERATOR_INDEX];
const startBlock = Number(await jsonRpc(RPC, "eth_blockNumber"));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const chain = createPublicClient({ transport: http(RPC) });
const read = (address, abi, functionName, args = []) => chain.readContract({ address, abi, functionName, args });
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const WAD = 10n ** 18n;
const USD = (whole) => BigInt(Math.round(whole * 1e6)); // mUSD has 6 decimals; only used for round test amounts
const fmtUsd = (raw) => `${raw / 1_000_000n}.${String(raw % 1_000_000n).padStart(6, "0")}`.replace(/\.?0+$/, "");

/** Name of the custom error an eth_call of this entrypoint reverts with, or null if it would succeed. Nothing is sent. */
async function revertName(from, address, abi, functionName, args) {
  try {
    await chain.simulateContract({ account: from, address, abi: [...abi, ...IsolatedControllerAbi.filter((i) => i.type === "error"), ...TapeOutPolicyAdapterAbi.filter((i) => i.type === "error"), ...PolicyRegistryAbi.filter((i) => i.type === "error")], functionName, args });
    return null;
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
    return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? `unknown(${revert.raw ?? ""})`) : `non-revert: ${String(error).slice(0, 120)}`;
  }
}

const steps = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", reducedMotion: "reduce" });
const { sent } = await installTestWallet(context, { rpcUrl: RPC, account, walletChainId: chainId, readOnly: ACTIVITY_ONLY });
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
  console.log(`${label}: ${txs.length} tx ${txs.join(" ")}${extra.asserted ? ` | on chain: ${extra.asserted}` : ""}`);
  return txs;
};
const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await connectWallet(page);
  await page.waitForFunction(() => !document.querySelector("[data-loading]"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
};
/**
 * Clicks a button that starts a transaction plan and waits for THIS run's confirmed result inside `scope`.
 * Then `verify` reads the chain and returns a short description of what it asserted.
 */
const transact = async (scope, button, label, verify) => {
  const before = sent.length;
  await scope.locator('[data-testid="tx-success"]').evaluateAll((nodes) => nodes.forEach((node) => node.setAttribute("data-stale", "1")));
  await button.click();
  const done = scope.locator('[data-testid="tx-success"]:not([data-stale]), [data-testid="tx-feedback"] [data-rejection]').first();
  await done.waitFor({ timeout: 90000 }).catch(async () => {
    throw new Error(`${label}: no result. Visible: ${(await scope.locator('[data-testid="tx-feedback"]').innerText().catch(() => "no feedback")).slice(0, 400)}`);
  });
  if ((await done.getAttribute("data-rejection")) !== null) throw new Error(`${label}: failed in the app: ${(await done.innerText()).slice(0, 300)}`);
  const shownHash = await done.getAttribute("data-hash");
  const txs = sent.slice(before).map((tx) => tx.hash);
  if (txs.length) assert(shownHash === txs.at(-1), `${label}: the confirmed hash shown (${shownHash}) is not the last hash sent (${txs.at(-1)})`);
  for (const hash of txs) assert((await chain.getTransactionReceipt({ hash })).status === "success", `${label}: ${hash} did not succeed`);
  const asserted = verify ? await verify(txs) : undefined;
  record(label, before, asserted ? { asserted } : {});
  return txs;
};

/* ---------- chain state helpers ---------- */

const registry = C.PolicyRegistry;
async function findMarket(capBps) {
  const configHash = studioMarketTemplate(capBps, true).compiled.configHash;
  const count = Number(await read(C.MarketFactory, MarketFactoryAbi, "marketCount"));
  let found = null;
  for (let index = 0; index < count; index++) {
    const controller = await read(C.MarketFactory, MarketFactoryAbi, "marketAt", [BigInt(index)]);
    if (!same(await read(controller, IsolatedControllerAbi, "owner"), account)) continue;
    const entry = await read(registry, PolicyRegistryAbi, "getPolicy", [await read(controller, IsolatedControllerAbi, "policyId")]);
    if (same(entry.configHash, configHash)) found = controller;
  }
  return found;
}
async function marketState(controller) {
  const [active, collateralMarket, debtMarket, collateralAsset, debtAsset, policyId] = await Promise.all(
    ["active", "collateralMarket", "debtMarket", "collateralAsset", "debtAsset", "policyId"].map((name) => read(controller, IsolatedControllerAbi, name)),
  );
  const sentinel = await read(C.SentinelAccountFactory, SentinelAccountFactoryAbi, "accountOf", [account, controller]);
  const holder = sentinel === zeroAddress ? null : sentinel;
  const [lentShares, walletCollateral, walletDebtAsset, walletCollateralShares] = await Promise.all([
    read(debtMarket, MarketPTokenAbi, "balanceOf", [account]),
    read(collateralAsset, TestnetTokenAbi, "balanceOf", [account]),
    read(debtAsset, TestnetTokenAbi, "balanceOf", [account]),
    read(collateralMarket, MarketPTokenAbi, "balanceOf", [account]),
  ]);
  const s = holder
    ? await Promise.all([
        read(collateralMarket, MarketPTokenAbi, "balanceOf", [holder]),
        read(collateralMarket, MarketPTokenAbi, "exchangeRateStored"),
        read(debtMarket, MarketPTokenAbi, "borrowBalanceStored", [holder]),
        read(debtAsset, TestnetTokenAbi, "balanceOf", [holder]),
        read(collateralAsset, TestnetTokenAbi, "balanceOf", [holder]),
        read(controller, IsolatedControllerAbi, "collateralEntered", [holder]),
        read(holder, SentinelAccountAbi, "policyId"),
        read(holder, SentinelAccountAbi, "autoRepayTriggerBps"),
      ])
    : null;
  return {
    controller, active, collateralMarket, debtMarket, collateralAsset, debtAsset, policyId, sentinel: holder, lentShares, walletCollateral, walletDebtAsset, walletCollateralShares,
    collateralUnderlying: s ? (s[0] * s[1]) / WAD : 0n, debt: s ? s[2] : 0n, idleDebtAsset: s ? s[3] : 0n, idleCollateral: s ? s[4] : 0n, entered: s ? s[5] : false, accountPolicyId: s ? s[6] : null, trigger: s ? s[7] : 0,
  };
}

const panel = page.locator('aside [data-testid="action-panel"]');
const amount = panel.locator('input[inputmode="decimal"]');
const submit = panel.locator('[data-testid="submit"]');
const previewReady = async () => {
  await panel.getByText("Before you sign").waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
};

/** Creates (or finds) a market with this policy cap, seeds and activates it, and gives the owner a funded Sentinel account. */
async function ensureMarket(key, capBps) {
  let controller = await findMarket(capBps);
  if (!controller) {
    await go("/studio/create");
    assert((await page.locator('[data-testid="fixture-banner"]').count()) === 0, "App is in fixture mode: start the server with NEXT_PUBLIC_PERIDOT_TARGET=local");
    assert((await page.locator('[data-testid="network-pill"]:visible').first().innerText()).includes("Local development chain"), "Network label is not 'Local development chain'");
    await page.getByLabel("Cash reserve").fill("10");
    await page.locator('[data-testid="wizard-next"]').click();
    await page.getByRole("radio", { name: /Custom/ }).click();
    // The protocol borrowing limit (70%) stays above both policy caps, so the circuit is the binding rule.
    await page.locator("#cap").fill(String(capBps));
    await page.locator("#borrow").fill("7000");
    await page.locator("#liq").fill("8000");
    await page.locator('[data-testid="wizard-next"]').click();
    await page.getByText("Roots match").waitFor({ timeout: 15000 });
    if (key === "A") await shot("01-studio-circuit-step-market-A-65");
    await page.locator('[data-testid="wizard-next"]').click();
    await transact(page.locator("main"), page.locator('[data-testid="create-market"]'), `studio: market ${key} with a ${capBps / 100}% policy cap (circuit on processor + register template when the policy is new, then createMarket)`, async () => {
      controller = await findMarket(capBps);
      assert(controller, "created market not found on chain");
      const entry = await read(registry, PolicyRegistryAbi, "getPolicy", [await read(controller, IsolatedControllerAbi, "policyId")]);
      return `controller ${controller}, owner is the wallet, policy configHash == SDK template(${capBps}, reserve on), circuit #${entry.circuitId}`;
    });
    await shot(`02-studio-market-${key}-created`);
    assert(same(await page.locator('[data-testid="open-created-market"]').getAttribute("href"), `/studio/${controller}`), "the created-market link does not point at the controller found on chain");
  } else {
    console.log(`market ${key} (${capBps / 100}% cap) already exists: ${controller}`);
  }
  let state = await marketState(controller);

  if (state.lentShares === 0n) {
    await go(`/markets/${controller}`);
    if (state.walletDebtAsset < USD(600) || state.walletCollateral < 30n * WAD) {
      await transact(panel, panel.locator('[data-testid="mint-test-tokens"]'), `wallet: mint test tokens for market ${key} (permissionless mock tokens)`, async () => {
        const after = await marketState(controller);
        assert(after.walletDebtAsset >= state.walletDebtAsset + USD(1000) && after.walletCollateral >= state.walletCollateral + 1000n * WAD, "mint did not arrive");
        return "wallet +1000 mCOL, +1000 mUSD";
      });
    }
    await panel.getByRole("tab", { name: "Supply" }).click();
    await panel.getByRole("button", { name: /^Lend / }).click();
    await amount.fill("500");
    await previewReady();
    await transact(panel, submit, `wallet: approve exact amount + lend 500 mUSD to market ${key} (direct pToken mint)`, async () => {
      const cash = await read(state.debtMarket, MarketPTokenAbi, "getCash");
      assert(cash >= USD(500), `debt book cash is ${cash}`);
      assert((await read(state.debtAsset, TestnetTokenAbi, "allowance", [account, state.debtMarket])) === 0n, "allowance left over after an exact approval");
      return `debt book cash ${fmtUsd(cash)} mUSD, leftover allowance 0`;
    });
  }
  if (!state.active) {
    await go(`/studio/${controller}`);
    await transact(page.locator("main"), page.locator('[data-testid="activate-market"]'), `studio: activate market ${key}`, async () => {
      assert(await read(controller, IsolatedControllerAbi, "active"), "market is not active");
      return "controller.active() == true";
    });
    if (key === "A") await shot("03-studio-market-A-activated");
  }
  state = await marketState(controller);
  if (!state.sentinel) {
    await go("/portfolio");
    await transact(page.locator("main"), page.locator(`[data-testid="create-account-${controller}"]`), `sentinel: create account for market ${key}`, async () => {
      state = await marketState(controller);
      assert(state.sentinel, "no account from the factory");
      assert(same(await read(state.sentinel, SentinelAccountAbi, "owner"), account), "account owner is not the wallet");
      const fixture = MANIFEST.tapeout.circuits.find((circuit) => circuit.kind === "ACCOUNT").policyId;
      assert(same(state.accountPolicyId, fixture), "account policy is not the published 55% ACCOUNT policy");
      return `account ${state.sentinel}, owner is the wallet, policy = manifest ACCOUNT policy (55% cap)`;
    });
  }
  if (state.collateralUnderlying === 0n) {
    await go(`/markets/${controller}`);
    await panel.getByRole("button", { name: /^Sentinel account/ }).click();
    await panel.getByRole("tab", { name: "Supply" }).click();
    await amount.fill("10");
    await previewReady();
    await transact(panel, submit, `sentinel ${key}: fund account (plain transfer) + supply 10 mCOL + enable collateral`, async () => {
      state = await marketState(controller);
      assert(state.collateralUnderlying >= 10n * WAD - 10n && state.entered, `collateral ${state.collateralUnderlying}, entered ${state.entered}`);
      return "account holds 10 mCOL of pTokens, collateral entered";
    });
  }
  return state;
}

/**
 * Types the borrow that lands on `targetBps` and checks the "Before you sign" panel against expectations.
 * Independently of the app, the script reads previewPolicy, eth_calls the real entrypoint as the owner, and
 * eth_calls adapter.enforce for each policy on those exact inputs (read-only evaluations of the deployed circuits).
 */
async function expectRejection(key, state, targetBps, expected, shotName) {
  const before = sent.length;
  const price = (asset) => read(C.TestnetOracle, TestnetOracleAbi, "price", [asset]);
  const [[collateralPrice], [debtPrice]] = await Promise.all([price(state.collateralAsset), price(state.debtAsset)]);
  const collateralUsd = (state.collateralUnderlying * collateralPrice) / WAD; // 1e18-scaled USD
  const targetDebt = (((collateralUsd * BigInt(targetBps)) / 10_000n) * 10n ** 6n) / debtPrice; // raw mUSD (6 decimals)
  const raw = targetDebt - state.debt;
  assert(raw > 0n, `market ${key}: existing debt already above the target`);
  const [applies, fresh, postLtv, cashOk] = await read(state.controller, IsolatedControllerAbi, "previewPolicy", [state.sentinel, 2, state.debtMarket, raw]);
  const text = fmtUsd(raw);

  await go(`/markets/${state.controller}`);
  await panel.getByRole("button", { name: /^Sentinel account/ }).click();
  await panel.getByRole("tab", { name: "Borrow" }).click();
  await amount.fill(text);
  await panel.locator("[data-rejection]").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  const shown = {
    rejection: await panel.locator("[data-rejection]").first().getAttribute("data-rejection"),
    checks: Object.fromEntries(await panel.locator("li[data-check]").evaluateAll((rows) => rows.map((row) => [row.dataset.check, { status: row.dataset.status, basis: row.dataset.basis, text: row.innerText.replace(/\s+/g, " ").trim() }]))),
    otherLayer: await panel.locator('[data-testid="other-layer"]').evaluate((node) => ({ layer: node.dataset.layer, verdict: node.dataset.verdict, basis: node.dataset.basis, text: node.innerText })).catch(() => null),
    submitDisabled: await submit.isDisabled(),
  };
  const onChain = {
    previewPolicy: { applies, oracleFresh: fresh, postLtvBps: Number(postLtv), cashOk },
    entrypointRevert: await revertName(account, state.sentinel, SentinelAccountAbi, "borrow", [raw]),
    accountCircuit: (await revertName(account, C.TapeOutPolicyAdapter, TapeOutPolicyAdapterAbi, "enforce", [state.accountPolicyId, 1, 2, fresh, postLtv, cashOk])) ?? "allow",
    marketCircuit: (await revertName(account, C.TapeOutPolicyAdapter, TapeOutPolicyAdapterAbi, "enforce", [state.policyId, 0, 2, fresh, postLtv, cashOk])) ?? "allow",
  };
  await shot(shotName);
  steps.push({ label: `sentinel ${key}: borrow ${text} mUSD to ${Number(postLtv) / 100}% LTV, eth_call simulation only (nothing sent)`, txs: [], shown, onChain });
  console.log(`market ${key}: borrow ${text} -> ${Number(postLtv)} bps | app: ${shown.rejection}, account ${shown.checks["account-policy"]?.status}/${shown.checks["account-policy"]?.basis}, market ${shown.checks["market-policy"]?.status}/${shown.checks["market-policy"]?.basis} | chain: ${onChain.entrypointRevert}, account circuit ${onChain.accountCircuit}, market circuit ${onChain.marketCircuit}`);

  assert(Number(postLtv) === targetBps, `market ${key}: previewPolicy gives ${postLtv} bps, wanted ${targetBps}`);
  assert(sent.length === before, "a transaction was sent during a rejection check");
  assert(shown.submitDisabled, "the submit button is enabled although the simulation rejects");
  assert(onChain.entrypointRevert === expected.revert, `market ${key}: entrypoint reverts with ${onChain.entrypointRevert}, expected ${expected.revert}`);
  assert(shown.rejection === expected.rejection, `market ${key}: app shows ${shown.rejection}, expected ${expected.rejection}`);
  // The layer that did not reject must really allow these inputs on chain, not only in the app's wording.
  assert(onChain[expected.otherCircuit] === "allow", `market ${key}: the ${expected.otherCircuit} does not allow on chain (${onChain[expected.otherCircuit]})`);
  assert(onChain[expected.rejectingCircuit] === expected.revert, `market ${key}: the ${expected.rejectingCircuit} does not deny on chain (${onChain[expected.rejectingCircuit]})`);
  for (const [id, want] of Object.entries(expected.checks)) {
    const got = shown.checks[id];
    assert(got && got.status === want.status && got.basis === want.basis, `market ${key}: check "${id}" is ${got?.status}/${got?.basis}, expected ${want.status}/${want.basis}`);
    if (want.text) assert(want.text.test(got.text), `market ${key}: check "${id}" text does not match ${want.text}: "${got.text}"`);
  }
  assert(shown.otherLayer && shown.otherLayer.layer === expected.other.layer && shown.otherLayer.basis === expected.other.basis && shown.otherLayer.verdict === "allow", `market ${key}: other-layer note is ${JSON.stringify(shown.otherLayer)}`);
}

let markets = { A: null, B: null };
async function writeEvidence({ A, B, activityEntries, stoppedAfter }) {
  const receipts = await Promise.all(sent.map(async (tx) => {
    const receipt = await jsonRpc(RPC, "eth_getTransactionReceipt", [tx.hash]);
    return { hash: tx.hash, to: tx.to, selector: tx.selector, block: Number(receipt.blockNumber), status: receipt.status === "0x1" ? "success" : "reverted", gasUsed: Number(receipt.gasUsed) };
  }));
  const evidence = {
    label: "Local development chain (unforked Anvil 31337) with the development reference processor. Not TapeOut, not a public transaction: these hashes exist only on this local node and must never be linked to an explorer.",
    driver: "apps/web/scripts/e2e-local.mjs: real browser (Playwright Chromium), the app's own wagmi wallet path, test-only injected EIP-1193 provider forwarding to Anvil's unlocked account",
    rpc: RPC,
    chainId: 31337,
    nodeInstanceId: (await jsonRpc(RPC, "anvil_metadata")).instanceId,
    manifestCommit: MANIFEST.commit,
    runId: RUN_ID,
    account,
    accountIndex: OWNER_INDEX,
    operator,
    operatorIndex: OPERATOR_INDEX,
    startBlock,
    endBlock: Number(await jsonRpc(RPC, "eth_blockNumber")),
    markets: { A: A ? { controller: A.controller, policyCapBps: 6500, sentinel: A.sentinel } : null, B: B ? { controller: B.controller, policyCapBps: 5000, sentinel: B.sentinel } : null, accountPolicyCapBps: 5500 },
    steps,
    receipts,
    activityEntriesShown: activityEntries,
    stoppedAfter,
    pageProblems: problems,
  };
  writeFileSync(`${OUT}/local-e2e-${RUN_ID}.json`, JSON.stringify(evidence, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2) + "\n");
  const failed = receipts.filter((receipt) => receipt.status !== "success");
  console.log(`\n${receipts.length} transactions, ${failed.length} reverted, ${problems.length} page problem(s). Evidence: evidence/fable/local-e2e-${RUN_ID}.json, screenshots: evidence/screenshots/local-e2e/${ACTIVITY_ONLY ? "activity-only-" : ""}${RUN_ID}/`);
  for (const problem of problems.slice(0, 8)) console.log(" ", problem);
  if (failed.length || problems.length) process.exitCode = 1;
}

const stopIf = (stage) => {
  if (STOP_AFTER === stage) throw Object.assign(new Error(`stopped after stage "${stage}" as requested`), { stop: true });
};

try {
  // 0. The displayed borrow rate of market #0 must equal ratePerBlock x blocksPerYear() read from chain right now.
  {
    const controller0 = await read(C.MarketFactory, MarketFactoryAbi, "marketAt", [0n]);
    const debt0 = await read(controller0, IsolatedControllerAbi, "debtMarket");
    const perBlock = await read(debt0, MarketPTokenAbi, "borrowRatePerBlock");
    const blocksPerYear = await read(await read(debt0, MarketPTokenAbi, "interestRateModel"), DemoRateModelAbi, "blocksPerYear");
    const expectedBps = (perBlock * blocksPerYear * 10000n) / WAD;
    const expectedText = `${(Number(expectedBps) / 100).toFixed(2).replace(/\.?0+$/, "")}% APR`;
    await go("/markets?view=borrow");
    assert((await page.locator("h1").innerText()) === "Borrow", "the Borrow view of the markets list did not open");
    // Read the cell by its label, not its position: the Earn and Borrow views order their columns differently.
    const shownRate = (await page.locator("main li").first().locator("dl > div").filter({ hasText: "Borrow rate" }).locator("dd").innerText()).trim();
    console.log(`market #0 borrow rate: shown "${shownRate}", on-chain ${perBlock} x ${blocksPerYear} blocks/yr = ${expectedBps} bps ("${expectedText}")`);
    assert(shownRate === expectedText, `Displayed borrow rate ${shownRate} does not match the on-chain rate ${expectedText}`);
    steps.push({ label: "rate display check (read-only)", txs: [], shown: shownRate, ratePerBlock: perBlock.toString(), blocksPerYear: blocksPerYear.toString(), expectedBps: expectedBps.toString() });
  }

  let A = null;
  let B = null;
  if (!ACTIVITY_ONLY) {
    // 1. Studio: two isolated markets. A has a 65% policy cap, B a 50% cap. Each gets a Sentinel account carrying
    //    the published 55% ACCOUNT policy (ACCOUNT registration is registrar-only, so the account cap is fixed).
    A = await ensureMarket("A", 6500);
    B = await ensureMarket("B", 5000);
    markets = { A, B };
    stopIf("markets");

    // 2. Two independent rejections, both through the Sentinel path.
    //    A: 60% LTV. The account policy (55%) denies; the market policy (65%) would allow.
    await expectRejection("A", A, 6000, {
      revert: "AccountPolicyRejected", rejection: "account-policy", rejectingCircuit: "accountCircuit", otherCircuit: "marketCircuit",
      checks: {
        "account-policy": { status: "fail", basis: "simulation" },
        protocol: { status: "unknown", basis: "none" },
        "market-policy": { status: "pass", basis: "local-preview", text: /Would allow\. Not reached on chain.*Local preview \(reference evaluator\) of the same circuit/ },
      },
      other: { layer: "market-policy", basis: "local-preview" },
    }, "04-market-A-65-account-policy-rejects-market-would-allow");
    //    B: 52% LTV. The account policy (55%) allows inside the same simulation; the market policy (50%) denies.
    await expectRejection("B", B, 5200, {
      revert: "MarketPolicyRejected", rejection: "market-policy", rejectingCircuit: "marketCircuit", otherCircuit: "accountCircuit",
      checks: {
        "account-policy": { status: "pass", basis: "simulation", text: /Allowed in the simulation: this circuit ran inside the same eth_call and passed/ },
        protocol: { status: "pass", basis: "simulation" },
        "market-policy": { status: "fail", basis: "simulation" },
      },
      other: { layer: "account-policy", basis: "simulation" },
    }, "05-market-B-50-market-policy-rejects-account-allows");
    stopIf("rejections");

    // 3. An allowed Sentinel borrow on A: both circuits allow, so one receipt carries two PolicyAllowed events.
    const borrowAllowed = async (key, state, text) => {
      await go(`/markets/${state.controller}`);
      await panel.getByRole("button", { name: /^Sentinel account/ }).click();
      await panel.getByRole("tab", { name: "Borrow" }).click();
      await amount.fill(text);
      await previewReady();
      assert((await panel.locator("[data-rejection]").count()) === 0, `market ${key}: borrow ${text} is rejected in the preview`);
      await transact(panel, submit, `sentinel ${key}: borrow ${text} mUSD (allowed by the account policy and the market policy)`, async (txs) => {
        const receipt = await chain.getTransactionReceipt({ hash: txs.at(-1) });
        const allowed = parseEventLogs({ abi: IsolatedControllerAbi, eventName: "PolicyAllowed", logs: receipt.logs });
        assert(allowed.length === 2 && allowed.some((log) => same(log.address, state.sentinel)) && allowed.some((log) => same(log.address, state.controller)), `expected PolicyAllowed from the account and from the controller, got ${allowed.length}`);
        const after = await marketState(state.controller);
        assert(after.debt >= state.debt + USD(Number(text)) && after.idleDebtAsset === state.idleDebtAsset + USD(Number(text)), "debt or idle funds did not move by the borrowed amount");
        return `2 PolicyAllowed events (account ${allowed.find((log) => same(log.address, state.sentinel)).args.postLtvBps} bps, controller), debt ${fmtUsd(after.debt)} mUSD, idle ${fmtUsd(after.idleDebtAsset)} mUSD in the account`;
      });
      return marketState(state.controller);
    };
    if (A.debt < USD(3) || A.idleDebtAsset < USD(3)) {
      // Re-runs: every run repays 2 mUSD and withdraws 1, so the account borrows again every other run and its debt
      // creeps up. Keep this borrow an ALLOWED one on any run: if 5 mUSD more would pass 50% loan-to-value (the
      // account policy caps at 55%), the owner first adds collateral through the same Sentinel path.
      const price = (asset) => read(C.TestnetOracle, TestnetOracleAbi, "price", [asset]);
      const [[collateralPrice], [debtPrice]] = await Promise.all([price(A.collateralAsset), price(A.debtAsset)]);
      const ltvAfter = (((A.debt + USD(5)) * debtPrice) / 10n ** 6n) * 10_000n / ((A.collateralUnderlying * collateralPrice) / WAD);
      if (ltvAfter > 5000n) {
        const beforeTopUp = A;
        await go(`/markets/${A.controller}`);
        if (A.walletCollateral < 10n * WAD) await transact(panel, panel.locator('[data-testid="mint-test-tokens"]'), "wallet: mint test tokens for the collateral top-up (permissionless mock tokens)");
        await panel.getByRole("button", { name: /^Sentinel account/ }).click();
        await panel.getByRole("tab", { name: "Supply" }).click();
        await amount.fill("10");
        await previewReady();
        await transact(panel, submit, `sentinel A: top up collateral by 10 mCOL (a 5 mUSD borrow would otherwise reach ${Number(ltvAfter) / 100}% on a re-run)`, async () => {
          A = await marketState(A.controller);
          assert(A.collateralUnderlying >= beforeTopUp.collateralUnderlying + 10n * WAD - 10n, `collateral went from ${beforeTopUp.collateralUnderlying} to ${A.collateralUnderlying}`);
          return `account collateral ${beforeTopUp.collateralUnderlying / WAD} -> ${A.collateralUnderlying / WAD} mCOL`;
        });
      }
      A = await borrowAllowed("A", A, "5");
    }
    await shot("06-market-A-sentinel-borrow-confirmed");
    stopIf("borrow");

    // 4. Operator grant: repay-only (mask 8), budget 3 mUSD, 7 days from the latest block.
    const policyPath = `/strategies?market=${A.controller}`;
    const automation = page.locator('[data-testid="automation"]');
    const operatorRow = automation.locator(`li[data-operator="${operator}" i]`);
    const emergency = page.locator('[data-testid="emergency-stop"]');
    const automationState = async () => {
      const [[mask, remaining], trigger] = await Promise.all([read(A.sentinel, SentinelAccountAbi, "operators", [operator]), read(A.sentinel, SentinelAccountAbi, "autoRepayTriggerBps")]);
      return { mask, remaining, trigger };
    };
    /** Clicks "Stop all automation" and checks the chain: no grant, no trigger, and the operator is locked out. */
    const emergencyStop = async (label) => {
      const before = await automationState();
      const expectedTxs = (before.mask !== 0 ? 1 : 0) + (before.trigger !== 0 ? 1 : 0);
      await go(policyPath);
      // The operator row comes from a log scan; the stop button must count it before it is pressed.
      if (before.mask !== 0) await page.waitForFunction(() => Number(document.querySelector('[data-testid="emergency-stop"]')?.getAttribute("data-operators") ?? 0) >= 1, null, { timeout: 30000 });
      await transact(emergency, emergency.locator('[data-testid="emergency-stop-submit"]'), label, async (txs) => {
        const after = await automationState();
        assert(txs.length === expectedTxs, `emergency stop sent ${txs.length} transaction(s), expected ${expectedTxs} (grant mask ${before.mask}, trigger ${before.trigger})`);
        assert(after.mask === 0 && after.remaining === 0n && after.trigger === 0, `after the emergency stop: mask ${after.mask}, remaining ${after.remaining}, trigger ${after.trigger}`);
        const receipts = await Promise.all(txs.map((hash) => chain.getTransactionReceipt({ hash })));
        const revoked = receipts.flatMap((receipt) => parseEventLogs({ abi: SentinelAccountAbi, eventName: "OperatorRevoked", logs: receipt.logs }));
        if (before.mask !== 0) assert(revoked.length === 1 && same(revoked[0].args.operator, operator), "OperatorRevoked was not emitted for the operator");
        const locked = await revertName(operator, A.sentinel, SentinelAccountAbi, "autoRepay", []);
        assert(locked === "OperatorNotAuthorized", `autoRepay() as the operator after the stop: ${locked}`);
        // The page must confirm the stop from its own fresh read of the account, not from the receipts alone.
        await emergency.locator('[data-testid="emergency-stop-confirmed"][data-confirmed="true"]').waitFor({ timeout: 30000 });
        return `${txs.length} tx: ${before.mask !== 0 ? "revokeOperator (OperatorRevoked emitted)" : "no grant to revoke"}, ${before.trigger !== 0 ? `setAutoRepayTrigger(0) from ${before.trigger}` : "trigger already 0"}; operators(operator) cleared, autoRepayTriggerBps() == 0, autoRepay() as the operator reverts OperatorNotAuthorized`;
      });
    };
    // Re-runs: an earlier run (or one that stopped half-way) may have left a grant or a trigger behind. Start every
    // run from the same automation state, through the product's own emergency stop, and record that it happened.
    {
      const left = await automationState();
      if (left.mask !== 0 || left.trigger !== 0) {
        console.log(`leftover automation on Sentinel A (mask ${left.mask}, trigger ${left.trigger}): clearing it with the emergency stop first`);
        await emergencyStop("sentinel A: emergency stop to clear automation left by an earlier run (normalisation)");
        A = await marketState(A.controller);
      }
    }
    await go(policyPath);
    assert((await emergency.locator('[data-testid="emergency-stop-submit"]').isDisabled()) && /Nothing to stop/.test(await emergency.innerText()), "the emergency stop should have nothing to stop before a grant exists");
    await page.locator("#operator-address").fill(operator);
    await automation.getByLabel(/Auto-repay from idle funds/).setChecked(true);
    await automation.getByLabel(/Borrow into the account/).setChecked(false);
    await automation.locator('input[inputmode="decimal"]').fill("3");
    await page.locator("#grant-days").selectOption("7");
    await transact(automation, automation.locator('[data-testid="operator-submit"]'), "sentinel A: setOperator (repay-only mask 8, budget 3 mUSD, 7 days)", async (txs) => {
      const [mask, remaining, expiry] = await read(A.sentinel, SentinelAccountAbi, "operators", [operator]);
      const receipt = await chain.getTransactionReceipt({ hash: txs.at(-1) });
      const minedAt = (await chain.getBlock({ blockNumber: receipt.blockNumber })).timestamp;
      assert(mask === 8 && remaining === USD(3), `grant is mask ${mask}, remaining ${remaining}`);
      // The app counts the lifetime from the chain's clock at the block it read, never from the browser's. This node
      // only mines when a transaction arrives, so after an idle hour the block it read is an hour older than the block
      // the grant is mined in. The grant may therefore be SHORTER than seven days from the mined block by that idle
      // time, never longer: at most 7 days after the mined block, and at least 7 days after the block the app read.
      const readAt = (await chain.getBlock({ blockNumber: receipt.blockNumber - 1n })).timestamp;
      assert(expiry > minedAt && expiry <= minedAt + 7n * 86400n && expiry >= readAt + 7n * 86400n - 600n, `expiry ${expiry} is not 7 days counted from the chain time the app read (${readAt}); mined at ${minedAt}`);
      return `operators(${operator}) = mask 8, remaining 3 mUSD, expiry ${expiry} (7 days from the chain time the app read, ${readAt}; mined at block time ${minedAt})`;
    });
    await operatorRow.waitFor({ timeout: 20000 });

    // 5. The operator cannot withdraw: eth_call simulations with the operator as the sender, while its grant is active.
    {
      const before = sent.length;
      await operatorRow.locator('[data-testid="operator-check"]').click();
      await automation.locator('[data-testid="operator-probes"]').waitFor({ timeout: 20000 });
      const probes = Object.fromEntries(await automation.locator("li[data-operator-check]").evaluateAll((rows) => rows.map((row) => [row.dataset.operatorCheck, { outcome: row.dataset.outcome, error: row.dataset.error, text: row.innerText.replace(/\s+/g, " ").trim() }])));
      const independent = {
        withdraw: await revertName(operator, A.sentinel, SentinelAccountAbi, "withdraw", [A.debtAsset, 1n]),
        setPolicy: await revertName(operator, A.sentinel, SentinelAccountAbi, "setPolicy", [`0x${"0".repeat(64)}`]),
        ownerWithdraw: await revertName(account, A.sentinel, SentinelAccountAbi, "withdraw", [A.debtAsset, 1n]),
      };
      await shot("07-operator-cannot-withdraw-owner-only-simulation");
      steps.push({ label: "sentinel A: operator limits, eth_call simulations as the operator (nothing sent)", txs: [], shown: probes, onChain: independent });
      console.log(`operator checks: app withdraw ${probes.withdraw?.outcome}/${probes.withdraw?.error}, setPolicy ${probes["set-policy"]?.error}, setOperator ${probes["set-operator"]?.error}, autoRepay ${probes["auto-repay"]?.outcome}/${probes["auto-repay"]?.error} | chain: operator withdraw ${independent.withdraw}, owner withdraw ${independent.ownerWithdraw ?? "would succeed"}`);
      assert(sent.length === before, "a transaction was sent during the operator checks");
      for (const id of ["withdraw", "set-policy", "set-operator"]) assert(probes[id]?.outcome === "reverts" && probes[id]?.error === "OwnerOnly", `operator check "${id}" is ${JSON.stringify(probes[id])}, expected an OwnerOnly revert`);
      // The app's verdict must equal an independent eth_call as the operator, whatever the account's state is.
      // Every run starts with the trigger cleared (see the normalisation above), so that verdict is TriggerNotMet.
      independent.autoRepay = await revertName(operator, A.sentinel, SentinelAccountAbi, "autoRepay", []);
      assert(independent.autoRepay === null ? probes["auto-repay"]?.outcome !== "reverts" : probes["auto-repay"]?.outcome === "reverts" && probes["auto-repay"]?.error === independent.autoRepay, `autoRepay check in the app is ${JSON.stringify(probes["auto-repay"])}, the chain says ${independent.autoRepay ?? "it would succeed"}`);
      assert(independent.autoRepay === "TriggerNotMet", `autoRepay as the operator should revert TriggerNotMet while the trigger is cleared, got ${independent.autoRepay}`);
      assert(independent.withdraw === "OwnerOnly" && independent.setPolicy === "OwnerOnly", `independent eth_call as the operator: ${JSON.stringify(independent)}`);
      assert(independent.ownerWithdraw === null, `the same withdraw as the owner should succeed, got ${independent.ownerWithdraw}`);
    }

    // 6. Auto-repay trigger.
    await page.locator("#trigger-bps").fill(A.trigger === 4500 ? "4400" : "4500");
    await transact(automation, automation.locator('[data-testid="trigger-submit"]'), "sentinel A: setAutoRepayTrigger", async () => {
      const trigger = await read(A.sentinel, SentinelAccountAbi, "autoRepayTriggerBps");
      assert(trigger === (A.trigger === 4500 ? 4400 : 4500), `trigger is ${trigger}`);
      return `autoRepayTriggerBps() == ${trigger}`;
    });
    await shot("08-sentinel-automation-operator-and-trigger");
    stopIf("operator");

    // 7. Owner repay from the account's idle funds (never gated by a policy).
    A = await marketState(A.controller);
    await go(`/markets/${A.controller}`);
    await panel.getByRole("button", { name: /^Sentinel account/ }).click();
    await panel.getByRole("tab", { name: "Repay" }).click();
    await amount.fill("2");
    await previewReady();
    assert((await panel.getByText(/never gated by a policy circuit/).count()) >= 2, "repay should show both policies as not applicable");
    await transact(panel, submit, "sentinel A: repay 2 mUSD from idle account funds (owner)", async (txs) => {
      const after = await marketState(A.controller);
      const receipt = await chain.getTransactionReceipt({ hash: txs.at(-1) });
      assert(parseEventLogs({ abi: IsolatedControllerAbi, eventName: "PolicyAllowed", logs: receipt.logs }).length === 0, "a repay must not emit PolicyAllowed");
      assert(after.idleDebtAsset === A.idleDebtAsset - USD(2), `idle funds moved by ${A.idleDebtAsset - after.idleDebtAsset}`);
      assert(after.debt <= A.debt - USD(2) + 10_000n && after.debt >= A.debt - USD(2), `debt went from ${A.debt} to ${after.debt}`);
      return `debt ${fmtUsd(A.debt)} -> ${fmtUsd(after.debt)} mUSD, idle ${fmtUsd(A.idleDebtAsset)} -> ${fmtUsd(after.idleDebtAsset)} mUSD, no PolicyAllowed event`;
    });
    await shot("09-sentinel-repay-confirmed");

    // 8. Owner withdrawal of idle funds: always pays the owner.
    A = await marketState(A.controller);
    await go("/portfolio");
    const card = page.locator(`[data-testid="sentinel-account"][data-market="${A.controller}" i]`);
    await card.locator('[data-testid="withdraw-open"]').click();
    const sheet = page.locator("dialog[open]");
    await sheet.locator('[data-testid="withdraw-asset-debt"]').click();
    await sheet.locator('input[inputmode="decimal"]').fill("1");
    await transact(sheet, sheet.locator('[data-testid="withdraw-submit"]'), "sentinel A: withdraw 1 mUSD of idle funds to the owner", async (txs) => {
      const after = await marketState(A.controller);
      const receipt = await chain.getTransactionReceipt({ hash: txs.at(-1) });
      const withdrawn = parseEventLogs({ abi: SentinelAccountAbi, eventName: "Withdrawn", logs: receipt.logs }).at(0);
      assert(withdrawn && same(withdrawn.args.owner, account) && same(withdrawn.args.asset, A.debtAsset) && withdrawn.args.amount === USD(1), "Withdrawn event does not pay 1 mUSD to the owner");
      assert(after.idleDebtAsset === A.idleDebtAsset - USD(1) && after.walletDebtAsset === A.walletDebtAsset + USD(1), "balances did not move by 1 mUSD from the account to the owner");
      return `Withdrawn(asset mUSD, owner = wallet, 1 mUSD); account idle ${fmtUsd(after.idleDebtAsset)} mUSD, wallet +1 mUSD`;
    });
    await shot("10-sentinel-withdraw-to-owner");
    await sheet.getByRole("button", { name: "Close" }).click();

    // 9. Emergency stop: one control revokes the operator and clears the trigger (two transactions, in that order).
    await go(policyPath);
    await operatorRow.waitFor({ timeout: 20000 });
    assert((await emergency.getAttribute("data-operators")) === "1" && Number(await emergency.getAttribute("data-trigger")) > 0, "the emergency stop does not show the active operator and trigger");
    await shot("11a-emergency-stop-armed");
    await emergencyStop("sentinel A: emergency stop (revokeOperator, then setAutoRepayTrigger(0))");
    await automation.locator('[data-testid="no-operator"]').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => /Nothing to stop/.test(document.querySelector('[data-testid="emergency-stop"]')?.textContent ?? ""), null, { timeout: 20000 });
    await shot("11-emergency-stop-done-operator-revoked-trigger-cleared");
    stopIf("owner-writes");

    // 10. Market B: the same account policy allows a smaller borrow that the 50% market also allows.
    if (B.debt === 0n) B = await borrowAllowed("B", B, "4");

    // 11. Direct path on B: without a Sentinel account only the market policy applies, and it rejects 52% as well.
    if (B.walletCollateralShares === 0n) {
      await go(`/markets/${B.controller}`);
      await panel.getByRole("button", { name: /^Wallet/ }).click();
      await panel.getByRole("tab", { name: "Supply" }).click();
      await panel.getByRole("button", { name: /collateral$/ }).click();
      await amount.fill("10");
      await previewReady();
      await transact(panel, submit, "wallet B: approve + supply 10 mCOL + enter market (direct)", async () => {
        assert(await read(B.controller, IsolatedControllerAbi, "collateralEntered", [account]), "wallet did not enter the market");
        return "wallet holds collateral pTokens and entered the market";
      });
    }
    {
      const before = sent.length;
      await go(`/markets/${B.controller}`);
      await panel.getByRole("button", { name: /^Wallet/ }).click();
      await panel.getByRole("tab", { name: "Borrow" }).click();
      await amount.fill("8.32");
      await panel.locator("[data-rejection]").first().waitFor({ timeout: 20000 });
      const rejection = await panel.locator("[data-rejection]").first().getAttribute("data-rejection");
      const direct = await revertName(account, B.debtMarket, MarketPTokenAbi, "borrow", [USD(8.32)]);
      steps.push({ label: "wallet B: direct borrow 8.32 mUSD, eth_call simulation only (nothing sent)", txs: [], shown: { rejection, accountRow: await panel.locator('li[data-check="account-policy"]').count() }, onChain: { entrypointRevert: direct } });
      console.log(`direct B: app ${rejection} | chain ${direct}`);
      assert(rejection === "market-policy" && direct === "MarketPolicyRejected" && sent.length === before, `direct borrow on B: app ${rejection}, chain ${direct}`);
      assert((await panel.locator('li[data-check="account-policy"]').count()) === 0, "the direct path must not show a Sentinel policy row");
    }
  }

  // Activity: settled PolicyAllowed decisions with their transaction hashes, newest first.
  await go("/activity");
  await page.locator("li[data-result]").first().waitFor({ timeout: 20000 });
  const activity = await page.locator("li[data-result]").allInnerTexts();
  const blocks = activity.map((text) => Number(/block (\d+)\./.exec(text)?.[1] ?? -1));
  assert(!blocks.some((block, index) => index > 0 && block > blocks[index - 1]), `Activity is not newest-first: ${blocks.join(",")}`);
  // Keeper reports, through the app's own read-only route. Compared with the keeper's API read directly by the script.
  {
    const keeperPanel = page.locator('[data-testid="keeper-panel"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="keeper-panel"]')?.getAttribute("data-keeper") !== "loading", null, { timeout: 20000 });
    const keeperState = await keeperPanel.getAttribute("data-keeper");
    const route = async (path, init) => {
      const response = await fetch(BASE + path, init);
      return { status: response.status, text: await response.text() };
    };
    const [badLimit, post, small] = await Promise.all([route("/api/keeper?limit=0"), route("/api/keeper?limit=5", { method: "POST" }), route("/api/keeper?limit=5")]);
    const feed = JSON.parse(small.text);
    const keeper = { panel: keeperState, route: { badLimit: badLimit.status, post: post.status, state: feed.state, items: feed.items?.length ?? null } };
    assert(badLimit.status === 400 && post.status === 405, `route guards: limit=0 -> ${badLimit.status}, POST -> ${post.status}`);
    assert(!/8787|KEEPER_API_URL/.test(small.text), "the route response mentions the upstream address");
    if (KEEPER_URL) {
      const upstream = await (await fetch(`${KEEPER_URL}/v1/status`)).json();
      const upstreamRows = (await (await fetch(`${KEEPER_URL}/v1/activity?limit=50`)).json()).items;
      assert(keeperState === "ok" && feed.state === "ok", `keeper panel is "${keeperState}", route says "${feed.state}": ${JSON.stringify(feed.check ?? feed.reason ?? "")}`);
      assert(feed.items.length <= 5, "limit was not applied");
      assert(same(feed.scope.account, upstream.account) && same(feed.scope.operator, upstream.operator) && feed.scope.instanceId === (await jsonRpc(RPC, "anvil_metadata")).instanceId, "scope shown does not match the keeper and the node");
      const rows = await keeperPanel.locator("li[data-keeper-state]").evaluateAll((nodes) => nodes.map((node) => ({ state: node.dataset.keeperState, sent: node.dataset.sent, confirmed: node.dataset.confirmed, text: node.innerText.replace(/\s+/g, " ").trim() })));
      const scopeText = (await keeperPanel.locator('[data-testid="keeper-scope"]').innerText()).replace(/\s+/g, " ");
      assert(rows.length > 0, "no keeper rows shown although the keeper has reports");
      assert(scopeText.includes(same(upstream.account, A?.sentinel ?? "") ? "Your account" : "Not your account"), `ownership label missing: ${scopeText}`);
      const upstreamStates = new Set(upstreamRows.map((row) => row.state));
      for (const row of rows) {
        assert(upstreamStates.has(row.state), `the panel shows state "${row.state}" which the keeper did not report`);
        if (["simulated", "simulation-failed", "gas-budget", "disabled", "tick-failed"].includes(row.state)) assert(row.sent === "false" && /not sent|nothing sent|did not send/i.test(row.text), `off-chain row not labelled as unsent: ${row.text}`);
        if (row.state === "success") assert(row.confirmed === "success", `a keeper "success" row is not confirmed by a receipt read from chain: ${row.text}`);
      }
      const chainRepays = Number(await keeperPanel.locator('[data-testid="keeper-chain-repays"]').getAttribute("data-count").catch(() => "0"));
      Object.assign(keeper, { execute: upstream.execute, account: upstream.account, operator: upstream.operator, rows: rows.map((row) => ({ state: row.state, sent: row.sent, confirmed: row.confirmed })), rowTexts: rows.slice(0, 3).map((row) => row.text), statesReportedByKeeper: [...upstreamStates], autoRepayEventsOnChain: chainRepays });
      console.log(`keeper panel: ${rows.length} row group(s), states ${[...new Set(rows.map((row) => row.state))].join(", ")}; keeper execute=${upstream.execute}; AutoRepayExecuted events on chain for its account: ${chainRepays}`);
    } else {
      console.log(`keeper panel: "${keeperState}" (no KEEPER_URL given to the script, upstream comparison skipped)`);
    }
    steps.push({ label: "keeper reports panel (read-only)", txs: [], keeper });
    await keeperPanel.scrollIntoViewIfNeeded();
    await keeperPanel.screenshot({ path: `${SHOTS}/12b-keeper-reports-panel.png` });
  }
  steps.push({ label: "activity view", txs: [], entries: activity.length });
  await shot("12-sentinel-activity");
  if (ACTIVITY_ONLY) {
    console.log(`activity view: ${activity.length} on-chain entries, newest first; nothing sent (${sent.length} tx)`);
    assert(sent.length === 0, "the read-only run sent a transaction");
  } else {
    await go("/portfolio");
    await shot("13-sentinel-overview");
  }

  await writeEvidence({ A, B, activityEntries: activity.length, stoppedAfter: null });
} catch (error) {
  if (error.stop) {
    console.log(error.message);
    await writeEvidence({ ...markets, activityEntries: null, stoppedAfter: STOP_AFTER });
  } else {
    console.error("E2E FAILED:", error.message);
    for (const problem of problems.slice(0, 8)) console.error(" ", problem);
    await page.screenshot({ path: `${SHOTS}/zz-failure.png`, fullPage: true }).catch(() => {});
    console.error("sent so far:", JSON.stringify(sent));
    // Transactions that were mined before the failure are still recorded, flagged as an incomplete run.
    await writeEvidence({ ...markets, activityEntries: null, stoppedAfter: `FAILED: ${error.message.split("\n")[0]}` }).catch(() => {});
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

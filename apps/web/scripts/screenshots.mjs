// Captures evidence screenshots and runs basic UI checks against a running server.
//   BASE_URL=http://127.0.0.1:3210 OUT=../../evidence/screenshots/m0 node scripts/screenshots.mjs [--checks-only] [--only=/path]
// Each shot uses a fresh browser context with only `colorScheme` set and no stored theme,
// so the screenshots also prove the "respect system preference" path.
//
// Chain mode (a server on a deployed target, for example NEXT_PUBLIC_PERIDOT_TARGET=local):
//   BASE_URL=http://127.0.0.1:3211 OUT=../../evidence/screenshots/local-e2e/<run>/chain-mode node scripts/screenshots.mjs --chain
// It reads the market and account ids from the chain, connects a READ-ONLY test wallet (it refuses to send),
// expects NO fixture banner and NO deployment banner, and runs the core demo routes at 360 and 390 px with
// every disclosure opened, plus the mobile action sheets. Loopback chain 31337 only.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const OUT = resolve(here, process.env.OUT ?? "../../../evidence/screenshots/m0");
const checksOnly = process.argv.includes("--checks-only");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);

const CHAIN = process.argv.includes("--chain");
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:18545";
const sentTx = [];
const refusedTx = [];
let chainAccount = null;
let chainMarket = "example-0";
let chainStudioMarket = "example-2";
let chainTarget = null; // { ltvBps, debtRaw } for the mobile rejection check
if (CHAIN) {
  if ((await jsonRpc(RPC, "eth_chainId")) !== "0x7a69") throw new Error("--chain expects the local chain 31337");
  const { readFileSync } = await import("node:fs");
  const { IsolatedControllerAbi, MarketFactoryAbi, SentinelAccountFactoryAbi } = await import("@peridot/chain-config");
  const { createPublicClient, http, zeroAddress } = await import("viem");
  const manifest = JSON.parse(readFileSync(resolve(here, "../../../packages/chain-config/deployments/31337.json"), "utf8"));
  const index = Number(process.env.E2E_ACCOUNT_INDEX ?? 4);
  if (!(index >= 3 && index <= 9)) throw new Error("Use accounts #3-#9 only");
  chainAccount = (await jsonRpc(RPC, "eth_accounts"))[index];
  const chain = createPublicClient({ transport: http(RPC) });
  const count = Number(await chain.readContract({ address: manifest.contracts.MarketFactory, abi: MarketFactoryAbi, functionName: "marketCount" }));
  // The first market this wallet owns with a Sentinel account (the E2E's market A); market #0 otherwise.
  chainMarket = await chain.readContract({ address: manifest.contracts.MarketFactory, abi: MarketFactoryAbi, functionName: "marketAt", args: [0n] });
  for (let i = 0; i < count; i++) {
    const controller = await chain.readContract({ address: manifest.contracts.MarketFactory, abi: MarketFactoryAbi, functionName: "marketAt", args: [BigInt(i)] });
    const owner = await chain.readContract({ address: controller, abi: IsolatedControllerAbi, functionName: "owner" });
    const sentinel = await chain.readContract({ address: manifest.contracts.SentinelAccountFactory, abi: SentinelAccountFactoryAbi, functionName: "accountOf", args: [chainAccount, controller] });
    if (owner.toLowerCase() === chainAccount.toLowerCase() && sentinel !== zeroAddress) {
      chainMarket = controller;
      break;
    }
  }
  chainStudioMarket = chainMarket;
  console.log(`chain mode: wallet ${chainAccount} (read-only test wallet), market ${chainMarket}`);
}

const SHOTS = [
  { path: "/", name: "landing" },
  { path: "/portfolio", name: "portfolio" },
  { path: "/strategies", name: "strategies" },
  { path: "/discover", name: "discover" },
  { path: "/studio", name: "studio" },
  { path: "/connect", name: "connect" },
  { path: `/markets/${chainMarket}`, name: "market-detail" },
  { path: "/studio/create", name: "studio-create" },
  { path: "/activity", name: "activity" },
  { path: "/trade", name: "trade" },
  { path: "/circuits", name: "circuits" },
  ...(CHAIN ? [{ path: `/sentinel/policy?market=${chainMarket}`, name: "sentinel-policy" }] : []),
];
// Strategy-first routes (DECISIONS D23). The old URLs are redirects (checked in step 2).
const ALL_ROUTES = ["/", "/portfolio", "/strategies", "/discover", "/activity", CHAIN ? `/sentinel/policy?market=${chainMarket}` : "/sentinel/policy", "/connect", "/trade", "/markets", "/markets?view=borrow", `/markets/${chainMarket}`, "/studio", "/studio/create", `/studio/${chainStudioMarket}`, "/circuits"];
const WIDTHS = [390, 768, 1440];
const SCHEMES = ["light", "dark"];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const failures = [];

async function open(path, width, scheme, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: width <= 768 ? 2 : 1, reducedMotion: "reduce" });
  if (CHAIN) {
    const wallet = await installTestWallet(context, { rpcUrl: RPC, account: chainAccount, walletChainId: "0x7a69", readOnly: true });
    context.__wallet = wallet;
  }
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (CHAIN && !path.startsWith("/?") && path !== "/") {
    await connectWallet(page);
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => !document.querySelector("[data-loading]") && !document.querySelector('[data-keeper="loading"]'), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(CHAIN ? 700 : 250);
  if (CHAIN) {
    sentTx.push(...context.__wallet.sent);
    refusedTx.push(...context.__wallet.refused);
  }
  return { context, page, errors, status: response?.status() ?? 0 };
}

// Grows the viewport to the document height before capturing, so sticky and fixed chrome
// (banner, mobile tab bar) sit where a user sees them instead of floating mid-page.
async function fullShot(page, path) {
  const width = page.viewportSize().width;
  for (let pass = 0; pass < 2; pass++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height: Math.min(Math.max(height, 600), 12000) });
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path });
}

// 1. Every route: HTTP 200, no console errors, no horizontal scroll at 360 and 390.
for (const path of ALL_ROUTES) {
  if (only && path !== only) continue;
  for (const width of [360, 390]) {
    const { context, page, errors, status } = await open(path, width, "light", 780);
    const measure = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const overflow = await measure();
    if (status !== 200) failures.push(`${path} @${width}: HTTP ${status}`);
    if (overflow > 0) failures.push(`${path} @${width}: horizontal overflow ${overflow}px`);
    // Open every disclosure (raw errors, circuit identity, full hashes): long strings must wrap, not widen the page.
    await page.evaluate(() => document.querySelectorAll("details").forEach((node) => (node.open = true)));
    await page.waitForTimeout(100);
    const opened = await measure();
    if (opened > 0) failures.push(`${path} @${width}: horizontal overflow ${opened}px with every disclosure open`);
    for (const error of errors) failures.push(`${path} @${width}: console error: ${error.slice(0, 300)}`);
    const banner = path === "/" ? 1 : await page.locator('[data-testid="fixture-banner"]').count();
    if (CHAIN) {
      if (path !== "/" && banner !== 0) failures.push(`${path} @${width}: fixture banner shown in chain mode`);
      if ((await page.locator('[data-testid="deployment-banner"]').count()) !== 0) failures.push(`${path} @${width}: deployment banner shown although the deployment verifies`);
      if (path !== "/" && (await page.getByText(/unavailable/i).filter({ hasText: /could not be verified|Connect a wallet/ }).count()) !== 0) failures.push(`${path} @${width}: live data is unavailable`);
      if (!checksOnly && width === 390 && path !== "/") await fullShot(page, `${OUT}/mobile-390${path.replace(/\?.*$/, "").replace(/0x[0-9a-fA-F]{40}/, "market").replace(/\//g, "-")}.png`);
    } else if (process.env.EXPECT_FIXTURE !== "0" && banner === 0) failures.push(`${path} @${width}: fixture banner missing`);
    await context.close();
  }
  console.log(`checked ${path}`);
}

// 2. The old URLs redirect to the strategy-first routes (D23), with the query string kept. Not followed here; one
//    is also followed in a browser to prove the page behind it renders.
for (const [from, to] of [["/app", "/portfolio"], ["/sentinel", "/portfolio"], ["/sentinel/activity", "/activity"], ["/automate", "/strategies"]]) {
  for (const query of ["", "?market=example-0"]) {
    const response = await fetch(BASE + from + query, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    const target = location ? new URL(location, BASE) : null;
    if (response.status !== 307 || !target || target.pathname !== to || target.search !== query) failures.push(`${from}${query}: HTTP ${response.status} to "${location}", expected 307 to ${to}${query}`);
  }
}
{
  const { context, page } = await open("/automate?market=example-0", 390, "light");
  if (!page.url().endsWith("/strategies?market=example-0")) failures.push(`/automate?market=example-0 did not land on /strategies?market=example-0 (got ${page.url()})`);
  if ((await page.locator("h1").first().innerText()) !== "Strategies") failures.push("the page behind the /automate redirect is not Strategies");
  await context.close();
  console.log("checked redirects");
}

// 3. Theme: follows the system with no stored choice; a toggle persists across reload.
{
  const { context, page } = await open("/", 1280, "dark");
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const initial = await bg();
  if (initial !== "rgb(11, 11, 11)") failures.push(`system dark preference not respected (background ${initial})`);
  await page.getByRole("button", { name: /Switch to light theme/ }).click();
  const toggled = await bg();
  await page.reload({ waitUntil: "networkidle" });
  const persisted = await bg();
  if (toggled !== "rgb(255, 255, 255)" || persisted !== "rgb(255, 255, 255)") failures.push(`theme toggle did not persist (toggled ${toggled}, after reload ${persisted})`);
  await context.close();
  console.log("checked theme");
}

// 4. Interaction: the two policy rejections are distinct states, repay is never gated, writes stay locked.
if (CHAIN) {
  // Chain mode at 390 px: the action sheet and the owner-withdraw sheet, driven by real chain reads.
  const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  {
    const { context, page, errors } = await open(`/markets/${chainMarket}`, 390, "light", 844);
    await page.locator("div.fixed").getByRole("button", { name: "Borrow" }).click();
    const sheet = page.locator("dialog[open]");
    await sheet.waitFor();
    await sheet.getByRole("button", { name: /^Sentinel account/ }).click();
    await sheet.locator('input[inputmode="decimal"]').fill("9"); // 10 mCOL at $1.60 = $16: with 0 to 6.9 mUSD of debt this lands between 56% and 100%, above the 55% account cap
    await sheet.locator("[data-rejection]").first().waitFor({ timeout: 20_000 });
    const rejection = await sheet.locator("[data-rejection]").first().getAttribute("data-rejection");
    if (rejection !== "account-policy") failures.push(`mobile sheet (chain): borrow 9 via Sentinel should be an account-policy rejection, got ${rejection}`);
    if (!(await sheet.locator('[data-testid="submit"]').isDisabled())) failures.push("mobile sheet (chain): submit enabled for a rejected borrow");
    await sheet.evaluate((node) => node.querySelectorAll("details").forEach((entry) => (entry.open = true)));
    await page.waitForTimeout(150);
    if ((await overflowOf(page)) > 0) failures.push(`mobile sheet (chain): horizontal overflow ${await overflowOf(page)}px`);
    const dialogOverflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (dialogOverflow > 0) failures.push(`mobile sheet (chain): content overflows the sheet by ${dialogOverflow}px with raw error and circuit evidence open`);
    if (!checksOnly) await page.screenshot({ path: `${OUT}/mobile-390-action-sheet-rejection.png` });
    if (!checksOnly) {
      await sheet.evaluate((node) => node.scrollTo(0, node.scrollHeight));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/mobile-390-action-sheet-rejection-lower.png` });
    }
    for (const error of errors) failures.push(`mobile sheet (chain): console error: ${error.slice(0, 300)}`);
    await context.close();
  }
  {
    const { context, page, errors } = await open("/portfolio", 390, "light", 844);
    await page.locator(`[data-testid="sentinel-account"][data-market="${chainMarket}" i] [data-testid="withdraw-open"]`).click();
    const sheet = page.locator("dialog[open]");
    await sheet.locator('[data-testid="withdraw-sheet"]').waitFor();
    await sheet.locator('input[inputmode="decimal"]').fill("0.5");
    await page.waitForTimeout(200);
    if ((await overflowOf(page)) > 0) failures.push(`withdraw sheet (chain): horizontal overflow ${await overflowOf(page)}px`);
    const dialogOverflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (dialogOverflow > 0) failures.push(`withdraw sheet (chain): content overflows the sheet by ${dialogOverflow}px`);
    if (!checksOnly) await page.screenshot({ path: `${OUT}/mobile-390-withdraw-sheet.png` });
    for (const error of errors) failures.push(`withdraw sheet (chain): console error: ${error.slice(0, 300)}`);
    await context.close();
  }
  if (sentTx.length || refusedTx.length) failures.push(`chain-mode checks tried to send ${sentTx.length + refusedTx.length} transaction(s); they must be read-only`);
  console.log(`checked chain-mode mobile sheets (transactions sent: ${sentTx.length}, refused: ${refusedTx.length})`);
} else if (process.env.WALLET_CHECK === "wrong-network") {
  const { context, page } = await open("/markets/example-0", 1440, "light");
  if ((await page.locator('[data-testid="wrong-network-banner"]').count()) !== 1) failures.push("wrong-network banner missing with a wallet on another chain");
  if (!checksOnly) await fullShot(page, `${OUT}/state-wrong-network-1440-light.png`);
  await context.close();
  console.log("checked wrong network");
} else {
  for (const scheme of checksOnly ? ["light"] : SCHEMES) {
    const { context, page, errors } = await open("/markets/example-0", 1440, scheme);
    const panel = page.locator('aside [data-testid="action-panel"]');
    const amount = panel.locator('input[inputmode="decimal"]');
    const rejection = panel.locator("[data-rejection]");
    await panel.getByRole("tab", { name: "Borrow" }).click();

    await amount.fill("1400");
    await rejection.first().waitFor();
    if ((await rejection.first().getAttribute("data-rejection")) !== "account-policy") failures.push("borrow 1400 via Sentinel should be an account-policy rejection");
    if (!checksOnly) await fullShot(page, `${OUT}/state-rejected-by-sentinel-policy-1440-${scheme}.png`);

    await panel.getByRole("button", { name: /^Wallet/ }).click();
    await amount.fill("901");
    await rejection.first().waitFor();
    if ((await rejection.first().getAttribute("data-rejection")) !== "market-policy") failures.push("direct borrow 901 should be a market-policy rejection");
    if (!checksOnly) await fullShot(page, `${OUT}/state-rejected-by-market-policy-1440-${scheme}.png`);

    await amount.fill("1.0000001");
    if ((await panel.getByText(/at most 6 decimal places/).count()) !== 1) failures.push("excess decimals were not rejected by the amount input");

    await amount.fill("100");
    await panel.getByText("Before you sign").waitFor();
    await page.waitForTimeout(300);
    if ((await rejection.count()) !== 0) failures.push("direct borrow 100 should be allowed");
    const primary = panel.getByRole("button", { name: /^Borrow tUSDC/ });
    if (!(await primary.isDisabled())) failures.push("primary write button must be disabled in fixture mode");
    if ((await panel.locator('[data-testid="write-gate-reason"]').count()) !== 1) failures.push("write gate reason not shown");
    await panel.locator('[data-testid="simulate"]').click();
    await panel.locator('[data-testid="tx-success"]').waitFor({ timeout: 8000 });
    if ((await panel.getByText("Simulation · nothing sent").count()) < 1) failures.push("simulated result is not labelled as a simulation");
    if (!checksOnly) await fullShot(page, `${OUT}/state-tx-feedback-simulation-1440-${scheme}.png`);

    await panel.getByRole("tab", { name: "Repay" }).click();
    await panel.getByRole("button", { name: /^Sentinel account/ }).click();
    await amount.fill("400");
    await panel.getByText("Before you sign").waitFor();
    if ((await panel.getByText(/never gated by a policy circuit/).count()) < 2) failures.push("repay must show both policies as not applicable");
    for (const error of errors) failures.push(`interaction: console error: ${error.slice(0, 300)}`);
    await context.close();
  }
  console.log("checked interactions");

  // Mobile: the action sheet opens from the bottom bar, shows the same rejection state and does not overflow.
  {
    const { context, page, errors } = await open("/markets/example-0", 390, "light", 844);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.locator("div.fixed").getByRole("button", { name: "Borrow" }).click();
    const sheet = page.locator("dialog[open]");
    await sheet.waitFor();
    await sheet.locator('input[inputmode="decimal"]').fill("1400");
    await sheet.locator("[data-rejection]").first().waitFor();
    if ((await sheet.locator("[data-rejection]").first().getAttribute("data-rejection")) !== "account-policy") failures.push("mobile sheet: borrow 1400 should be an account-policy rejection");
    if ((await overflow()) > 0) failures.push(`mobile sheet: horizontal overflow ${await overflow()}px`);
    const dialogOverflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (dialogOverflow > 0) failures.push(`mobile sheet: content overflows the sheet by ${dialogOverflow}px`);
    if (!checksOnly) await page.screenshot({ path: `${OUT}/state-mobile-action-sheet-390-light.png` });
    for (const error of errors) failures.push(`mobile sheet: console error: ${error.slice(0, 300)}`);
    await context.close();
  }
  // Mobile: every wizard step fits at 360.
  {
    const { context, page, errors } = await open("/studio/create", 360, "light", 780);
    for (let step = 1; step <= 4; step++) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) failures.push(`wizard step ${step} @360: horizontal overflow ${overflow}px`);
      if (!checksOnly && step > 1) await fullShot(page, `${OUT}/studio-create-step${step}-360-light.png`);
      if (step < 4) {
        await page.setViewportSize({ width: 360, height: 780 });
        await page.locator('[data-testid="wizard-next"]').click();
        await page.waitForTimeout(200);
      }
    }
    if ((await page.getByText("createMarket(bytes32", { exact: false }).count()) !== 1) failures.push("wizard did not reach the review step");
    for (const error of errors) failures.push(`wizard: console error: ${error.slice(0, 300)}`);
    await context.close();
  }
  console.log("checked mobile sheet and wizard steps");
}

// 5. Screenshots.
if (!checksOnly) {
  for (const shot of SHOTS) {
    if (only && shot.path !== only) continue;
    for (const width of WIDTHS) {
      for (const scheme of SCHEMES) {
        const { context, page } = await open(shot.path, width, scheme);
        await fullShot(page, `${OUT}/${shot.name}-${width}-${scheme}.png`);
        await context.close();
      }
    }
    console.log(`captured ${shot.name}`);
  }
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll UI checks passed.");

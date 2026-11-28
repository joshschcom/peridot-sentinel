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
import { disclosureProblems, hasDisclosures } from "./lib/disclosures.mjs";

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
    if (hasDisclosures(path)) for (const problem of await disclosureProblems(page)) failures.push(`${path} @${width}: disclosures: ${problem}`);
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

  // Other networks and the indicative quote (OKX Onchain OS, DECISIONS D25) in an example-data build.
  //   - Without `?okx=` the pages follow the committed switches (all off: one "Planned" line, no quote card).
  //   - With `?okx=<scenario>` the page shows a SYNTHETIC route answer of every kind. What is expected on screen is
  //     computed here, from the same synthetic answer, with the app's own checked functions (unit-tested).
  //   - No request to /api/onchainos may leave the browser in this build, whatever is clicked.
  //   OKX_SHOTS=<dir> also writes the two Portfolio captures (390 and 1440, light, JPEG) of the "mixed" scenario.
  if (process.env.EXPECT_FIXTURE !== "0") {
    const { OKX_FIXTURE_SCENARIOS, fixturePortfolio, fixtureQuote } = await import("../src/services/fixture/okx.ts");
    const { buildSubjects, crossNetworkTotal, formatUsdString, observation, portfolioFromAnswer, quoteFromAnswer, statusWords } = await import("../src/lib/okx-portfolio.ts");
    const { OKX_CHAIN_INDEXES, OKX_SWITCHES, enabledNetworks } = await import("../src/lib/okx-switches.ts");
    const EXAMPLE_WALLET = "0x00000000000000000000000000000000000000E1";
    const SOLANA = "So11111111111111111111111111111111111111112";
    const committed = enabledNetworks(OKX_SWITCHES);
    const routeRequests = [];
    const watch = (page) => page.on("request", (request) => /\/api\/onchainos\//.test(request.url()) && routeRequests.push(request.url()));
    const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const width of [360, 390]) {
      // The committed state of this build.
      {
        const { context, page, errors } = await open("/portfolio", width, "light", 780);
        watch(page);
        const section = page.locator('[data-testid="other-networks"]');
        const shown = { count: await section.count(), state: await section.getAttribute("data-state").catch(() => null), networks: await section.getAttribute("data-networks").catch(() => null), controls: await section.locator("button, input, a").count(), text: (await section.innerText().catch(() => "")).replace(/\s+/g, " ") };
        if (committed.length === 0) {
          if (shown.count !== 1 || shown.state !== "planned" || shown.controls !== 0 || !/^Planned Other networks · mainnet · read-only via OKX Onchain OS\. Not available yet/.test(shown.text) || (await section.locator("p").count()) !== 1) failures.push(`other networks @${width}: with every switch off the section is not exactly one "Planned" line: ${JSON.stringify(shown)}`);
        } else if (shown.networks !== committed.join(",") || shown.state !== "idle" || (await page.locator('[data-testid="other-network"]').count()) !== 0) failures.push(`other networks @${width}: the section does not offer exactly the committed networks, or shows a result before any press: ${JSON.stringify(shown)}`);
        for (const error of errors) failures.push(`other networks @${width}: console error: ${error.slice(0, 300)}`);
        await context.close();
      }
      {
        const { context, page } = await open("/trade", width, "light", 780);
        watch(page);
        if ((await page.locator('[data-testid="okx-quote"]').count()) !== (OKX_SWITCHES.quote ? 1 : 0)) failures.push(`indicative quote @${width}: the card does not follow the committed switch (${OKX_SWITCHES.quote})`);
        await context.close();
      }
      for (const scenario of OKX_FIXTURE_SCENARIOS) {
        const tag = `other networks, example "${scenario}" @${width}`;
        const { context, page, errors } = await open(`/portfolio?okx=${scenario}`, width, "light", 780);
        watch(page);
        const section = page.locator('[data-testid="other-networks"]');
        const testnetValue = await page.locator('[data-testid="portfolio-value"]').innerText().catch(() => null);
        if ((await section.getAttribute("data-source")) !== "example" || (await section.getAttribute("data-networks")) !== OKX_CHAIN_INDEXES.join(",") || (await section.locator('[data-testid="other-networks-example"]').count()) !== 1) failures.push(`${tag}: the section is not the labelled example of all four networks`);
        // Opt-in: nothing is shown before the button is pressed, and the button says what it will do.
        if ((await page.locator('[data-testid="other-network"], [data-testid="other-networks-total"]').count()) !== 0) failures.push(`${tag}: a result is shown before the button was pressed`);
        if (!/sends the address to this app's server and to OKX/.test(await section.locator('[data-testid="other-networks-consent"]').innerText())) failures.push(`${tag}: the consent text does not say where the address goes`);
        // The Solana address is validated in the browser: base58 that stands for 32 bytes.
        const input = section.locator('[data-testid="other-networks-solana"]');
        const help = section.locator('[data-testid="other-networks-solana-help"]');
        const button = section.locator('[data-testid="other-networks-lookup"]');
        for (const bad of ["not-an-address", SOLANA.slice(0, -1), `${SOLANA}1`, EXAMPLE_WALLET, SOLANA.replace("S", "0")]) {
          await input.fill(bad);
          if ((await help.getAttribute("data-valid")) !== "false" || !(await button.isDisabled()) || (await input.getAttribute("aria-invalid")) !== "true") failures.push(`${tag}: "${bad}" was accepted as a Solana address`);
        }
        await input.fill(SOLANA);
        if ((await help.getAttribute("data-valid")) !== "true" || (await button.isDisabled())) failures.push(`${tag}: a valid Solana address was refused`);
        if ((await button.getAttribute("data-subjects")) !== OKX_CHAIN_INDEXES.join(",")) failures.push(`${tag}: the button would look up ${await button.getAttribute("data-subjects")}`);
        const pressedAt = Date.now();
        await button.click();
        await section.locator('[data-testid="other-networks-result"]').waitFor({ timeout: 10_000 });
        // What the same synthetic answer must look like.
        const subjects = buildSubjects(OKX_CHAIN_INDEXES, EXAMPLE_WALLET, SOLANA);
        const answer = fixturePortfolio(scenario, subjects, pressedAt);
        const expected = portfolioFromAnswer(answer.status, answer.body, subjects);
        const total = crossNetworkTotal(expected.networks);
        const cards = await section.locator('[data-testid="other-network"]').evaluateAll((nodes) => nodes.map((node) => ({ network: node.dataset.network, status: node.dataset.status, reason: node.dataset.reason, stale: node.dataset.stale, usd: node.dataset.usd, label: node.querySelector('[data-testid="other-network-status"]')?.textContent ?? "", detail: node.querySelector('[data-testid="other-network-detail"]')?.textContent ?? null, shownUsd: node.querySelector('[data-testid="other-network-usd"]')?.textContent ?? null, tokens: node.querySelector('[data-testid="other-network-tokens"]')?.getAttribute("data-count") ?? null, rows: node.querySelectorAll("[data-token]").length, observed: node.querySelector('[data-testid="other-network-observed"]')?.textContent ?? "", text: node.innerText, example: /EXAMPLE/i.test(node.innerText), links: node.querySelectorAll("a").length })));
        if (cards.length !== 4 || cards.map((card) => card.network).join(",") !== OKX_CHAIN_INDEXES.join(",")) failures.push(`${tag}: the cards are ${cards.map((card) => card.network).join(",")}`);
        for (const [index, network] of expected.networks.entries()) {
          const card = cards[index];
          if (!card) continue;
          const words = statusWords(network.status, network.reason);
          const where = `${tag}, ${network.chainIndex}`;
          if (card.status !== network.status || card.reason !== (network.reason ?? "") || card.label !== words.label) failures.push(`${where}: shown as ${card.status}/${card.reason}/"${card.label}", expected ${network.status}/${network.reason}/"${words.label}"`);
          if (card.links !== 0) failures.push(`${where}: the card contains a link`);
          if (network.status === "ok") {
            if (card.shownUsd !== formatUsdString(network.walletUsd) || !/OKX estimate · wallet tokens only/.test(card.text) || !card.example) failures.push(`${where}: the subtotal is shown as "${card.shownUsd}", expected "${formatUsdString(network.walletUsd)}" labelled "OKX estimate" and "Example"`);
            if (card.tokens !== String(network.tokens.length) || card.rows !== network.tokens.length) failures.push(`${where}: ${card.rows} token rows for ${network.tokens.length} tokens`);
            const stale = observation(network.observedAt, pressedAt).stale;
            if (card.stale !== String(stale) || /Stale/.test(card.observed) !== stale || !/^\s*Observed \d\d \w{3}, \d\d:\d\d UTC/.test(card.observed)) failures.push(`${where}: observed time "${card.observed.trim()}", stale ${card.stale}, expected stale ${stale}`);
          } else {
            // A network that was not read shows words, and no amount of any kind.
            if (card.detail !== words.detail || card.shownUsd !== null || card.tokens !== null || /\$\s?\d/.test(card.text)) failures.push(`${where}: a network with status ${network.status} shows "${card.detail}" / an amount`);
          }
        }
        // The total: only networks read with an estimate, exact, "Partial" otherwise, and apart from the testnet figure.
        const totalNode = section.locator('[data-testid="other-networks-total"]');
        const shownTotal = { partial: await totalNode.getAttribute("data-partial"), counted: await totalNode.getAttribute("data-counted"), usd: await totalNode.getAttribute("data-usd"), text: (await totalNode.innerText()).replace(/\s+/g, " ") };
        if (shownTotal.partial !== String(total.partial) || shownTotal.counted !== total.counted.join(",") || shownTotal.usd !== (total.usd ?? "") || /Partial/.test(shownTotal.text) !== total.partial || (total.usd !== null && !shownTotal.text.includes(formatUsdString(total.usd))) || (total.usd === null && /\$\s?\d/.test(shownTotal.text))) failures.push(`${tag}: the total is shown as ${JSON.stringify(shownTotal)}, expected ${JSON.stringify(total)}`);
        if (!/not added to the portfolio value at the top of this page/.test(shownTotal.text) || !/OKX estimate/.test(shownTotal.text)) failures.push(`${tag}: the total does not say it is an OKX estimate kept apart from the testnet value`);
        if ((await page.locator('[data-testid="portfolio-value"]').innerText().catch(() => null)) !== testnetValue) failures.push(`${tag}: the testnet portfolio value changed after the lookup`);
        if ((await section.locator('[data-testid="other-networks-missing"]').count()) !== (expected.credentials === "missing" ? 1 : 0)) failures.push(`${tag}: the missing-credentials notice does not match the answer`);
        await page.evaluate(() => document.querySelectorAll("details").forEach((node) => (node.open = true)));
        await page.waitForTimeout(100);
        if ((await overflowOf(page)) > 0) failures.push(`${tag}: horizontal overflow ${await overflowOf(page)}px with every disclosure open`);
        const clipped = await section.evaluate((node) => [...node.querySelectorAll("button, h2, h3, li, p, span, code")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible").length + [...node.querySelectorAll("button")].filter((el) => el.scrollWidth > el.clientWidth + 1).length);
        if (clipped > 0) failures.push(`${tag}: ${clipped} element(s) of the section are cut off`);
        if (process.env.OKX_SHOTS && scenario === "mixed" && width === 390) {
          mkdirSync(resolve(process.env.OKX_SHOTS), { recursive: true });
          for (const shotWidth of [390, 1440]) {
            const shot = await open(`/portfolio?okx=${scenario}`, shotWidth, "light", 900);
            watch(shot.page);
            await shot.page.locator('[data-testid="other-networks-solana"]').fill(SOLANA);
            await shot.page.locator('[data-testid="other-networks-lookup"]').click();
            await shot.page.locator('[data-testid="other-networks-result"]').waitFor({ timeout: 10_000 });
            for (let pass = 0; pass < 2; pass++) {
              await shot.page.setViewportSize({ width: shotWidth, height: Math.min(Math.max(await shot.page.evaluate(() => document.documentElement.scrollHeight), 600), 16000) });
              await shot.page.waitForTimeout(150);
            }
            await shot.page.evaluate(() => window.scrollTo(0, 0));
            await shot.page.screenshot({ path: `${resolve(process.env.OKX_SHOTS)}/portfolio-other-networks-fixture-${shotWidth}-light.jpg`, type: "jpeg", quality: 72 });
            await shot.context.close();
          }
        }
        // "Clear" removes what was shown.
        await section.locator('[data-testid="other-networks-clear"]').click();
        if ((await page.locator('[data-testid="other-network"], [data-testid="other-networks-total"]').count()) !== 0) failures.push(`${tag}: "Clear" left a result on the page`);
        for (const error of errors) failures.push(`${tag}: console error: ${error.slice(0, 300)}`);
        await context.close();

        // The indicative quote of the same scenario, on Trade.
        const trade = await open(`/trade?okx=${scenario}`, width, "light", 780);
        watch(trade.page);
        const card = trade.page.locator('[data-testid="okx-quote"]');
        await trade.page.waitForFunction(() => !["loading", null].includes(document.querySelector('[data-testid="okx-quote"]')?.getAttribute("data-state") ?? null), null, { timeout: 10_000 }).catch(() => {});
        const quoteAnswer = fixtureQuote(scenario, Date.now());
        const quote = quoteFromAnswer(quoteAnswer.status, quoteAnswer.body);
        const quoteText = (await card.innerText().catch(() => "")).replace(/\s+/g, " ");
        const amount = await card.locator('[data-testid="okx-quote-amount"]').innerText().catch(() => null);
        const quoteTag = `indicative quote, example "${scenario}" @${width}`;
        if ((await card.getAttribute("data-state").catch(() => null)) !== quote.status || !/Indicative X Layer mainnet price \(OKX\)/.test(quoteText) || !/Informational, not an offer, does not affect testnet swaps\./.test(quoteText) || !/EXAMPLE/i.test(quoteText)) failures.push(`${quoteTag}: the card shows state ${await card.getAttribute("data-state").catch(() => null)}, expected ${quote.status}, or lacks its title, caveat or example label`);
        if (quote.status === "ok") {
          // The page built its own synthetic answer a moment before this script did: the times agree to within seconds.
          const stale = Date.now() - Date.parse(quote.observedAt) > 5 * 60_000;
          const shownTime = /Observed (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC/.exec(quoteText);
          const drift = shownTime ? Math.abs(Date.parse(`${shownTime[1]}T${shownTime[2]}Z`) - Date.parse(quote.observedAt)) : Number.POSITIVE_INFINITY;
          if ((amount ?? "").replace(/\s+/g, " ") !== `${quote.amountIn} ≈ ${quote.amountOut}` || drift > 30_000 || /Stale/.test(quoteText) !== stale) failures.push(`${quoteTag}: shows "${amount}" in "${quoteText.slice(0, 300)}", expected ${quote.amountIn} ≈ ${quote.amountOut} observed about ${quote.observedAt} in UTC, stale ${stale}`);
        } else if (amount !== null || !/No number is shown/.test(quoteText) || !quoteText.includes(statusWords(quote.status, quote.reason, "quotes").label) || /\d USDC/.test(quoteText)) failures.push(`${quoteTag}: a quote that is ${quote.status} (${quote.reason}) shows "${quoteText.slice(0, 200)}"`);
        if ((await overflowOf(trade.page)) > 0) failures.push(`${quoteTag}: horizontal overflow ${await overflowOf(trade.page)}px`);
        for (const error of trade.errors) failures.push(`${quoteTag}: console error: ${error.slice(0, 300)}`);
        await trade.context.close();
      }
    }
    if (routeRequests.length !== 0) failures.push(`an example-data build sent ${routeRequests.length} request(s) to /api/onchainos: ${routeRequests.slice(0, 3).join(", ")}`);
    console.log(`checked other networks and the indicative quote: ${OKX_FIXTURE_SCENARIOS.length} example scenarios at 360 and 390 px, requests to /api/onchainos: ${routeRequests.length}`);
  }
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

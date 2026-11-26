// Negative-path checks for chain mode, in a real browser, against a running server.
//   BASE_URL=http://127.0.0.1:3212 OUT=<dir> node scripts/chain-checks.mjs <mode>
//
//   wrong-network       healthy local-target server. The wallet starts on another chain (X Layer mainnet 196, then
//                       Ethereum 1): banner through the real wagmi path, writes locked, zero transactions; "Switch
//                       network" asks the wallet for 31337 and the lock opens.
//   broken-deployment   local-target server started on a TAMPERED manifest copy in which one contract address has
//                       no bytecode (PERIDOT_DEPLOYMENTS_DIR). Expect the deployment banner, "unavailable" states,
//                       no example data, locked writes.
//   rejected-manifest   local-target server started on a manifest copy that fails a static check (template root
//                       changed, or a required contract removed). Expect labelled fixture mode with the reason.
//   testnet-unverified  DEFAULT-target server (chain 1952) started on a synthetic "deployed" 1952 manifest. The
//                       addresses do not hold this deployment on the public testnet, so the in-browser check must
//                       fail closed. This is the only way to exercise the 1952 chain path before a real deployment.
//
//   testnet-live        DEFAULT-target server on the REAL 1952 manifest. Reads only, against the public testnet RPC:
//                       gating, in-browser deployment check, paged logs, labels, the recorded public auto-repay
//                       receipt re-read from the RPC with its explorer link, and the faucet notice. Two watch-only
//                       wallets: an address with nothing on testnet, and the demo owner's PUBLIC address (no key).
//
//   circuits-fail-closed  DEFAULT-target server started with PERIDOT_TAPEOUT_MANIFEST pointing at a TEST copy of the
//                       TapeOut circuit configuration (written by `PREPARE=<file> ... circuits-fail-closed`). The copy
//                       claims IDs that are NOT Peridot's publications. Against real chain 196 the page must refuse
//                       to evaluate them: a receipt that is not a fabrication on the processor, a receipt that does
//                       not exist, and an ID without a receipt. Read-only; nothing here is a Peridot circuit.
//
// The wallet is the read-only test provider: it refuses eth_sendTransaction. Tampered manifests live in a temp
// directory; packages/chain-config is never touched. Loopback RPC, chain 31337, accounts #3-#9 only.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";

const mode = process.argv[2];
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3212";
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:18545";
const OUT = process.env.OUT ? resolve(process.env.OUT) : null;
const index = Number(process.env.E2E_ACCOUNT_INDEX ?? 4);
if (!(index >= 3 && index <= 9)) throw new Error("Use accounts #3-#9 only");
if ((await jsonRpc(RPC, "eth_chainId")) !== "0x7a69") throw new Error("Expected the local chain 31337");
const account = (await jsonRpc(RPC, "eth_accounts"))[index];
if (OUT) mkdirSync(OUT, { recursive: true });

const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const browser = await chromium.launch();
const ROUTES = ["/sentinel", "/sentinel/policy", "/sentinel/activity", "/automate", "/connect", "/markets", "/studio", "/studio/create", "/circuits"];

async function open(path, { width = 1440, walletChainId = "0x7a69", connect = true, watch = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: width < 500 ? 2 : 1 });
  const wallet = watch ? await installTestWallet(context, { account: watch, walletChainId, watchOnly: true }) : await installTestWallet(context, { rpcUrl: RPC, account, walletChainId, readOnly: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
  if (connect) await connectWallet(page);
  await page.waitForFunction(() => !document.querySelector("[data-loading]"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { context, page, wallet, errors, status: response?.status() ?? 0 };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page, name) => {
  if (!OUT) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
};
const firstMarket = async () => {
  const { MarketFactoryAbi } = await import("@peridot/chain-config");
  const { createPublicClient, http } = await import("viem");
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../../../packages/chain-config/deployments/31337.json", import.meta.url), "utf8"));
  return createPublicClient({ transport: http(RPC) }).readContract({ address: manifest.contracts.MarketFactory, abi: MarketFactoryAbi, functionName: "marketAt", args: [0n] });
};

if (mode === "wrong-network") {
  const market = await firstMarket();
  for (const [walletChainId, name] of [["0xc4", "X Layer (read-only)"], ["0x1", "Unsupported network (1)"]]) {
    const { context, page, wallet, errors } = await open(`/markets/${market}`, { walletChainId });
    const banner = page.locator('[data-testid="wrong-network-banner"]');
    expect((await banner.count()) === 1, `${walletChainId}: wrong-network banner missing`);
    expect((await banner.innerText()).includes(name), `${walletChainId}: banner does not name the wallet's network (${(await banner.innerText().catch(() => "")).slice(0, 120)})`);
    expect((await page.locator('[data-testid="fixture-banner"]').count()) === 0, `${walletChainId}: fixture banner shown on a healthy deployment`);
    expect((await page.locator('[data-testid="deployment-banner"]').count()) === 0, `${walletChainId}: deployment banner shown: reads do not depend on the wallet's chain`);
    expect((await page.locator("h1").innerText()).includes("/"), `${walletChainId}: market data did not load from the RPC`);
    const panel = page.locator('aside [data-testid="action-panel"]');
    await panel.getByRole("button", { name: /^Wallet/ }).click();
    await panel.locator('input[inputmode="decimal"]').fill("1");
    await page.waitForTimeout(1500);
    expect(await panel.locator('[data-testid="submit"]').isDisabled(), `${walletChainId}: submit is enabled on the wrong network`);
    expect(/Switch your wallet to Local development chain/.test(await panel.locator('[data-testid="write-gate-reason"]').innerText().catch(() => "")), `${walletChainId}: the lock does not explain the network`);
    expect((await panel.locator('[data-testid="mint-test-tokens"]').count()) === 0, `${walletChainId}: a write button is offered on the wrong network`);
    await shot(page, `wrong-network-${walletChainId}-locked`);
    // The lock is not only cosmetic: force-clicking the disabled submit sends nothing.
    await panel.locator('[data-testid="submit"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${walletChainId}: a transaction request reached the wallet on the wrong network`);
    await banner.getByRole("button", { name: /Switch network/ }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="wrong-network-banner"]'), null, { timeout: 15_000 }).catch(() => failures.push(`${walletChainId}: banner still shown after the switch`));
    expect(wallet.switches.length === 1 && wallet.switches[0] === "0x7a69", `${walletChainId}: wallet_switchEthereumChain asked for ${JSON.stringify(wallet.switches)}, expected 0x7a69`);
    await page.waitForTimeout(1500);
    expect((await panel.locator('[data-testid="write-gate-reason"]').count()) === 0, `${walletChainId}: writes still locked after switching`);
    expect((await panel.locator('[data-testid="mint-test-tokens"]').count()) === 1, `${walletChainId}: write controls did not return after switching`);
    await shot(page, `wrong-network-${walletChainId}-after-switch`);
    expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${walletChainId}: a transaction was attempted`);
    expect(errors.length === 0, `${walletChainId}: page errors: ${errors.join(" | ")}`);
    notes.push({ walletChainId, banner: name, switchRequested: wallet.switches, transactions: wallet.sent.length + wallet.refused.length });
    await context.close();
  }
} else if (mode === "broken-deployment" || mode === "testnet-unverified") {
  const testnet = mode === "testnet-unverified";
  let reason = null;
  for (const width of [1440, 390]) {
    for (const path of ROUTES) {
      // On the 1952 target the local test wallet is on another chain; connect it anyway to cover banner stacking.
      const { context, page, wallet, errors, status } = await open(path, { width });
      const banner = page.locator('[data-testid="deployment-banner"]');
      await banner.waitFor({ timeout: 30_000 }).catch(() => {});
      expect(status === 200, `${path} @${width}: HTTP ${status}`);
      expect((await banner.count()) === 1, `${path} @${width}: deployment banner missing`);
      expect((await page.locator('[data-testid="fixture-banner"]').count()) === 0, `${path} @${width}: fixture banner shown: a failed chain check must not turn into example data`);
      expect((await page.getByText("Example", { exact: true }).count()) === 0 || path === "/studio/create" || path === "/circuits", `${path} @${width}: example-labelled data shown in chain mode`);
      expect((await page.locator('button:not([disabled])[data-testid="submit"], button:not([disabled])[data-testid="create-market"], button:not([disabled])[data-testid^="create-account-"], button:not([disabled])[data-testid="withdraw-open"]').count()) === 0, `${path} @${width}: an enabled write button`);
      expect((await overflow(page)) <= 0, `${path} @${width}: horizontal overflow ${await overflow(page)}px with the banner`);
      expect(errors.length === 0, `${path} @${width}: page errors: ${errors.join(" | ")}`);
      expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${path} @${width}: a transaction was attempted`);
      if (testnet) expect((await page.locator('[data-testid="network-pill"]:visible').first().innerText()).includes("Testnet"), `${path} @${width}: network label is not Testnet`);
      reason ??= (await banner.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (["/sentinel", "/markets", "/sentinel/activity"].includes(path)) {
        const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
        expect(/unavailable/i.test(main), `${path} @${width}: no "unavailable" state in the page body`);
        expect(/could not be verified/i.test(main), `${path} @${width}: the page body does not say why`);
        await shot(page, `${mode}${path.replace(/\//g, "-")}-${width}`);
      }
      await context.close();
    }
  }
  notes.push({ bannerText: reason });
  expect(reason && /Live data unavailable/.test(reason), "banner text missing");
} else if (mode === "rejected-manifest") {
  const expectReason = new RegExp(process.env.EXPECT_REASON ?? "rejected for live use");
  for (const path of ["/sentinel", "/markets", "/markets/example-0", "/sentinel/activity"]) {
    const { context, page, wallet, errors, status } = await open(path, { connect: false });
    expect(status === 200, `${path}: HTTP ${status}`);
    expect((await page.locator('[data-testid="fixture-banner"]').count()) === 1, `${path}: fixture banner missing although the manifest was rejected`);
    expect((await page.locator('[data-testid="deployment-banner"]').count()) === 0, `${path}: deployment banner shown in fixture mode`);
    expect(errors.length === 0, `${path}: page errors: ${errors.join(" | ")}`);
    expect(wallet.sent.length === 0, `${path}: a transaction was attempted`);
    if (path === "/markets/example-0") {
      await page.locator('[data-testid="fixture-banner"]').getByRole("button", { name: /Why/ }).click();
      const why = (await page.locator("dialog[open]").innerText()).replace(/\s+/g, " ");
      expect(expectReason.test(why), `the "Why?" sheet does not give the rejection reason: ${why.slice(0, 300)}`);
      notes.push({ reasonShown: /Reason (.*?) Market data/.exec(why)?.[1] ?? why.slice(0, 300) });
      await shot(page, `rejected-manifest-${process.env.CASE ?? "case"}-why`);
      await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
      const panel = page.locator('aside [data-testid="action-panel"]');
      await panel.locator('input[inputmode="decimal"]').fill("1");
      await page.waitForTimeout(600);
      expect(await panel.locator('[data-testid="submit"]').isDisabled(), "write button enabled in fixture mode");
    }
    await context.close();
  }
} else if (mode === "circuits-fail-closed") {
  const { readFileSync } = await import("node:fs");
  const real = JSON.parse(readFileSync(new URL("../../../packages/chain-config/expansion/tapeout-196.json", import.meta.url), "utf8"));
  // Public CPU-creation transaction of CPU 410 (docs/coordination/D8b-v2-three-circuits.md): a real, successful
  // mainnet receipt that is NOT a circuit fabrication and was not sent to the processor.
  const NOT_A_FABRICATION = "0x49f3a5997dc717ca398af2ec23681c18d0644723970d1bc80b27078b435c2f9e";
  const test = structuredClone(real);
  Object.assign(test.circuits[0], { publishedId: "1", publicReceipt: NOT_A_FABRICATION }); // third-party circuit #1, wrong receipt
  Object.assign(test.circuits[1], { publishedId: "2", publicReceipt: `0x${"ab".repeat(32)}` }); // a receipt that does not exist
  Object.assign(test.circuits[2], { publishedId: "3", publicReceipt: null }); // an ID without a receipt
  if (process.env.PREPARE) {
    writeFileSync(resolve(process.env.PREPARE), JSON.stringify(test, null, 2));
    console.log(`wrote the test configuration to ${resolve(process.env.PREPARE)}`);
    await browser.close();
    process.exit(0);
  }
  const { context, page, errors, status } = await open("/circuits", { walletChainId: "0x7a0", watch: account, connect: false });
  expect(status === 200 && errors.length === 0, `HTTP ${status}, page errors: ${errors.join(" | ")}`);
  const card = page.locator('[data-testid="peridot-mainnet-circuits"]');
  expect((await card.getAttribute("data-published")) === "2" && (await card.getAttribute("data-total")) === "3", `the test configuration is not the one being served (published=${await card.getAttribute("data-published")})`);
  const panel = (kind) => card.locator(`[data-circuit="${kind}"]`);
  const result = (kind) => panel(kind).locator('[data-testid="native-result"]');
  const settled = (kind) => page.waitForFunction((k) => !["loading", null].includes(document.querySelector(`[data-circuit="${k}"] [data-testid="native-result"]`)?.getAttribute("data-state") ?? null), kind, { timeout: 90_000 }).catch(() => {});
  await settled("MARKET");
  await settled("ACCOUNT");
  const read = async (kind) => ({ state: await result(kind).getAttribute("data-state"), output: await result(kind).getAttribute("data-output"), block: await result(kind).getAttribute("data-block"), text: (await result(kind).innerText()).replace(/\s+/g, " ").slice(0, 260) });
  const market = await read("MARKET");
  const accountPanel = await read("ACCOUNT");
  expect(market.state === "refused" && market.output === "" && /not sent to the configured processor/.test(market.text), `MARKET with a non-fabrication receipt: ${JSON.stringify(market)}`);
  expect(accountPanel.state === "refused" && accountPanel.output === "" && /no receipt for the configured publication transaction/.test(accountPanel.text), `ACCOUNT with a receipt that does not exist: ${JSON.stringify(accountPanel)}`);
  expect((await panel("EXECUTION").getAttribute("data-publication")) === "incomplete" && (await panel("EXECUTION").locator('[data-testid="native-eval"]').count()) === 0 && /Not yet published/.test(await panel("EXECUTION").innerText()) && /without its publication receipt/.test(await panel("EXECUTION").innerText()), "EXECUTION with an ID but no receipt is not shown as not published");
  expect(!/The circuit answers (allow|deny)/.test(await card.innerText()), "a decision is shown for a circuit whose publication could not be verified");
  // Changing an input re-pins a block and still refuses; an input that cannot be encoded is its own state.
  await panel("MARKET").locator('[data-testid="native-ltv"]').fill("6501");
  await page.waitForTimeout(600);
  await settled("MARKET");
  const again = await read("MARKET");
  expect(again.state === "refused" && BigInt(again.block || "0") >= BigInt(market.block || "0") && again.output === "", `after changing the input: ${JSON.stringify(again)}`);
  await panel("MARKET").locator('[data-testid="native-ltv"]').fill("16384");
  await page.waitForTimeout(400);
  expect((await result("MARKET").getAttribute("data-state")) === "bad-input" && /cannot be encoded/.test(await result("MARKET").innerText()), "an out-of-range LTV is not shown as an input error");
  expect(/Evidence, not enforcement/.test(await card.innerText()) && /Native evaluation \(read-only\)/.test(await card.innerText()), "the native evaluation is not worded as read-only evidence");
  notes.push({ market, account: accountPanel, afterInputChange: again });
  await shot(page, "circuits-fail-closed-1440");
  await context.close();
} else if (mode === "testnet-live") {
  const { readFileSync } = await import("node:fs");
  // The expected links come from the app's own configuration, so this check cannot drift from it. The root itself is
  // pinned once here: "Block explorer URL" for chain 1952 on the official X Layer network-information page
  // (web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information), read 2026-11-26.
  const { explorerTxUrl, FAUCET_URL, LOG_PAGE_BLOCKS } = await import("../src/lib/chains.ts");
  const DOCS_EXPLORER_ROOT = "https://www.okx.com/web3/explorer/xlayer-test";
  const manifest = JSON.parse(readFileSync(new URL("../../../packages/chain-config/deployments/1952.json", import.meta.url), "utf8"));
  const receipt = JSON.parse(readFileSync(new URL("../../../evidence/testnet/keeper-auto-repay-1952.json", import.meta.url), "utf8"));
  if (manifest.status !== "deployed") throw new Error("The 1952 manifest is not deployed");
  const expectedTxUrl = explorerTxUrl(1952, receipt.txHash);
  expect(expectedTxUrl === `${DOCS_EXPLORER_ROOT}/tx/${receipt.txHash}`, `the app's explorer root differs from the documented one: ${expectedTxUrl}`);
  const market = manifest.markets[0].controller;
  const demoOwner = process.env.WATCH_ADDRESS ?? "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67"; // public address from AGENTS.md; no key is used or needed
  const wallets = [{ name: "empty-wallet", address: account }, { name: "demo-owner-watch-only", address: demoOwner }];
  const only = process.env.ONLY_WALLET;
  const widths = (process.env.WIDTHS ?? "1440,390").split(",").map(Number);
  const settle = async (page) => {
    // The in-browser check retries flaky reads with backoff, so give it time before judging the banners.
    await page.waitForFunction(() => !document.querySelector("[data-loading]") && !document.querySelector('[data-keeper="loading"]'), null, { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };
  const loads = { total: 0, deploymentBanner: 0, pageErrors: 0, slowest: { ms: 0, tag: "" } };
  for (const who of wallets.filter((entry) => !only || entry.name === only)) {
    for (const width of widths) {
      for (const path of ["/", "/markets", "/markets?view=borrow", `/markets/${market}`, "/sentinel", `/sentinel/policy?market=${market}`, `/automate?market=${market}`, "/sentinel/activity", "/connect", "/studio", "/studio/create", "/circuits"]) {
        // ONLY_PATHS=<regex> narrows a development run. An evidence run never sets it (the result file records it).
        if (process.env.ONLY_PATHS && !new RegExp(process.env.ONLY_PATHS).test(path)) continue;
        const tag = `${who.name} ${path.replace(market, "<market0>")} @${width}`;
        const started = Date.now();
        // "/" is the landing page: it has no wallet button and no app shell.
        const { context, page, wallet, errors, status } = await open(path, { width, walletChainId: "0x7a0", watch: who.address, connect: path !== "/" });
        await settle(page);
        // Everything is rendered by now: a lookup of an element that is legitimately absent (no banner, no faucet
        // notice) must not sit out Playwright's 30 s default. Explicit waits below pass their own timeout.
        page.setDefaultTimeout(2500);
        const ms = Date.now() - started;
        loads.total++;
        if (ms > loads.slowest.ms) loads.slowest = { ms, tag };
        expect(status === 200, `${tag}: HTTP ${status}`);
        expect((await page.locator('[data-testid="fixture-banner"]').count()) === 0, `${tag}: fixture banner on a deployed testnet target`);
        const deploymentBanner = await page.locator('[data-testid="deployment-banner"]').innerText().catch(() => null);
        if (deploymentBanner !== null) loads.deploymentBanner++;
        expect(deploymentBanner === null, `${tag}: deployment check failed against the real deployment: ${deploymentBanner?.replace(/\s+/g, " ").slice(0, 200)}`);
        expect((await overflow(page)) <= 0, `${tag}: horizontal overflow ${await overflow(page)}px`);
        if (errors.length) loads.pageErrors++;
        expect(errors.length === 0, `${tag}: page errors: ${errors.join(" | ")}`);
        const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
        expect(!/could not be verified/i.test(main), `${tag}: a read reports an unverified deployment`);
        if (path === "/") {
          // Status section is derived from the manifest: it must say testnet, mock tokens and mock feed, and must not
          // still say "not deployed". The reference processor is never called TapeOut.
          expect(/Contracts deployed on X Layer testnet/.test(main) && /mock tokens and a mock price feed/i.test(main), `${tag}: the landing status does not describe the testnet deployment honestly: ${main.slice(0, 200)}`);
          expect(!/No Peridot contract is deployed/.test(main), `${tag}: the landing page still says nothing is deployed`);
          expect(/development reference processor/i.test(main), `${tag}: the landing page does not name the development reference processor`);
          const landing = await page.evaluate(() => ({ title: document.title, brand: document.querySelector('[data-testid="brand"]')?.textContent ?? "", tagline: document.querySelector('[data-testid="tagline"]')?.textContent ?? "", positioning: document.querySelector('[data-testid="positioning"]')?.textContent ?? "", body: document.body.innerText }));
          expect(/Peridot Sentinel/.test(landing.title) && landing.brand.includes("sentinel.") && landing.brand.includes("By Peridot"), `${tag}: wordmark or title is not Peridot Sentinel (${landing.title} / ${landing.brand})`);
          expect(/Your money\.\s*Your rules\.\s*Your intelligence\./.test(landing.tagline) && landing.positioning.includes("The Financial Operating System for the Agent Economy."), `${tag}: tagline or positioning line missing`);
          expect(!/Peridot Markets/.test(landing.body), `${tag}: the old product name is still shown`);
          await shot(page, `testnet-landing-${width}`);
          expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${tag}: the page asked the wallet for ${JSON.stringify(wallet.refused)}`);
          await context.close();
          continue;
        }
        expect((await page.locator('[data-testid="wrong-network-banner"]').count()) === 0, `${tag}: wrong-network banner for a wallet on 1952`);
        expect((await page.locator('[data-testid="network-pill"]:visible').first().innerText()).includes("Testnet"), `${tag}: network label is not Testnet`);
        const gas = await page.locator('[data-testid="gas-banner"]').count();
        if (path === "/markets?view=borrow") {
          expect((await page.locator("[data-view]").first().getAttribute("data-view")) === "borrow" && (await page.locator("h1").innerText()) === "Borrow" && /Borrow rate/.test(main) && /Policy cap/.test(main), `${tag}: the Borrow view does not lead with borrowing terms`);
          if (width === 1440) expect((await page.locator('aside nav [data-nav="borrow"][aria-current="page"]').count()) === 1 && (await page.locator('aside nav [data-nav="earn"][aria-current="page"]').count()) === 0, `${tag}: the Borrow nav item is not the active one`);
          await shot(page, `testnet-${who.name}-borrow-${width}`);
        }
        if (path === "/markets") {
          expect((await page.locator("[data-view]").first().getAttribute("data-view")) === "earn" && (await page.locator("h1").innerText()) === "Earn" && /Supply rate/.test(main), `${tag}: the Earn view does not lead with the supply rate`);
          expect(/mCOL|MockCollateral|Test tokens/.test(main), `${tag}: market list did not load from testnet: ${main.slice(0, 200)}`);
          expect(/Test tokens/.test(main), `${tag}: mock tokens are not labelled "Test tokens"`);
          const faucet = await page.locator('[data-testid="gas-banner"] a').getAttribute("href").catch(() => null);
          const gasText = (await page.locator('[data-testid="gas-banner"]').innerText().catch(() => "")).replace(/\s+/g, " ");
          notes.push({ wallet: who.name, width, gasBanner: gas === 1, faucet, gasText });
          if (who.name === "empty-wallet") expect(gas === 1 && faucet === FAUCET_URL && /no test OKB/.test(gasText), `${tag}: no faucet notice for a wallet without test OKB (banner ${gas}, link ${faucet})`);
          else expect(gas === 0, `${tag}: faucet notice shown for a wallet that holds test OKB`);
          await shot(page, `testnet-${who.name}-markets-${width}`);
        }
        if (path.startsWith("/markets/")) {
          await page.evaluate(() => document.querySelectorAll("details").forEach((node) => (node.open = true)));
          await page.waitForTimeout(200);
          const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
          expect(/Development reference processor — not TapeOut/.test(text), `${tag}: the processor is not labelled as the development reference processor`);
          expect(/Test price feed \(mock, owner-set\)/.test(text) && /Mock feed/.test(text), `${tag}: the price feed is not labelled as a mock`);
          expect(/APR \(simple, variable\)/.test(text) && !/APY/.test(text), `${tag}: rate label`);
          expect(new RegExp(manifest.tapeout.processor, "i").test(text), `${tag}: processor address from the manifest not shown in the circuit identity`);
          expect((await overflow(page)) <= 0, `${tag}: overflow ${await overflow(page)}px with disclosures open`);
          await shot(page, `testnet-${who.name}-market-${width}`);
          if (who.name === "demo-owner-watch-only" && width === 1440) {
            // Independent rejection on the PUBLIC testnet, as a simulation only (eth_call as the owner's public address;
            // nothing is signed or sent). The account's policy cap is below the market's, so a borrow that lands between
            // the two is stopped by the account policy alone.
            const panel = page.locator('aside [data-testid="action-panel"]');
            await panel.getByRole("button", { name: /^Sentinel account/ }).click();
            await panel.getByRole("tab", { name: "Borrow" }).click();
            const amountText = process.env.TESTNET_REJECT_BORROW ?? "12";
            await panel.locator('input[inputmode="decimal"]').fill(amountText);
            const rejection = panel.locator("[data-rejection]").first();
            await rejection.waitFor({ timeout: 60_000 }).catch(() => {});
            const category = await rejection.getAttribute("data-rejection").catch(() => null);
            const other = panel.locator('[data-testid="other-layer"]');
            const otherLayer = (await other.count()) ? { layer: await other.getAttribute("data-layer"), verdict: await other.getAttribute("data-verdict"), basis: await other.getAttribute("data-basis"), text: (await other.innerText()).replace(/\s+/g, " ") } : null;
            const rejectionText = (await rejection.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
            notes.push({ testnetRejectionSimulation: { borrow: `${amountText} mUSD through the Sentinel account`, category, rejectionText, otherLayer, sent: wallet.sent.length } });
            expect(category === "account-policy", `${tag}: a Sentinel borrow of ${amountText} mUSD should be stopped by the account policy in simulation, got ${category}: ${rejectionText}`);
            expect(otherLayer?.verdict === "allow", `${tag}: the market policy is not shown as allowing the same borrow: ${JSON.stringify(otherLayer)}`);
            expect(await panel.locator('[data-testid="submit"]').isDisabled(), `${tag}: submit is enabled for a rejected borrow`);
            await shot(page, "testnet-simulated-account-policy-rejection-1440");
          }
        }
        if (path === "/sentinel") {
          const accounts = await page.locator('[data-testid="sentinel-account"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.account));
          notes.push({ wallet: who.name, width, sentinelAccounts: accounts });
          if (who.name === "demo-owner-watch-only") expect(accounts.some((entry) => entry?.toLowerCase() === receipt.sentinelAccount.toLowerCase()), `${tag}: the demo Sentinel account ${receipt.sentinelAccount} is not shown for its owner (got ${JSON.stringify(accounts)})`);
          else expect(accounts.length === 0, `${tag}: accounts shown for a wallet that has none`);
          // Navigation: product areas per D11, and nothing planned is a link.
          const brand = (await page.locator('[data-testid="brand"]:visible').first().innerText()).replace(/\s+/g, " ");
          expect(brand.includes("sentinel."), `${tag}: wordmark is "${brand}"`);
          if (width === 1440) {
            const rail = await page.locator("aside nav [data-nav]").evaluateAll((nodes) => nodes.map((node) => ({ key: node.dataset.nav, status: node.dataset.navStatus, link: node.tagName === "A", text: node.innerText.replace(/\s+/g, " ").trim() })));
            notes.push({ wallet: who.name, rail });
            expect(rail.map((item) => item.key).join(",") === "overview,earn,borrow,trade,automate,studio,circuits,connect,about", `${tag}: rail items are ${rail.map((item) => item.key).join(",")}`);
            const trade = rail.find((item) => item.key === "trade");
            expect(trade && !trade.link && trade.status === "planned" && /Planned/.test(trade.text), `${tag}: Trade must be a non-link marked Planned: ${JSON.stringify(trade)}`);
            // Connect was verified on public testnet (evidence/session5-mcp/flagship-1952.json): a real link, no "In development".
            const connectNav = rail.find((item) => item.key === "connect");
            expect(connectNav?.link === true && connectNav.status === "live" && !/In development|Planned/.test(connectNav.text), `${tag}: Connect must be a live link without a status chip: ${JSON.stringify(connectNav)}`);
          } else {
            const tabs = await page.locator('nav[aria-label="Primary"]:visible [data-nav]').evaluateAll((nodes) => nodes.map((node) => node.dataset.nav));
            expect(tabs.join(",") === "overview,earn,borrow,automate,more", `${tag}: tab bar is ${tabs.join(",")}`);
            await page.locator('[data-nav="more"]:visible').click();
            const more = await page.locator('[data-testid="more-nav"] [data-nav]').evaluateAll((nodes) => nodes.map((node) => ({ key: node.dataset.nav, link: node.tagName === "A", text: node.innerText.replace(/\s+/g, " ").trim() })));
            expect(more.map((item) => item.key).join(",") === "trade,studio,circuits,connect,about" && more.find((item) => item.key === "trade")?.link === false, `${tag}: "More" lists ${JSON.stringify(more)}`);
            await shot(page, `testnet-${who.name}-more-nav-${width}`);
            await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
          }
          const portfolio = await page.locator('[data-testid="portfolio"] tr[data-portfolio-row]').evaluateAll((nodes) => nodes.map((node) => ({ kind: node.dataset.portfolioRow, text: node.innerText.replace(/\s+/g, " ").trim() })));
          notes.push({ wallet: who.name, width, portfolio });
          expect(/Peridot lending only/.test(await page.locator('[data-testid="portfolio-scope"]').innerText()), `${tag}: the portfolio does not say which position types it covers`);
          if (who.name === "demo-owner-watch-only") expect(portfolio.some((row) => row.kind === "sentinel" && /100 mCOL/.test(row.text) && /mUSD/.test(row.text)), `${tag}: the demo account's lending position is not in the portfolio: ${JSON.stringify(portfolio)}`);
          else expect(portfolio.length === 1 && portfolio[0].kind === "none", `${tag}: positions shown for a wallet that has none: ${JSON.stringify(portfolio)}`);
          await shot(page, `testnet-${who.name}-sentinel-${width}`);
        }
        if (path.startsWith("/sentinel/policy") && who.name === "demo-owner-watch-only") {
          expect((await page.locator('[data-testid="open-automate"]').getAttribute("href")) === `/automate?market=${market}`, `${tag}: the policy page does not point at Automate`);
          await shot(page, `testnet-${who.name}-policy-${width}`);
        }
        if (path.startsWith("/automate")) {
          const modes = Object.fromEntries(await page.locator('[data-testid="automation-modes"] [data-mode]').evaluateAll((nodes) => nodes.map((node) => [node.dataset.mode, node.dataset.availability])));
          notes.push({ wallet: who.name, width, modes });
          // Only what works is called live. Connect is available on testnet as agent-directed execution; hosted AI is not built.
          expect(modes["rule-based"] === "live" && modes.connect === "live" && modes.hosted === "planned", `${tag}: mode availability is ${JSON.stringify(modes)}`);
          const connectText = (await page.locator("#connect").innerText()).replace(/\s+/g, " ");
          expect(/Available on testnet \(agent-directed\)/.test(connectText) && /scripted external MCP client/.test(connectText) && !/In development|not available in this app yet/.test(connectText), `${tag}: the Connect section is not labelled "Available on testnet (agent-directed)": ${connectText.slice(0, 200)}`);
          expect(/Available on testnet \(agent-directed\)/.test(await page.locator('[data-testid="automation-modes"] [data-mode="connect"]').innerText()), `${tag}: the Connect mode card does not carry the testnet availability label`);
          expect((await page.locator('#connect [data-testid="connect-open"]').getAttribute("href")) === "/connect", `${tag}: the Connect section does not link to /connect`);
          expect(/does not exist yet/.test(await page.locator("#hosted").innerText()), `${tag}: hosted AI is not described as unavailable`);
          // Neither section offers a control: Connect is set up outside this app, hosted AI does not exist.
          expect((await page.locator("#connect button, #connect input, #hosted button, #hosted input").count()) === 0, `${tag}: Connect or hosted AI offers a control on Automate`);
          expect(!/autonomous|monitors? your|continuous(ly)? monitor/i.test(main), `${tag}: Automate claims autonomous or continuous monitoring`);
          if (who.name === "demo-owner-watch-only") {
            // Operator candidates come from a paged log scan, which finishes after the page's first paint.
            await page.locator('[data-testid="automation"] li[data-operator]').first().waitFor({ timeout: 60_000 }).catch(() => {});
            const operators = await page.locator('[data-testid="automation"] li[data-operator]').evaluateAll((nodes) => nodes.map((node) => ({ operator: node.dataset.operator, mask: node.dataset.mask, text: node.innerText.replace(/\s+/g, " ").slice(0, 220) })));
            const stop = page.locator('[data-testid="emergency-stop"]');
            const outline = await page.locator('[data-testid="strategy-outline"] [data-field]').evaluateAll((nodes) => nodes.map((node) => ({ field: node.dataset.field, status: node.dataset.availability, text: node.innerText.replace(/\s+/g, " ").slice(0, 160) })));
            notes.push({ wallet: who.name, width, operators, emergencyStop: { operators: await stop.getAttribute("data-operators"), trigger: await stop.getAttribute("data-trigger"), scope: (await page.locator('[data-testid="emergency-stop-scope"]').innerText()).replace(/\s+/g, " ") }, outline });
            expect(operators.some((entry) => entry.operator?.toLowerCase() === receipt.operator.toLowerCase() && entry.mask === "8"), `${tag}: the live repay-only grant for ${receipt.operator} is not shown (got ${JSON.stringify(operators)})`);
            expect((await stop.getAttribute("data-operators")) === "1" && Number(await stop.getAttribute("data-trigger")) > 0, `${tag}: the emergency stop does not see the live operator and trigger`);
            expect(outline.length === 6 && outline.find((row) => row.field === "Approved protocols")?.status === "planned" && outline.filter((row) => row.status === "live").length === 5, `${tag}: strategy outline is ${JSON.stringify(outline.map((row) => [row.field, row.status]))}`);
            // On-chain agent activity for THIS account, independent of any keeper service: the public auto-repay.
            const repays = page.locator('[data-testid="account-repays"]');
            await repays.locator("[data-account-repay]").first().waitFor({ timeout: 60_000 }).catch(() => {});
            const repayRows = await repays.locator("[data-account-repay]").evaluateAll((nodes) => nodes.map((node) => ({ hash: node.dataset.accountRepay, link: node.querySelector("a")?.getAttribute("href") ?? null })));
            notes.push({ wallet: who.name, width, accountRepays: repayRows, discovery: await stop.getAttribute("data-discovery"), partialNote: (await page.locator('[data-testid="emergency-stop-partial"]').innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 260) });
            expect(repayRows.some((row) => row.hash?.toLowerCase() === receipt.txHash.toLowerCase() && row.link === expectedTxUrl), `${tag}: the account's public auto-repay ${receipt.txHash} is not shown on Automate with its explorer link: ${JSON.stringify(repayRows)}`);
            // The operator list comes from a scan with a gap on testnet: the stop must say "found", not "every".
            expect((await stop.getAttribute("data-discovery")) === "partial" && /the operators this page found/.test(await stop.innerText()) && !/Revokes every operator/.test(await stop.innerText()) && (await page.locator("#emergency-extra").count()) === 1, `${tag}: the emergency stop overstates what it knows about operators on a partially scanned chain`);
          } else {
            expect(/No Sentinel account yet/.test(main), `${tag}: no empty state for a wallet without an account`);
            expect((await page.locator('[data-testid="emergency-stop"]').count()) === 0, `${tag}: an emergency stop is offered without an account`);
          }
          await shot(page, `testnet-${who.name}-automate-${width}`);
        }
        if (path === "/connect") {
          const flagship = JSON.parse(readFileSync(new URL("../../../evidence/session5-mcp/flagship-1952.json", import.meta.url), "utf8"));
          const runHash = flagship.steps["5"].receipt.hash;
          const root = page.locator('[data-testid="connect"]');
          expect((await root.getAttribute("data-connect")) === "available" && /Available on testnet \(agent-directed\)/.test(main), `${tag}: Connect is not shown as available on testnet (agent-directed)`);
          expect(/agent-directed execution/.test(main) && !/autonomous|continuous(ly)? monitor/i.test(main), `${tag}: Connect must be called agent-directed execution and never autonomous monitoring`);
          expect(/mock tokens/i.test(main) && /development reference processor \(not TapeOut\)/.test(main), `${tag}: the Connect page does not carry the testnet scope label`);
          // Tools: the recorded catalogue, exactly one of which can send.
          const tools = await page.locator('[data-testid="connect-tools"] [data-tool]').evaluateAll((nodes) => nodes.map((node) => ({ name: node.dataset.tool, kind: node.dataset.kind })));
          expect(tools.length === 12 && tools.filter((tool) => tool.kind === "execute").map((tool) => tool.name).join() === "sentinel_execute_auto_repay", `${tag}: tool list is ${JSON.stringify(tools)}`);
          // Limits and setup: no owner key, no withdraw, no permission changes, no arbitrary calldata; a keyless stdio command.
          const cannot = (await page.locator('[data-testid="connect-cannot"]').innerText()).replace(/\s+/g, " ");
          expect(/owner's key/.test(cannot) && /Withdraw/.test(cannot) && /Change permissions/.test(cannot) && /arbitrary calldata/.test(cannot), `${tag}: the "cannot" list is incomplete: ${cannot.slice(0, 200)}`);
          expect(/^node \S+services\/mcp\/server\.mjs$/.test((await page.locator('[data-testid="connect-command"]').innerText()).trim()), `${tag}: the stdio command is not shown`);
          expect(/never entered on this page/.test(await page.locator('[data-testid="connect-key-note"]').innerText()), `${tag}: the page does not say the operator key is never entered here`);
          expect((await root.locator("input, textarea, select").count()) === 0, `${tag}: the Connect page has an input (it must never take a key)`);
          // The recorded run: one explorer link, to the public execute transaction. A simulation never gets one.
          const txLinks = await root.locator('a[href*="/tx/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
          expect(txLinks.length === 2 && txLinks.every((href) => href === explorerTxUrl(1952, runHash)), `${tag}: explorer transaction links on Connect are ${JSON.stringify(txLinks)}`);
          expect((await page.locator('[data-testid="connect-run"] [data-step]').count()) === 7, `${tag}: the recorded run does not show seven steps`);
          expect((await page.locator('[data-step="6"] a').count()) === 0 && /Simulated rejection · not a mined revert/.test(await page.locator('[data-step="6"]').innerText()) && (await page.locator('[data-testid="connect-rejection"]').getAttribute("data-error")) === "OperatorNotAuthorized", `${tag}: step 6 is not shown as a simulated rejection`);
          const quote = page.locator('[data-testid="connect-quote"]');
          const quoteText = (await quote.innerText()).replace(/\s+/g, " ");
          expect((await quote.getAttribute("data-available")) === "false" && /Quote unavailable/.test(quoteText) && !/\d[\d,.]* (WOKB|USDC)/.test(quoteText), `${tag}: the unavailable quote is shown as "${quoteText.slice(0, 160)}"`);
          // Kinds of evidence stay apart: scripted client verified, LLM session pending, simulated rejection, no mined revert.
          const kinds = Object.fromEntries(await page.locator('[data-testid="connect-evidence"] [data-evidence]').evaluateAll((nodes) => nodes.map((node) => [node.dataset.evidence, node.dataset.status])));
          expect(kinds.scripted === "Verified" && kinds.llm === "Pending" && /nothing sent/.test(kinds["simulated-rejection"] ?? "") && kinds["mined-revert"] === "None recorded", `${tag}: evidence kinds are ${JSON.stringify(kinds)}`);
          // The live grant must equal a direct RPC read at the block the page names.
          const grant = page.locator('[data-testid="connect-grant"]');
          await page.waitForFunction(() => ["ok", "error"].includes(document.querySelector('[data-testid="connect-grant"]')?.getAttribute("data-state") ?? ""), null, { timeout: 60_000 }).catch(() => {});
          const shown = { state: await grant.getAttribute("data-state"), readiness: await grant.getAttribute("data-readiness"), remaining: await grant.getAttribute("data-remaining"), mask: await grant.getAttribute("data-mask"), expiry: await grant.getAttribute("data-expiry"), block: await grant.getAttribute("data-block") };
          expect(shown.state === "ok", `${tag}: the live grant read is "${shown.state}"`);
          if (shown.state === "ok") {
            const { SentinelAccountAbi } = await import("@peridot/chain-config");
            const { createPublicClient, http } = await import("viem");
            const { xLayerTestnet } = await import("../src/lib/chains.ts");
            const rpc = createPublicClient({ transport: http(xLayerTestnet.rpcUrls.default.http[0], { retryCount: 5, retryDelay: 400 }) });
            const direct = await rpc.readContract({ address: flagship.steps["1"].account.data.account, abi: SentinelAccountAbi, functionName: "operators", args: [flagship.steps["2"].authorization.data.operator], blockNumber: BigInt(shown.block) });
            const directBlock = await rpc.getBlock({ blockNumber: BigInt(shown.block) });
            expect(String(direct[0]) === shown.mask && direct[1].toString() === shown.remaining && direct[2].toString() === shown.expiry, `${tag}: the page shows grant ${JSON.stringify(shown)} but the RPC says mask ${direct[0]}, remaining ${direct[1]}, expiry ${direct[2]} at block ${shown.block}`);
            const expected = direct[0] === 0 ? "revoked" : direct[0] !== 8 ? "not-repay-only" : direct[2] <= directBlock.timestamp ? "expired" : direct[1] === 0n ? "spent" : "ready";
            expect(shown.readiness === expected, `${tag}: readiness is "${shown.readiness}", expected "${expected}"`);
            notes.push({ wallet: who.name, width, connectGrant: { ...shown, directRead: { mask: direct[0], remaining: direct[1].toString(), expiry: direct[2].toString() } }, tools: tools.length, kinds, txLinks });
          }
          await shot(page, `testnet-${who.name}-connect-${width}`);
        }
        if (path === "/sentinel/activity") {
          const row = page.locator('[data-testid="testnet-auto-repay"]');
          const href = await row.locator('[data-testid="explorer-link"]').getAttribute("href").catch(() => null);
          expect(href === expectedTxUrl, `${tag}: explorer link is ${href}`);
          const reread = row.locator('[data-testid="testnet-receipt-reread"]');
          await reread.waitFor({ timeout: 60_000 }).catch(() => {});
          const rereadText = (await reread.innerText().catch(() => "")).replace(/\s+/g, " ");
          expect((await reread.getAttribute("data-status").catch(() => null)) === "success" && rereadText.includes(`block ${receipt.block}`) && /50\.01% → 37\.51%/.test(rereadText), `${tag}: the public receipt was not re-read from the RPC: "${rereadText}"`);
          if (who.name === "demo-owner-watch-only") await page.locator('[data-testid="chain-activity"] li[data-result]').first().waitFor({ timeout: 90_000 }).catch(() => {});
          else await page.locator('[data-testid="activity-coverage"], [data-testid="chain-activity"]').first().waitFor({ timeout: 90_000 }).catch(() => {});
          const chainRows = await page.locator('[data-testid="chain-activity"] li[data-result]').evaluateAll((nodes) => nodes.map((node) => ({ text: node.innerText.replace(/\s+/g, " ").slice(0, 160), link: node.querySelector("a")?.getAttribute("href") ?? null })));
          const coverageNode = page.locator('[data-testid="activity-coverage"]');
          const coverage = (await coverageNode.innerText().catch(() => "")).replace(/\s+/g, " ");
          const ranges = Number((await coverageNode.locator("[data-ranges]").getAttribute("data-ranges").catch(() => null)) ?? 0);
          const gap = (await coverageNode.locator("[data-gap]").getAttribute("data-gap").catch(() => null)) ?? null;
          // The keeper service on this machine watches the LOCAL chain. On a 1952 build it must never contribute rows.
          // Without KEEPER_API_URL the panel is not rendered at all ("hidden"), which is what the hosted app must do.
          const keeper = (await page.locator('[data-testid="keeper-panel"]').count()) === 0 ? "hidden" : await page.locator('[data-testid="keeper-panel"]').getAttribute("data-keeper");
          const keeperRows = await page.locator('[data-testid="keeper-panel"] li[data-keeper-state], [data-testid="keeper-panel"] [data-chain-repay]').count();
          const keeperText = (await page.locator('[data-testid="keeper-message"]').first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
          notes.push({ wallet: who.name, width, ms, explorerLink: href, reread: rereadText, onChainEntries: chainRows.length, autoRepayInScan: chainRows.some((entry) => /Auto-repay/.test(entry.text)), coverage: coverage || "complete from the deployment block", ranges, unreadBlocks: gap, keeperPanel: keeper, keeperRows, keeperText });
          expect(["hidden", "scope-mismatch", "unavailable"].includes(keeper ?? "") && keeperRows === 0, `${tag}: keeper panel is "${keeper}" with ${keeperRows} row(s): a local keeper must not report into a testnet build`);
          if (process.env.EXPECT_KEEPER) expect(keeper === process.env.EXPECT_KEEPER, `${tag}: keeper panel is "${keeper}", expected "${process.env.EXPECT_KEEPER}"`);
          for (const entry of chainRows) expect(entry.link === null || entry.link.startsWith(`${DOCS_EXPLORER_ROOT}/tx/0x`), `${tag}: unexpected link ${entry.link}`);
          // Coverage is stated whenever the scan is incomplete: both ends named, with the number of unread blocks.
          if (coverage) expect(ranges === 2 && /deployment block/.test(coverage) && /have not been read/.test(coverage) && BigInt(gap ?? "0") > 0n && coverage.includes(`${LOG_PAGE_BLOCKS} blocks at a time`), `${tag}: incomplete scan is not described precisely: "${coverage}" (ranges ${ranges}, gap ${gap})`);
          // Paged from the deployment block: the recorded auto-repay (452 blocks after it) must be found by the scan
          // itself, with its explorer link, not only by the receipt re-read above.
          if (who.name === "demo-owner-watch-only") expect(chainRows.some((entry) => /Auto-repay/.test(entry.text) && entry.link === expectedTxUrl), `${tag}: the scan from the deployment block did not find the recorded auto-repay ${receipt.txHash} (${chainRows.length} entries)`);
          else expect(chainRows.length === 0, `${tag}: on-chain entries shown for a wallet with no activity`);
          await shot(page, `testnet-${who.name}-activity-${width}`);
        }
        if (path === "/circuits") {
          // Peridot's own circuits: published exactly as the single configuration file says, and never called enforcement.
          const tapeout = JSON.parse(readFileSync(new URL("../../../packages/chain-config/expansion/tapeout-196.json", import.meta.url), "utf8"));
          const configured = tapeout.circuits.filter((circuit) => circuit.publishedId !== null && circuit.publicReceipt !== null).length;
          const own = page.locator('[data-testid="peridot-mainnet-circuits"]');
          const ownText = (await own.innerText()).replace(/\s+/g, " ");
          const states = await own.locator("[data-circuit]").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.circuit}:${node.dataset.publication}:${node.dataset.circuitId}`));
          notes.push({ wallet: who.name, width, peridotCircuits: states, configuredPublished: configured });
          expect((await own.getAttribute("data-published")) === String(configured) && states.length === 3, `${tag}: Peridot circuits shown as ${JSON.stringify(states)} but the configuration publishes ${configured}`);
          expect((await own.locator('[data-testid="native-eval"]').count()) === configured && (await own.locator('[data-testid="not-published"]').count()) === 3 - configured, `${tag}: evaluation panels do not match the published circuits`);
          expect(/Native evaluation \(read-only\)/.test(ownText) && /Evidence, not enforcement/.test(ownText) && !/enforced on mainnet/i.test(ownText), `${tag}: the native evaluation is not worded as read-only evidence`);
          expect((await own.locator('[data-testid="peridot-processor"]').getAttribute("href")) === `https://www.okx.com/web3/explorer/xlayer/address/${tapeout.processor}`, `${tag}: Peridot's processor link is wrong`);
          expect(/Third-party circuit/.test(await page.locator('[data-testid="live-mainnet-eval"]').innerText()) && /not a Peridot circuit/i.test(await page.locator('[data-testid="live-mainnet-eval"]').innerText()), `${tag}: the third-party example is not labelled as third-party`);
          // Native TapeOut evidence: a real circuit on X Layer MAINNET, evaluated read-only from this browser.
          const card = page.locator('[data-testid="live-mainnet-eval"]');
          await card.locator('[data-testid="live-result"]').waitFor({ timeout: 45_000 }).catch(() => {});
          const state = await card.getAttribute("data-state");
          const result = card.locator('[data-testid="live-result"]');
          const first = { input: await result.getAttribute("data-input").catch(() => null), output: await result.getAttribute("data-output").catch(() => null) };
          await card.locator('[data-testid="live-input-0"]').click().catch(() => {});
          const second = { input: await result.getAttribute("data-input").catch(() => null), output: await result.getAttribute("data-output").catch(() => null) };
          const table = await card.locator("tr[data-live-row]").evaluateAll((rows) => rows.map((row) => `${row.dataset.liveRow}->${row.dataset.output}`));
          const processorHref = await card.locator('[data-testid="live-processor"]').getAttribute("href").catch(() => null);
          const text = (await card.innerText()).replace(/\s+/g, " ");
          notes.push({ wallet: who.name, width, liveMainnetEval: { state, block: await card.locator('[data-testid="live-block"]').innerText().catch(() => null), first, second, table, processorHref, netlistMatches: await card.locator('[data-testid="live-netlist-match"]').getAttribute("data-match").catch(() => null) } });
          expect(state === "ok", `${tag}: live mainnet evaluation is "${state}": ${text.slice(0, 200)}`);
          expect(first.input === "0x03" && first.output === "0x01" && second.input === "0x02" && second.output === "0x00", `${tag}: eval results ${JSON.stringify([first, second])}, expected 0x03->0x01 then 0x02->0x00`);
          expect(table.join(",") === "0x00->0x00,0x01->0x00,0x02->0x00,0x03->0x01", `${tag}: live truth table is ${table.join(",")}`);
          expect(processorHref === "https://www.okx.com/web3/explorer/xlayer/address/0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF", `${tag}: processor link is ${processorHref}`);
          expect(/chain 196/.test(text) && /not a Peridot circuit/i.test(text) && /no wallet, no transaction/i.test(text), `${tag}: the live evaluation is not labelled as a read-only mainnet read of a non-Peridot circuit`);
          expect((await overflow(page)) <= 0, `${tag}: overflow ${await overflow(page)}px with the live evaluation`);
          await shot(page, `testnet-${who.name}-circuits-live-eval-${width}`);
        }
        // A watch-only wallet must never be asked to sign or send by merely browsing.
        expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${tag}: the page asked the wallet for ${JSON.stringify(wallet.refused)}`);
        console.log(`${failures.length ? "…" : "ok"} ${tag} ${ms} ms`);
        await context.close();
      }
    }
  }
  notes.push({ loads });
} else {
  throw new Error("mode must be wrong-network, broken-deployment, rejected-manifest, testnet-unverified or testnet-live");
}

await browser.close();
const result = { mode, onlyPaths: process.env.ONLY_PATHS ?? null, case: process.env.CASE ?? null, base: BASE, account, readOnlyWallet: true, passed: failures.length === 0, failures, notes };
if (OUT) writeFileSync(`${OUT}/${mode}${process.env.CASE ? `-${process.env.CASE}` : ""}.json`, JSON.stringify(result, null, 2) + "\n");
if (failures.length) {
  console.error(`${mode}: ${failures.length} check(s) FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${mode}${process.env.CASE ? ` (${process.env.CASE})` : ""}: all checks passed. ${JSON.stringify(notes)}`);

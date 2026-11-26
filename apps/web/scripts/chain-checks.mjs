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
const ROUTES = ["/sentinel", "/sentinel/policy", "/sentinel/activity", "/markets", "/studio", "/studio/create", "/circuits"];

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
      for (const path of ["/", "/markets", `/markets/${market}`, "/sentinel", `/sentinel/policy?market=${market}`, "/sentinel/activity", "/studio", "/studio/create", "/circuits"]) {
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
          await shot(page, `testnet-landing-${width}`);
          expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${tag}: the page asked the wallet for ${JSON.stringify(wallet.refused)}`);
          await context.close();
          continue;
        }
        expect((await page.locator('[data-testid="wrong-network-banner"]').count()) === 0, `${tag}: wrong-network banner for a wallet on 1952`);
        expect((await page.locator('[data-testid="network-pill"]:visible').first().innerText()).includes("Testnet"), `${tag}: network label is not Testnet`);
        const gas = await page.locator('[data-testid="gas-banner"]').count();
        if (path === "/markets") {
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
          await shot(page, `testnet-${who.name}-sentinel-${width}`);
        }
        if (path.startsWith("/sentinel/policy") && who.name === "demo-owner-watch-only") {
          // Operator candidates come from a paged log scan, which finishes after the page's first paint.
          await page.locator('[data-testid="automation"] li[data-operator]').first().waitFor({ timeout: 60_000 }).catch(() => {});
          const operators = await page.locator('[data-testid="automation"] li[data-operator]').evaluateAll((nodes) => nodes.map((node) => ({ operator: node.dataset.operator, text: node.innerText.replace(/\s+/g, " ").slice(0, 220) })));
          notes.push({ wallet: who.name, width, operators });
          expect(operators.some((entry) => entry.operator?.toLowerCase() === receipt.operator.toLowerCase()), `${tag}: the live operator grant for ${receipt.operator} is not shown (got ${JSON.stringify(operators)})`);
          await shot(page, `testnet-${who.name}-policy-${width}`);
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
          const keeper = await page.locator('[data-testid="keeper-panel"]').getAttribute("data-keeper");
          const keeperRows = await page.locator('[data-testid="keeper-panel"] li[data-keeper-state], [data-testid="keeper-panel"] [data-chain-repay]').count();
          const keeperText = (await page.locator('[data-testid="keeper-message"]').first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
          notes.push({ wallet: who.name, width, ms, explorerLink: href, reread: rereadText, onChainEntries: chainRows.length, autoRepayInScan: chainRows.some((entry) => /Auto-repay/.test(entry.text)), coverage: coverage || "complete from the deployment block", ranges, unreadBlocks: gap, keeperPanel: keeper, keeperRows, keeperText });
          expect(["not-configured", "scope-mismatch", "unavailable"].includes(keeper ?? "") && keeperRows === 0, `${tag}: keeper panel is "${keeper}" with ${keeperRows} row(s): a local keeper must not report into a testnet build`);
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
const result = { mode, case: process.env.CASE ?? null, base: BASE, account, readOnlyWallet: true, passed: failures.length === 0, failures, notes };
if (OUT) writeFileSync(`${OUT}/${mode}${process.env.CASE ? `-${process.env.CASE}` : ""}.json`, JSON.stringify(result, null, 2) + "\n");
if (failures.length) {
  console.error(`${mode}: ${failures.length} check(s) FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${mode}${process.env.CASE ? ` (${process.env.CASE})` : ""}: all checks passed. ${JSON.stringify(notes)}`);

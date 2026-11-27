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
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";
import { disclosureProblems, hasDisclosures } from "./lib/disclosures.mjs";

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
// Strategy-first routes (DECISIONS D23). The old URLs are redirects and are checked as redirects, never as pages.
const ROUTES = ["/portfolio", "/sentinel/policy", "/activity", "/strategies", "/discover", "/connect", "/trade", "/markets", "/studio", "/studio/create", "/circuits"];
// Expected strings and keys below are taken from DECISIONS D23, not from the rendered page.
const D23 = {
  headline: "Put your portfolio on autopilot.",
  positioning: "Your automated DeFi portfolio",
  tagline: /Your money\.\s*Your rules\.\s*Your intelligence\./,
  ctaCreate: "Create a strategy",
  ctaExplore: "Explore strategies",
  pillars: ["Automate", "Discover", "Build"],
  groups: { personal: ["portfolio", "strategies", "discover", "activity"], finance: ["earn", "borrow", "trade"], builders: ["studio", "circuits", "connect"] },
  redirects: [["/app", "/portfolio"], ["/sentinel", "/portfolio"], ["/sentinel/activity", "/activity"], ["/automate", "/strategies"]],
};
/** Every old URL answers with a temporary redirect to its new route and keeps the query string. Nothing is followed. */
async function checkRedirects() {
  const seen = [];
  for (const [from, to] of D23.redirects) {
    for (const query of ["", "?market=0x0000000000000000000000000000000000000001"]) {
      const response = await fetch(BASE + from + query, { redirect: "manual" });
      const location = response.headers.get("location") ?? "";
      const target = location ? new URL(location, BASE) : null;
      seen.push({ from: from + query, status: response.status, location });
      expect(response.status === 307 && target !== null && target.origin === new URL(BASE).origin && target.pathname === to && target.search === query, `redirect ${from}${query}: HTTP ${response.status} to "${location}", expected 307 to ${to}${query}`);
    }
  }
  // The account policy page shares the /sentinel prefix and must stay a page.
  const policy = await fetch(`${BASE}/sentinel/policy`, { redirect: "manual" });
  expect(policy.status === 200, `/sentinel/policy must not be redirected (HTTP ${policy.status})`);
  notes.push({ redirects: seen });
}
/** Every control that could lead to a signature: none may be enabled when the deployment is not verified. */
const WRITE_BUTTONS = ["submit", "create-market", "withdraw-open", "withdraw-submit", "mint-test-tokens", "strategy-sign", "emergency-stop-submit", "v2-stop-submit", "v2-create-base", "v2-mint-wokb", "v2-mint-collateral", "v2-supply-submit", "v2-grant-submit", "vault-create", "vault-mint", "vault-limits-submit", "vault-submit"].map((id) => `button:not([disabled])[data-testid="${id}"]`).concat('button:not([disabled])[data-testid^="create-account-"]').join(", ");

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
  // 360 px too: a failure reason quotes a full address, which must wrap inside the cards at the narrowest width.
  for (const width of [1440, 390, 360]) {
    for (const path of ROUTES) {
      // On the 1952 target the local test wallet is on another chain; connect it anyway to cover banner stacking.
      const { context, page, wallet, errors, status } = await open(path, { width });
      const banner = page.locator('[data-testid="deployment-banner"]');
      await banner.waitFor({ timeout: 30_000 }).catch(() => {});
      expect(status === 200, `${path} @${width}: HTTP ${status}`);
      expect((await banner.count()) === 1, `${path} @${width}: deployment banner missing`);
      expect((await page.locator('[data-testid="fixture-banner"]').count()) === 0, `${path} @${width}: fixture banner shown: a failed chain check must not turn into example data`);
      expect((await page.getByText("Example", { exact: true }).count()) === 0 || path === "/studio/create" || path === "/circuits", `${path} @${width}: example-labelled data shown in chain mode`);
      expect((await page.locator(WRITE_BUTTONS).count()) === 0, `${path} @${width}: an enabled write button (${await page.locator(WRITE_BUTTONS).evaluateAll((nodes) => nodes.map((node) => node.dataset.testid).join(","))})`);
      expect((await overflow(page)) <= 0, `${path} @${width}: horizontal overflow ${await overflow(page)}px with the banner`);
      expect(errors.length === 0, `${path} @${width}: page errors: ${errors.join(" | ")}`);
      expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${path} @${width}: a transaction was attempted`);
      if (testnet) expect((await page.locator('[data-testid="network-pill"]:visible').first().innerText()).includes("Testnet"), `${path} @${width}: network label is not Testnet`);
      reason ??= (await banner.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (path === "/strategies") {
        // A broken deployment must not offer adoption. Go as far as the page allows: pick each template, enter an
        // operator, ask for the review, then force the sign button. Nothing may reach the wallet.
        const options = await page.locator('[data-testid^="template-option-"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.testid));
        const tried = [];
        for (const option of options.filter((id) => id !== "template-option-imported")) {
          await page.locator(`[data-testid="${option}"]`).click();
          await page.waitForTimeout(200);
          const unavailable = await page.locator('[data-testid="strategy-review-unavailable"]').count();
          const operatorInput = page.locator('[data-testid="strategy-operator"]');
          let plan = 0;
          if (await operatorInput.count()) {
            await operatorInput.fill("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
            const submit = page.locator('[data-testid="strategy-review-submit"]');
            if (await submit.isEnabled().catch(() => false)) {
              await submit.click({ timeout: 5000 }).catch(() => submit.click({ force: true, timeout: 5000 }).catch(() => {}));
              await page.locator('[data-testid="strategy-plan"], [data-testid="strategy-plan-error"]').first().waitFor({ timeout: 30_000 }).catch(() => {});
            }
            plan = await page.locator('[data-testid="strategy-plan"]').count();
          }
          const sign = page.locator('[data-testid="strategy-sign"]');
          const signEnabled = (await sign.count()) ? await sign.isEnabled() : false;
          if (await sign.count()) await sign.click({ force: true }).catch(() => {});
          await page.waitForTimeout(400);
          tried.push({ option, reviewUnavailable: unavailable === 1, planBuilt: plan === 1, signEnabled });
          expect(!signEnabled, `${path} @${width}: ${option}: the sign button is enabled on an unverified deployment`);
          // Not even the review: no plan is built from a chain the browser could not verify.
          expect(unavailable === 1 && plan === 0 && (await operatorInput.count()) === 0, `${path} @${width}: ${option}: a strategy review is offered on an unverified deployment (${JSON.stringify(tried.at(-1))})`);
        }
        expect(options.length >= 2, `${path} @${width}: the template options are missing (${options.join(",")})`);
        expect(wallet.sent.length === 0 && wallet.refused.length === 0, `${path} @${width}: trying to adopt a strategy reached the wallet: ${JSON.stringify(wallet.refused)}`);
        if (width === 1440) notes.push({ adoptionOnBrokenDeployment: tried });
        await shot(page, `${mode}-strategies-${width}`);
      }
      if (["/portfolio", "/markets", "/activity"].includes(path)) {
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
  await checkRedirects();
} else if (mode === "activity-recovery") {
  // DEFAULT-target server (chain 1952) built with PERIDOT_ACTIVITY_DIR pointing at a directory whose 1952.json is the
  // contracts team's SYNTHETIC pruned snapshot (evidence/session9-activity/pruned-shared.json; never a release
  // input). Its heights and hashes are simulated, so against the real chain its checkpoint either conflicts or cannot
  // be read. Either way (MILESTONE_LOG M10-activity-recovery): the recorded events stay listed with their original
  // hashes, the two segments are never shown as one range, each gap has its reason and range, the segment after the
  // history gap is labelled "known emitters only", and nothing of the snapshot is merged into the live list.
  const { readFileSync } = await import("node:fs");
  const file = JSON.parse(readFileSync(new URL("../../../evidence/session9-activity/pruned-shared.json", import.meta.url), "utf8"));
  const { context, page, wallet, errors } = await open("/activity", { walletChainId: "0x7a0", watch: "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67" });
  const card = page.locator('[data-testid="activity-snapshot"]');
  await page.waitForFunction(() => !["checking", null].includes(document.querySelector('[data-testid="activity-snapshot"]')?.getAttribute("data-state") ?? null), null, { timeout: 90_000 }).catch(() => {});
  await page.locator("[data-snapshot]").first().waitFor({ timeout: 120_000 }).catch(() => {});
  await page.evaluate(() => document.querySelectorAll("details").forEach((node) => (node.open = true)));
  const shown = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="activity-snapshot"]');
    const list = (selector, read) => [...card.querySelectorAll(selector)].map(read);
    const merged = document.querySelector("[data-snapshot]");
    return {
      state: card.getAttribute("data-state"),
      text: card.innerText.replace(/\s+/g, " "),
      conflictNotice: card.querySelectorAll('[data-testid="snapshot-conflict"]').length,
      uncheckedNotice: card.querySelectorAll('[data-testid="snapshot-unchecked"]').length,
      segments: list('[data-testid="snapshot-segments"] li', (node) => `${node.dataset.segment}:${node.dataset.sourceCoverage}`),
      segmentText: list('[data-testid="snapshot-segments"] li', (node) => node.innerText.replace(/\s+/g, " ")),
      gaps: list('[data-testid="snapshot-gaps"] li', (node) => `${node.dataset.statedGap}:${node.dataset.reason}`),
      gapText: list('[data-testid="snapshot-gaps"] li', (node) => node.innerText.replace(/\s+/g, " ")),
      recorded: list('[data-testid="snapshot-all-events"] li', (node) => node.dataset.hash),
      liveList: merged ? { snapshot: merged.getAttribute("data-snapshot"), added: merged.getAttribute("data-snapshot-added"), text: merged.innerText.replace(/\s+/g, " ") } : null,
      rowsFromSnapshot: [...document.querySelectorAll("main li")].filter((row) => /From the indexed snapshot|also in the snapshot/.test(row.innerText)).length,
    };
  });
  notes.push({ activityRecovery: { ...shown, text: undefined, liveList: shown.liveList ? { ...shown.liveList, text: shown.liveList.text.slice(0, 400) } : null } });
  expect(["not-canonical", "unchecked"].includes(shown.state) && (shown.state === "not-canonical" ? shown.conflictNotice === 1 && /Checkpoint conflict/.test(shown.text) : shown.uncheckedNotice === 1), `the synthetic snapshot's checkpoint is shown as ${shown.state} without its notice`);
  expect(JSON.stringify(shown.recorded) === JSON.stringify(file.events.map((event) => event.transactionHash)) && /previously verified evidence/.test(shown.text), `the recorded events are not all listed with their original hashes: ${JSON.stringify(shown.recorded)}`);
  expect(JSON.stringify(shown.segments) === JSON.stringify(["100-101:configured", "120-120:known-emitters"]) && /Indexed events in 2 checked segments/.test(shown.text) && /not one continuous range/.test(shown.text) && !/every block/i.test(shown.text) && !/blocks 100 to 120/i.test(shown.text), `the two segments are not shown apart, or the envelope is shown as one range: ${JSON.stringify(shown.segments)} | ${shown.text.slice(0, 300)}`);
  expect(/known emitters only/.test(shown.segmentText[1] ?? "") && /may be missing/.test(shown.segmentText[1] ?? "") && !/known emitters/.test(shown.segmentText[0] ?? ""), `the segment after the gap is not labelled as known emitters only: ${JSON.stringify(shown.segmentText)}`);
  expect(JSON.stringify(shown.gaps) === JSON.stringify(["102-119:history-unavailable", "121-132:other"]) && /Blocks 102 to 119 \(18 blocks\): history unavailable/.test(shown.gapText[0] ?? "") && /permanently missing/.test(shown.gapText[0] ?? "") && /confirmation depth/.test(shown.gapText[1] ?? ""), `the gaps are not shown with their reason and range: ${JSON.stringify(shown.gapText)}`);
  expect(shown.liveList !== null && ["not-canonical", "unverified"].includes(shown.liveList.snapshot) && shown.liveList.added === "0" && shown.rowsFromSnapshot === 0 && /is not merged into this list/.test(shown.liveList.text), `the live list merged the snapshot although its checkpoint does not match: ${JSON.stringify(shown.liveList)} (${shown.rowsFromSnapshot} rows)`);
  expect(wallet.sent.length === 0, "a transaction was requested");
  expect(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  await shot(page, "activity-recovery-synthetic-pruned-snapshot");
  await context.close();
} else if (mode === "rejected-manifest") {
  const expectReason = new RegExp(process.env.EXPECT_REASON ?? "rejected for live use");
  for (const path of ["/portfolio", "/markets", "/markets/example-0", "/activity", "/strategies", "/discover"]) {
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
  // EXPANSION_DIR: the directory the server under test was BUILT from (PERIDOT_EXPANSION_DIR), when it is a copy with a
  // switch turned on. The checks then expect what that copy says. An evidence run of the real build never sets it.
  const expansionDir = process.env.EXPANSION_DIR ? resolve(process.env.EXPANSION_DIR) : new URL("../../../packages/chain-config/expansion/deployments/", import.meta.url).pathname;
  const v2Manifest = JSON.parse(readFileSync(`${expansionDir}/1952.json`, "utf8"));
  const vaultManifest = JSON.parse(readFileSync(`${expansionDir}/vault-1952.json`, "utf8"));
  const toolsV1 = JSON.parse(readFileSync(new URL("../../../services/mcp/tools.json", import.meta.url), "utf8"));
  const toolsV2 = JSON.parse(readFileSync(new URL("../../../services/mcp-v2/tools.json", import.meta.url), "utf8"));
  const judge = JSON.parse(readFileSync(new URL("../../../deployments/session7/1952/judge-01/manifest.json", import.meta.url), "utf8"));
  const judgeActivity = JSON.parse(readFileSync(new URL("../../../deployments/session7/1952/judge-01/activity.json", import.meta.url), "utf8"));
  const judgeGuide = readFileSync(new URL("../../../docs/JUDGE_DEMO.md", import.meta.url), "utf8");
  const v2Demo = JSON.parse(readFileSync(new URL("../../../evidence/session6-v2/1952.json", import.meta.url), "utf8"));
  const rejectionsFile = JSON.parse(readFileSync(new URL("../../../evidence/session6-rejections/public-1952.json", import.meta.url), "utf8"));
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
      for (const path of ["/", "/markets", "/markets?view=borrow", `/markets/${market}`, "/portfolio", `/sentinel/policy?market=${market}`, `/strategies?market=${market}`, "/activity", "/discover", "/connect", "/trade", "/studio", "/studio/create", "/circuits"]) {
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
        // D24: the benefit-led copy keeps every disclosure, in one line that is visible without opening anything.
        if (hasDisclosures(path)) expect((await disclosureProblems(page)).length === 0, `${tag}: disclosures: ${(await disclosureProblems(page)).join("; ")}`);
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
          const landing = await page.evaluate(() => {
            const text = (id) => (document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "").replace(/\s+/g, " ").trim();
            const href = (id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("href") ?? null;
            return { title: document.title, brand: text("brand"), tagline: text("tagline"), positioning: text("positioning"), headline: (document.querySelector('[data-testid="headline"]')?.innerText ?? "").replace(/\s+/g, " ").trim(), supporting: text("supporting"), availability: text("hero-availability"), create: { text: text("cta-create"), href: href("cta-create") }, explore: { text: text("cta-explore"), href: href("cta-explore") }, pillars: [...document.querySelectorAll('[data-testid="pillars"] h3')].map((node) => node.textContent.trim()), templates: [...document.querySelectorAll('[data-testid="landing-templates"] > li')].length, body: document.body.innerText };
          });
          notes.push({ width, landing: { ...landing, body: undefined } });
          expect(/Peridot Sentinel/.test(landing.title) && landing.brand.includes("sentinel.") && landing.brand.includes("By Peridot"), `${tag}: wordmark or title is not Peridot Sentinel (${landing.title} / ${landing.brand})`);
          // D23: the headline, the positioning line, the unchanged tagline, the two calls to action and the three pillars.
          expect(landing.headline === D23.headline, `${tag}: the headline is "${landing.headline}", D23 says "${D23.headline}"`);
          expect(D23.tagline.test(landing.tagline) && landing.positioning.includes(D23.positioning), `${tag}: tagline or positioning line missing ("${landing.tagline}" / "${landing.positioning}")`);
          expect(landing.create.text === D23.ctaCreate && landing.create.href === "/strategies#create" && landing.explore.text === D23.ctaExplore && landing.explore.href === "/discover", `${tag}: the calls to action are ${JSON.stringify([landing.create, landing.explore])}`);
          expect(D23.pillars.every((pillar) => landing.pillars.some((shown) => shown.startsWith(pillar))) && landing.pillars.length === 3, `${tag}: the pillars are ${JSON.stringify(landing.pillars)}, D23 says ${D23.pillars.join(" / ")}`);
          expect(!/Financial Operating System for the Agent Economy/.test(landing.body), `${tag}: the pre-D23 positioning line is still shown`);
          expect(/testnet/i.test(landing.availability) && /test tokens/i.test(landing.availability), `${tag}: the hero does not say testnet and test tokens ("${landing.availability}")`);
          // No invented numbers anywhere on the landing page: no yield, TVL, user or performance figure.
          expect(!/\bAPY\b/.test(landing.body) && !/\d[\d.,]*\s*%\s*(APY|APR|yield|return)/i.test(landing.body) && !/TVL\s*[:$]|\$\s?\d[\d,.]*\s*(M|B|K|million|billion)\b/i.test(landing.body) && !/\d[\d,]*\+?\s+(users|depositors|traders)\b/i.test(landing.body), `${tag}: the landing page shows a performance, TVL or user figure`);
          expect(landing.templates >= 2, `${tag}: the landing page lists ${landing.templates} strategy template(s)`);
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
        if (path === "/portfolio") {
          const accounts = await page.locator('[data-testid="sentinel-account"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.account));
          notes.push({ wallet: who.name, width, sentinelAccounts: accounts });
          if (who.name === "demo-owner-watch-only") expect(accounts.some((entry) => entry?.toLowerCase() === receipt.sentinelAccount.toLowerCase()), `${tag}: the demo Sentinel account ${receipt.sentinelAccount} is not shown for its owner (got ${JSON.stringify(accounts)})`);
          else expect(accounts.length === 0, `${tag}: accounts shown for a wallet that has none`);
          // Navigation: product areas per D11, and nothing planned is a link.
          const brand = (await page.locator('[data-testid="brand"]:visible').first().innerText()).replace(/\s+/g, " ");
          expect(brand.includes("sentinel."), `${tag}: wordmark is "${brand}"`);
          if (width === 1440) {
            const rail = await page.locator("aside [data-nav]").evaluateAll((nodes) => nodes.map((node) => ({ key: node.dataset.nav, group: node.closest("[data-nav-group]")?.dataset.navGroup ?? null, status: node.dataset.navStatus, link: node.tagName === "A", href: node.getAttribute("href"), current: node.getAttribute("aria-current"), text: node.innerText.replace(/\s+/g, " ").trim() })));
            notes.push({ wallet: who.name, rail });
            // D23: Personal (Portfolio, Strategies, Discover, Activity), Finance (Earn, Borrow, Trade), Builders (Studio, Circuits, Connect).
            expect(rail.map((item) => item.key).join(",") === [...D23.groups.personal, ...D23.groups.finance, ...D23.groups.builders, "about"].join(","), `${tag}: rail items are ${rail.map((item) => item.key).join(",")}`);
            for (const [group, keys] of Object.entries(D23.groups)) expect(rail.filter((item) => item.group === group).map((item) => item.key).join(",") === keys.join(","), `${tag}: nav group ${group} holds ${rail.filter((item) => item.group === group).map((item) => item.key).join(",")}`);
            const groupLabels = await page.locator("aside [data-nav-group] h2").evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
            expect(groupLabels.join(",") === "Personal,Finance,Builders", `${tag}: nav group headings are ${groupLabels.join(",")}`);
            // Portfolio is the primary dashboard: it is the current item here, and no old URL is linked from the rail.
            expect(rail.find((item) => item.key === "portfolio")?.current === "page" && rail.filter((item) => item.current === "page").length === 1, `${tag}: Portfolio is not the one active nav item`);
            expect(rail.every((item) => !/^\/(sentinel|automate|app)(\/|$|\?)/.test(item.href ?? "")), `${tag}: the rail links to an old URL: ${JSON.stringify(rail.map((item) => item.href))}`);
            const trade = rail.find((item) => item.key === "trade");
            // v2 is deployed on testnet (mock venue) and the page is read-only: a link that still says "In development".
            expect(trade && trade.link && trade.status === "development" && /In development/.test(trade.text), `${tag}: Trade must be a link marked "In development": ${JSON.stringify(trade)}`);
            // Connect was verified on public testnet (evidence/session5-mcp/flagship-1952.json): a real link, no "In development".
            const connectNav = rail.find((item) => item.key === "connect");
            expect(connectNav?.link === true && connectNav.status === "live" && !/In development|Planned/.test(connectNav.text), `${tag}: Connect must be a live link without a status chip: ${JSON.stringify(connectNav)}`);
          } else {
            const tabs = await page.locator('[data-testid="tab-bar"]:visible [data-nav]').evaluateAll((nodes) => nodes.map((node) => node.dataset.nav));
            expect(tabs.join(",") === [...D23.groups.personal, "more"].join(","), `${tag}: tab bar is ${tabs.join(",")}`);
            await page.locator('[data-nav="more"]:visible').click();
            const more = await page.locator('[data-testid="more-nav"] [data-nav]').evaluateAll((nodes) => nodes.map((node) => ({ key: node.dataset.nav, link: node.tagName === "A", text: node.innerText.replace(/\s+/g, " ").trim() })));
            expect(more.map((item) => item.key).join(",") === [...D23.groups.finance, ...D23.groups.builders, "about"].join(",") && more.find((item) => item.key === "trade")?.link === true && /In development/.test(more.find((item) => item.key === "trade")?.text ?? ""), `${tag}: "More" lists ${JSON.stringify(more)}`);
            await shot(page, `testnet-${who.name}-more-nav-${width}`);
            await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
          }
          const portfolio = await page.locator('[data-testid="portfolio"] tr[data-portfolio-row]').evaluateAll((nodes) => nodes.map((node) => ({ kind: node.dataset.portfolioRow, text: node.innerText.replace(/\s+/g, " ").trim() })));
          notes.push({ wallet: who.name, width, portfolio });
          expect(/Position types shown: Peridot lending/.test(await page.locator('[data-testid="portfolio-scope"]').innerText()) && /Sentinel v2 account/.test(await page.locator('[data-testid="portfolio-scope"]').innerText()), `${tag}: the portfolio does not say which position types it covers`);
          // v2 positions: the demo owner owns the public v2 demo account; a wallet without one sees "no v2 account".
          const v2 = page.locator('[data-testid="portfolio-v2"]');
          await page.waitForFunction(() => !["loading", null].includes(document.querySelector('[data-testid="portfolio-v2"]')?.getAttribute("data-state") ?? null), null, { timeout: 60_000 }).catch(() => {});
          const v2State = { state: await v2.getAttribute("data-state"), account: await v2.getAttribute("data-account"), rows: await v2.locator("[data-portfolio-row]").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.portfolioRow}: ${node.innerText.replace(/\s+/g, " ")}`)) };
          notes.push({ wallet: who.name, width, portfolioV2: v2State });
          if (who.name === "demo-owner-watch-only") expect(v2State.state === "account" && v2State.account?.toLowerCase() === v2Manifest.contracts.account.toLowerCase() && v2State.rows.some((row) => /^v2-idle: .*mWOKB.*mUSDC/.test(row)), `${tag}: the demo owner's v2 account is not in the portfolio: ${JSON.stringify(v2State)}`);
          else expect(v2State.state === "none" && v2State.rows.length === 0, `${tag}: a v2 account is shown for a wallet that has none: ${JSON.stringify(v2State)}`);
          if (who.name === "demo-owner-watch-only") expect(portfolio.some((row) => row.kind === "sentinel" && /100 mCOL/.test(row.text) && /mUSD/.test(row.text)), `${tag}: the demo account's lending position is not in the portfolio: ${JSON.stringify(portfolio)}`);
          // One "no position" row per market. The public testnet has more than one market since the mined-rejection run.
          else expect(portfolio.length >= 1 && portfolio.every((row) => row.kind === "none"), `${tag}: positions shown for a wallet that has none: ${JSON.stringify(portfolio)}`);
          // The primary dashboard: summary, budgets and the stop section exist for the owner; a wallet with nothing gets
          // the onboarding steps and no stop control.
          const home = { summary: await page.locator('[data-testid="portfolio-summary"]').count(), onboarding: await page.locator('[data-testid="portfolio-onboarding"]').getAttribute("data-next").catch(() => null), strategies: await page.locator('[data-testid="portfolio-summary"]').getAttribute("data-strategies").catch(() => null), stop: await page.locator('[data-testid="portfolio-stop"]').count(), stopButtons: await page.locator('[data-testid="portfolio-stop"] button:not([disabled])').count() };
          notes.push({ wallet: who.name, width, portfolioHome: home });
          expect((await page.locator("h1").first().innerText()) === "Portfolio", `${tag}: the page is not titled Portfolio`);
          // The stop control belongs to an account's owner. It must never be enabled for a wallet with no account.
          if (who.name === "empty-wallet") expect(home.stopButtons === 0 && /no Sentinel account/i.test(main), `${tag}: a stop control is offered to a wallet without an account: ${JSON.stringify(home)}`);
          await shot(page, `testnet-${who.name}-portfolio-${width}`);
        }
        if (path.startsWith("/sentinel/policy") && who.name === "demo-owner-watch-only") {
          expect((await page.locator('[data-testid="open-automate"]').getAttribute("href")) === `/strategies?market=${market}`, `${tag}: the policy page does not point at Strategies`);
          await shot(page, `testnet-${who.name}-policy-${width}`);
        }
        if (path.startsWith("/strategies")) {
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
          expect((await page.locator("#connect button, #connect input, #hosted button, #hosted input").count()) === 0, `${tag}: Connect or hosted AI offers a control on Strategies`);
          expect(!/autonomous|monitors? your|continuous(ly)? monitor/i.test(main), `${tag}: Strategies claims autonomous or continuous monitoring`);
          // D23: Strategies is the page that absorbed Automate, with the builder, the active list and import/export.
          expect((await page.locator("h1").first().innerText()) === "Strategies" && (await page.locator('[data-testid="create-strategy"]').getAttribute("href")) === "#create", `${tag}: the Strategies page has no "Create a strategy" action`);
          const builder = { options: await page.locator('[data-testid^="template-option-"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.testid.replace("template-option-", ""))), active: await page.locator('[data-testid="active-strategies"]').count(), importCard: await page.locator('[data-testid="strategy-import"]').count(), exportCard: await page.locator('[data-testid="strategy-export"]').count() };
          notes.push({ wallet: who.name, width, builder });
          // D23: start with debt protection and restricted external-agent templates. Those two, and nothing else.
          expect(builder.options.join(",") === "debt-protection-v1,restricted-swap-v2" && builder.active === 1 && builder.importCard === 1, `${tag}: the strategy builder shows ${JSON.stringify(builder)}`);
          expect((await page.locator('[data-testid="strategy-sign"]').count()) === 0, `${tag}: a sign button is shown before any review was asked for`);
          if (who.name === "demo-owner-watch-only" && width === 1440) {
            // The v2 template while the v2 deployment's switch for this app is off: the exact transaction can be
            // reviewed (a read at one block as the owner's public address), and signing it is not offered.
            const sentBefore = wallet.sent.length + wallet.refused.length;
            await page.locator('[data-testid="template-option-restricted-swap-v2"]').click();
            await page.locator('[data-testid="strategy-operator"]').fill("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
            await page.locator('[data-testid="strategy-review-submit"]').click();
            await page.locator('[data-testid="strategy-plan"], [data-testid="strategy-plan-error"]').first().waitFor({ timeout: 60_000 }).catch(() => {});
            const review = { plan: await page.locator('[data-testid="strategy-plan"]').count(), error: (await page.locator('[data-testid="strategy-plan-error"]').innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200), account: await page.locator('[data-testid="strategy-plan"]').getAttribute("data-account").catch(() => null), transactions: await page.locator('[data-testid="strategy-tx"]').evaluateAll((nodes) => nodes.map((node) => ({ method: node.dataset.method, to: node.dataset.to, from: node.dataset.from }))), signEnabled: await page.locator('[data-testid="strategy-sign"]').isEnabled().catch(() => null), locked: (await page.locator('[data-testid="strategy-sign-locked"]').innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200) };
            notes.push({ wallet: who.name, width, v2TemplateReview: review });
            expect(review.plan === 1 && review.account?.toLowerCase() === v2Manifest.contracts.account.toLowerCase() && review.transactions.length >= 1 && review.transactions.every((entry) => entry.to?.toLowerCase() === v2Manifest.contracts.account.toLowerCase() && entry.from?.toLowerCase() === who.address.toLowerCase()), `${tag}: the v2 template's review is ${JSON.stringify(review)}`);
            if (v2Manifest.uiEnabled !== true) expect(review.signEnabled === false && /switched off/.test(review.locked), `${tag}: signing the v2 template is offered although the deployment's switch is off: ${JSON.stringify(review)}`);
            expect(wallet.sent.length + wallet.refused.length === sentBefore, `${tag}: building a review asked the wallet for something`);
            await shot(page, "testnet-v2-template-review-locked-1440");
          }
          // A template never carries a key, and importing grants nothing: the page says so where the import happens.
          expect(/untrusted text/.test((await page.locator('[data-testid="strategy-import"]').innerText()).replace(/\s+/g, " ")) && /cannot grant anything/.test((await page.locator('[data-testid="strategy-import"]').innerText()).replace(/\s+/g, " ")), `${tag}: the import card does not say that an imported template is untrusted and grants nothing`);
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
          await shot(page, `testnet-${who.name}-strategies-${width}`);
        }
        if (path === "/trade") {
          const { erc20Abi, createPublicClient, http } = await import("viem");
          const { xLayerTestnet } = await import("../src/lib/chains.ts");
          await page.waitForFunction(() => ["ok", "error"].includes(document.querySelector('[data-testid="v2-account"]')?.getAttribute("data-state") ?? "") && ["ok", "error"].includes(document.querySelector('[data-testid="v2-quote"]')?.getAttribute("data-state") ?? ""), null, { timeout: 90_000 }).catch(() => {});
          expect(/Mock swap on testnet; real Uniswap v3 verified on mainnet fork/.test(main) && /inventory-backed mock swap venue/.test(main) && /not an OKX quote/.test(main), `${tag}: the Trade page does not carry the mock-venue labels`);
          expect((await page.locator('[data-testid="v2-deployment"]').getAttribute("data-state")) === "ok", `${tag}: the v2 deployment check is "${await page.locator('[data-testid="v2-deployment"]').getAttribute("data-state")}"`);
          // What the page may offer follows the two switches the contracts team sets in the manifests, and nothing else.
          const switches = { base: v2Manifest.uiEnabled === true, vault: vaultManifest.uiEnabled === true };
          const ownerRoot = page.locator('[data-testid="v2-owner"]');
          if (!switches.base && !switches.vault) {
            // Both off: no v2 transaction is offered. One input (the quote amount), and no button at all.
            expect((await page.locator('[data-testid="trade"] input').count()) === 1 && (await page.locator('[data-testid="trade"] button').count()) === 0 && (await ownerRoot.count()) === 0, `${tag}: the Trade page offers a control beyond the read-only quote amount`);
          } else {
            await page.locator('[data-testid="v2-verify"]:not([data-state="loading"])').waitFor({ timeout: 90_000 }).catch(() => {});
            await page.waitForFunction(() => !document.querySelector('[data-testid="v2-owner"] [data-loading]'), null, { timeout: 60_000 }).catch(() => {});
            const owner = { verify: await page.locator('[data-testid="v2-verify"]').getAttribute("data-state"), baseCard: await page.locator('[data-testid="v2-base"]').count(), vaultCard: await page.locator('[data-testid="vault-card"]').count(), vaultAccount: await page.locator('[data-testid="vault-card"]').getAttribute("data-account").catch(() => null), vaultCreate: await page.locator('[data-testid="vault-create"]').count(), stop: await page.locator('[data-testid="v2-emergency-stop"]').count() };
            notes.push({ wallet: who.name, width, switches, ownerFlows: owner });
            // The browser matched the PUBLIC chain against the manifest (code hashes, factory bindings) before offering anything.
            expect(owner.verify === "ok", `${tag}: the v2 owner target did not verify against the public chain: ${JSON.stringify(owner)}`);
            expect(owner.baseCard === (switches.base ? 1 : 0), `${tag}: the base v2 owner card does not follow the base switch (${JSON.stringify(switches)}): ${JSON.stringify(owner)}`);
            expect(owner.vaultCard === (switches.vault ? 1 : 0), `${tag}: the vault card does not follow the vault switch (${JSON.stringify(switches)}): ${JSON.stringify(owner)}`);
            if (switches.vault) {
              // Accounts come from the factory for the connected wallet: the demo owner's is the public vault account,
              // a wallet without one is offered creation and no vault action.
              if (who.name === "demo-owner-watch-only") expect(owner.vaultAccount?.toLowerCase() === vaultManifest.contracts.vaultAccount.toLowerCase() && (await page.locator('[data-testid="vault-action"]').count()) === 1, `${tag}: the demo owner's public vault account is not shown: ${JSON.stringify(owner)}`);
              else expect(owner.vaultAccount === "" && owner.vaultCreate === 1 && (await page.locator('[data-testid="vault-submit"]').count()) === 0, `${tag}: a vault action is offered to a wallet without a vault account: ${JSON.stringify(owner)}`);
              expect(/Mock vault · no yield/.test(await page.locator('[data-testid="vault-card"]').innerText()), `${tag}: the vault is not labelled as a mock without yield`);
            }
            if (!switches.base) expect((await page.locator('[data-testid="v2-grant-submit"], [data-testid="v2-create-base"], [data-testid="v2-mint-wokb"]').count()) === 0, `${tag}: a base v2 write is offered although the base switch is off`);
            expect((await page.locator('[data-testid="trade-not-yet"]').getAttribute("data-vault")) === String(switches.vault) && (await page.locator('[data-testid="trade-not-yet"]').getAttribute("data-owner-writes")) === String(switches.base), `${tag}: the "not in this app yet" list does not follow the switches`);
          }
          const accountCard = page.locator('[data-testid="v2-account"]');
          const shown = { state: await accountCard.getAttribute("data-state"), block: await accountCard.getAttribute("data-block"), usdc: await accountCard.getAttribute("data-usdc"), wokb: await accountCard.getAttribute("data-wokb"), operators: await accountCard.getAttribute("data-operators"), grants: await accountCard.locator("[data-v2-grant]").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.v2Grant}:${node.dataset.remaining}`)) };
          expect(shown.state === "ok", `${tag}: the v2 account read is "${shown.state}"`);
          if (shown.state === "ok") {
            // Direct RPC reads at the block the page names must give the same balances.
            const rpc = createPublicClient({ transport: http(xLayerTestnet.rpcUrls.default.http[0], { retryCount: 5, retryDelay: 400 }) });
            const at = { blockNumber: BigInt(shown.block) };
            const [usdc, wokb] = await Promise.all([rpc.readContract({ address: v2Manifest.contracts.mockUsdc, abi: erc20Abi, functionName: "balanceOf", args: [v2Manifest.contracts.account], ...at }), rpc.readContract({ address: v2Manifest.contracts.mockWokb, abi: erc20Abi, functionName: "balanceOf", args: [v2Manifest.contracts.account], ...at })]);
            expect(usdc.toString() === shown.usdc && wokb.toString() === shown.wokb, `${tag}: the page shows ${shown.wokb} / ${shown.usdc} but the RPC says ${wokb} / ${usdc} at block ${shown.block}`);
            // Operators are enumerated by the account. The count must equal operatorCount() at that block, whatever it is
            // today (the owner's public emergency stop empties the list).
            const { parseAbi } = await import("viem");
            const count = await rpc.readContract({ address: v2Manifest.contracts.account, abi: parseAbi(["function operatorCount() view returns (uint256)"]), functionName: "operatorCount", ...at });
            expect(String(count) === shown.operators && (await accountCard.locator("[data-v2-operator]").count()) === Number(count), `${tag}: the page lists ${shown.operators} operator(s) but operatorCount() is ${count} at block ${shown.block}`);
          }
          const quote = page.locator('[data-testid="v2-quote"]');
          expect((await quote.getAttribute("data-state")) === "ok" && BigInt((await quote.getAttribute("data-expected")) || "0") > 0n, `${tag}: the venue quote is "${await quote.getAttribute("data-state")}"`);
          // Receipts by kind: operator execution, mined revert, simulation without a link, owner actions.
          const receipts = await page.locator('[data-testid="v2-receipts"] [data-receipt]').evaluateAll((nodes) => nodes.map((node) => ({ kind: node.dataset.receipt, hash: node.dataset.hash, href: node.querySelector("a")?.getAttribute("href") ?? null, text: node.innerText.replace(/\s+/g, " ") })));
          const byKind = Object.fromEntries(receipts.map((row) => [row.kind, row]));
          expect(byKind["operator-swap"]?.hash === v2Demo.operatorSwap.hash && byKind["operator-swap"].href === explorerTxUrl(1952, v2Demo.operatorSwap.hash) && /Operator execution · mock venue/.test(byKind["operator-swap"].text), `${tag}: operator swap row is ${JSON.stringify(byKind["operator-swap"])}`);
          expect(byKind["mined-denial"]?.hash === v2Demo.denial.hash && byKind["mined-denial"].href === explorerTxUrl(1952, v2Demo.denial.hash) && /Mined revert/.test(byKind["mined-denial"].text) && /ExecutionPolicyDenied/.test(byKind["mined-denial"].text), `${tag}: mined denial row is ${JSON.stringify(byKind["mined-denial"])}`);
          expect(byKind["simulated-denial"] && byKind["simulated-denial"].href === null && /Simulated rejection · nothing sent/.test(byKind["simulated-denial"].text), `${tag}: the simulated denial must have no link: ${JSON.stringify(byKind["simulated-denial"])}`);
          expect(byKind["emergency-revoke"]?.hash === v2Demo.emergencyRevoke.hash && byKind["emergency-revoke"].href === explorerTxUrl(1952, v2Demo.emergencyRevoke.hash) && /Owner action · emergency stop/.test(byKind["emergency-revoke"].text), `${tag}: the v2 emergency revocation receipt is ${JSON.stringify(byKind["emergency-revoke"])}`);
          expect(byKind["owner-setup-swap"]?.hash === v2Manifest.swap.receipt && /Owner action · not operator execution/.test(byKind["owner-setup-swap"].text), `${tag}: the owner setup swap is not labelled as an owner action`);
          notes.push({ wallet: who.name, width, v2: { ...shown, quoteExpected: await quote.getAttribute("data-expected"), receipts: receipts.map((row) => `${row.kind}:${row.hash}`) } });
          await shot(page, `testnet-${who.name}-trade-${width}`);
        }
        if (path === "/connect") {
          const flagship = JSON.parse(readFileSync(new URL("../../../evidence/session5-mcp/flagship-1952.json", import.meta.url), "utf8"));
          const runHash = flagship.steps["5"].receipt.hash;
          const root = page.locator('[data-testid="connect"]');
          expect((await root.getAttribute("data-connect")) === "available" && /Available on testnet \(agent-directed\)/.test(main), `${tag}: Connect is not shown as available on testnet (agent-directed)`);
          // "autonomous" may appear only in a negation ("not continuous autonomous monitoring", "nothing monitors").
          const claims = main.replace(/not continuous autonomous monitoring/gi, "").replace(/nothing monitors/gi, "");
          expect(/agent-directed execution/.test(main) && !/autonomous|continuous(ly)? monitor/i.test(claims), `${tag}: Connect must be called agent-directed execution and never autonomous monitoring`);
          expect(/mock tokens/i.test(main) && /development reference processor \(not TapeOut\)/.test(main), `${tag}: the Connect page does not carry the testnet scope label`);
          // Tools: the recorded catalogue, exactly one of which can send.
          const tools = await page.locator('[data-testid="connect-tools"] [data-tool]').evaluateAll((nodes) => nodes.map((node) => ({ name: node.dataset.tool, kind: node.dataset.kind })));
          // The list is the server's checked-in catalogue: same names in the same order, and "can send" follows `writes`.
          expect(tools.map((tool) => tool.name).join() === toolsV1.tools.map((tool) => tool.name).join() && tools.filter((tool) => tool.kind === "execute").map((tool) => tool.name).join() === toolsV1.tools.filter((tool) => tool.writes).map((tool) => tool.name).join() && tools.filter((tool) => tool.kind === "execute").length === 1, `${tag}: tool list is ${JSON.stringify(tools)}`);
          expect(/services\/mcp\/tools\.json/.test(await page.locator('[data-testid="connect-tools"]').innerText()) && (await page.locator('[data-testid="connect-tools"] [data-tool-guarantees]').count()) === toolsV1.tools.length, `${tag}: the tool card does not name its source file or lacks the catalogue's guarantees`);
          // Limits and setup: no owner key, no withdraw, no permission changes, no arbitrary calldata; a keyless stdio command.
          const cannot = (await page.locator('[data-testid="connect-cannot"]').innerText()).replace(/\s+/g, " ");
          expect(/owner's key/.test(cannot) && /Withdraw/.test(cannot) && /Change permissions/.test(cannot) && /arbitrary calldata/.test(cannot), `${tag}: the "cannot" list is incomplete: ${cannot.slice(0, 200)}`);
          expect(/^node \S+services\/mcp\/server\.mjs$/.test((await page.locator('[data-testid="connect-command"]').innerText()).trim()), `${tag}: the stdio command is not shown`);
          expect(/never entered on this page/.test(await page.locator('[data-testid="connect-key-note"]').innerText()), `${tag}: the page does not say the operator key is never entered here`);
          expect((await root.locator("input, textarea, select").count()) === 0, `${tag}: the Connect page has an input (it must never take a key)`);
          // The recorded run: one explorer link, to the public execute transaction. A simulation never gets one.
          const txLinks = await root.locator('a[href*="/tx/"]').evaluateAll((nodes) => nodes.filter((node) => !node.closest('[data-testid="connect-judge"]')).map((node) => node.getAttribute("href")));
          // Inside the judge card: only the two grant receipts and the transactions of its own activity snapshot.
          const judgeLinks = await root.locator('[data-testid="connect-judge"] a[href*="/tx/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
          const judgeAllowed = new Set([judge.setupReceipts["repay-only"], judge.setupReceipts["swap-only"], ...judgeActivity.events.map((event) => event.transactionHash)].map((hash) => explorerTxUrl(1952, hash)));
          expect(judgeLinks.length >= 2 && judgeLinks.every((href) => judgeAllowed.has(href)), `${tag}: the judge card links to a transaction that is neither a grant receipt nor in its snapshot`);
          // Linked transactions: the scripted run's execute, and the LLM session's swap and mined revert. Nothing else.
          const llmFile = JSON.parse(readFileSync(new URL("../../../evidence/session6-mcp-v2/verified.json", import.meta.url), "utf8"));
          const allowedTx = new Set([runHash, llmFile.swap.canonical.receipt.hash, llmFile.rejection.canonical.receipt.hash, v2Demo.emergencyRevoke.hash].map((hash) => explorerTxUrl(1952, hash)));
          expect(txLinks.length >= 4 && txLinks.every((href) => allowedTx.has(href)) && [...allowedTx].every((href) => txLinks.includes(href)), `${tag}: explorer transaction links on Connect are ${JSON.stringify(txLinks)}`);
          const llmCard = page.locator('[data-testid="connect-llm"]');
          const llmText = (await llmCard.innerText()).replace(/\s+/g, " ");
          expect((await llmCard.getAttribute("data-swap")) === llmFile.swap.canonical.receipt.hash && (await llmCard.getAttribute("data-revert")) === llmFile.rejection.canonical.receipt.hash && (await llmCard.getAttribute("data-deltas")) === "true", `${tag}: the LLM session card does not show the verified receipts`);
          expect(/LLM-directed single session \(Claude via MCP\), not continuous autonomous monitoring/.test(llmText) && /mock venue \/ mock tokens \/ mock feed \/ development reference processor/.test(llmText) && /simulated denial/i.test(llmText) && /mined revert/i.test(llmText), `${tag}: the LLM session is not labelled as required`);
          expect((await llmCard.locator('[data-testid="llm-simulated"] a').count()) === 0 && (await llmCard.locator('[data-testid="llm-mined"] a').getAttribute("href")) === explorerTxUrl(1952, llmFile.rejection.canonical.receipt.hash), `${tag}: simulated denial and mined revert are not kept apart`);
          expect((await llmCard.locator('[data-testid="llm-quote"]').getAttribute("data-available")) === String(llmFile.market.onchainOS.quote !== null) && (llmFile.market.onchainOS.quote !== null || /Quote unavailable/.test(await llmCard.locator('[data-testid="llm-quote"]').innerText())), `${tag}: the session's OKX quote state is misreported`);
          // The model's own final message sits in a closed disclosure: open it, then compare with the transcript's result.
          await llmCard.locator('[data-testid="llm-reasoning"] summary').click();
          const quoted = await llmCard.locator('[data-testid="llm-reasoning"] blockquote').innerText();
          const transcriptName = readdirSync(new URL("../../../evidence/session6-mcp-v2/", import.meta.url)).filter((file) => /^claude-transcript-[0-9a-f]+\.ndjson$/.test(file)).sort().at(-1);
          const finalResult = readFileSync(new URL(`../../../evidence/session6-mcp-v2/${transcriptName}`, import.meta.url), "utf8").split("\n").flatMap((line) => { try { const record = JSON.parse(line); return record.type === "result" ? [record.result] : []; } catch { return []; } }).at(-1) ?? "";
          const squash = (value) => value.replace(/\s+/g, " ").trim();
          expect(finalResult.length > 200 && squash(quoted) === squash(finalResult), `${tag}: the model's final message is not quoted verbatim (${quoted.length} characters shown, ${finalResult.length} in the transcript)`);
          // Onboarding: what a reader copies is what is in the repository, and nothing asks for a key.
          const repoText = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").trim();
          const v1Config = JSON.parse(await page.locator('[data-testid="connect-config"]').innerText());
          expect(v1Config.mcpServers["sentinel-connect"].command === "node" && /services\/mcp\/server\.mjs$/.test(v1Config.mcpServers["sentinel-connect"].args[0]) && !("env" in v1Config.mcpServers["sentinel-connect"]), `${tag}: the keyless MCP configuration is ${JSON.stringify(v1Config)}`);
          expect((await page.locator('[data-testid="connect-config-v2"]').innerText()).trim() === repoText("services/mcp-v2/claude.mcp.json") && (await page.locator('[data-testid="connect-objective"]').innerText()).trim() === repoText("services/mcp-v2/objective.txt"), `${tag}: the v2 configuration or the objective differs from the repository files`);
          const v2Shown = await page.locator('[data-testid="connect-tools-v2"] [data-tool-v2]').evaluateAll((nodes) => nodes.map((node) => ({ name: node.dataset.toolV2, kind: node.dataset.kind })));
          // The v2 catalogue has TWO tools that can send (the swap and the one-off mined rejection); the page must say so.
          expect(v2Shown.map((tool) => tool.name).join() === toolsV2.tools.map((tool) => tool.name).join() && v2Shown.filter((tool) => tool.kind === "execute").map((tool) => tool.name).join() === toolsV2.tools.filter((tool) => tool.writes).map((tool) => tool.name).join() && (await page.locator("[data-onboard-step]").count()) === 7, `${tag}: the onboarding does not list seven steps and the v2 catalogue: ${JSON.stringify(v2Shown)}`);
          const v2Sending = toolsV2.tools.filter((tool) => tool.writes).length;
          expect(new RegExp(`${toolsV2.tools.length} tools, ${v2Sending} of which can send`).test(await page.locator('[data-onboard-step="5"]').innerText()) && /services\/mcp-v2\/tools\.json/.test(await page.locator('[data-testid="connect-tools-v2-source"]').innerText()), `${tag}: step 5 does not state how many v2 tools can send, or its source`);
          // The reviewer walkthrough: the guide's numbered steps and every fenced command, verbatim and in order.
          const guideSteps = [...judgeGuide.matchAll(/^## (\d+)\. (.+)$/gm)].map((match) => ({ n: match[1], title: match[2].trim() }));
          const guideCommands = [...judgeGuide.slice(judgeGuide.indexOf("\n## 1. "), judgeGuide.indexOf("\n## Evidence and rehearsal")).matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]);
          const shownSteps = await page.locator('[data-testid="connect-judge-steps"] [data-judge-step]').evaluateAll((nodes) => nodes.map((node) => ({ n: node.dataset.judgeStep, title: node.querySelector("h3")?.textContent.trim() ?? "" })));
          const shownCommands = await page.locator('[data-testid="connect-judge-steps"] [data-judge-command] pre').allInnerTexts();
          expect(guideSteps.length === 7 && JSON.stringify(shownSteps) === JSON.stringify(guideSteps), `${tag}: the reviewer walkthrough's steps are ${JSON.stringify(shownSteps)}, the guide has ${JSON.stringify(guideSteps)}`);
          expect(guideCommands.length > 0 && JSON.stringify(shownCommands.map((text) => text.trim())) === JSON.stringify(guideCommands.map((text) => text.trim())), `${tag}: the walkthrough's commands differ from docs/JUDGE_DEMO.md (${shownCommands.length} shown, ${guideCommands.length} in the guide)`);
          expect(!/OWNER_KEY|OPERATOR_KEY=|PERIDOT_TESTNET_KEY|0x[0-9a-fA-F]{64}/.test(shownCommands.join("\n")), `${tag}: a key variable assignment or a 32-byte value appears in a walkthrough command`);
          // The prepared judge campaign, read-only: addresses and prepared grants from its manifest, grants re-read live.
          const judgeCard = page.locator('[data-testid="connect-judge"]');
          await page.waitForFunction(() => ["ok", "error"].includes(document.querySelector('[data-testid="connect-judge"]')?.getAttribute("data-state") ?? ""), null, { timeout: 60_000 }).catch(() => {});
          const judgeText = (await judgeCard.innerText()).replace(/\s+/g, " ");
          const judgeShown = { state: await judgeCard.getAttribute("data-state"), campaign: await judgeCard.getAttribute("data-campaign"), owner: await judgeCard.getAttribute("data-owner"), operator: await judgeCard.getAttribute("data-operator"), block: await judgeCard.getAttribute("data-block"), markets: await judgeCard.locator("[data-judge-market]").evaluateAll((nodes) => nodes.map((node) => ({ key: node.dataset.judgeMarket, controller: node.dataset.controller, account: node.dataset.account, href: node.querySelector("a")?.getAttribute("href") }))), grants: await judgeCard.locator("[data-judge-grant]").evaluateAll((nodes) => nodes.map((node) => ({ kind: node.dataset.judgeGrant, state: node.dataset.state, remaining: node.dataset.remaining, expiry: node.dataset.expiry, preparedExpiry: node.dataset.preparedExpiry, account: node.dataset.account, receipt: node.querySelector("[data-judge-tx]")?.dataset.judgeTx ?? null }))) };
          notes.push({ wallet: who.name, width, judge: judgeShown });
          expect(judgeShown.campaign === judge.campaign && judgeShown.owner === judge.owner && judgeShown.operator === judge.operator && judgeShown.markets.length === 2 && judgeShown.markets.every((market) => market.controller === judge.markets[market.key].controller && market.account === judge.markets[market.key].account && market.href === `/markets/${market.controller}`), `${tag}: the judge campaign card shows ${JSON.stringify(judgeShown)}`);
          expect(/Read-only/i.test(judgeText) && /valueless mock tokens/.test(judgeText) && /development reference processor/.test(judgeText) && judgeText.includes(judge.contracts.account), `${tag}: the judge campaign is not labelled read-only with its mock scope, or lacks the v2 account`);
          const judgeRepay = judgeShown.grants.find((grant) => grant.kind === "repay");
          const judgeSwap = judgeShown.grants.find((grant) => grant.kind === "swap");
          // Both prepared grants expire on 3 December 2026, 16:50 UTC (docs/JUDGE_DEMO.md), with their grant receipts.
          expect(judgeRepay?.preparedExpiry === judge.grants.repay.expiry && judgeSwap?.preparedExpiry === judge.grants.swap.expiry && judge.grants.repay.expiry === "1796316632" && (judgeText.match(/2026-12-03 16:50 UTC/g) ?? []).length >= 2 && judgeRepay?.receipt === judge.setupReceipts["repay-only"] && judgeSwap?.receipt === judge.setupReceipts["swap-only"], `${tag}: the prepared grants are shown as ${JSON.stringify([judgeRepay, judgeSwap])}`);
          expect(judgeShown.state === "ok", `${tag}: the judge campaign's live read is "${judgeShown.state}"`);
          if (judgeShown.state === "ok") {
            // The live grant values must equal direct RPC reads at the block the card names, and the state must follow them.
            const { SentinelAccountAbi } = await import("@peridot/chain-config");
            const { createPublicClient, http, parseAbi } = await import("viem");
            const { xLayerTestnet } = await import("../src/lib/chains.ts");
            const rpc = createPublicClient({ transport: http(xLayerTestnet.rpcUrls.default.http[0], { retryCount: 5, retryDelay: 400 }) });
            const at = { blockNumber: BigInt(judgeShown.block) };
            const [repayDirect, swapDirect, blockDirect] = await Promise.all([rpc.readContract({ address: judge.markets.A.account, abi: SentinelAccountAbi, functionName: "operators", args: [judge.operator], ...at }), rpc.readContract({ address: judge.contracts.account, abi: parseAbi(["function grants(address,address,uint8,address) view returns (uint256,uint256,uint64)"]), functionName: "grants", args: [judge.operator, judge.contracts.swap, 5, judge.contracts.mockWokb], ...at }), rpc.getBlock(at)]);
            const expectRepay = repayDirect[0] === 0 ? "revoked" : repayDirect[0] !== 8 ? "unexpected" : repayDirect[2] <= blockDirect.timestamp ? "expired" : repayDirect[1] === 0n ? "spent" : "ready";
            const expectSwap = swapDirect[0] === 0n && swapDirect[1] === 0n && BigInt(swapDirect[2]) === 0n ? "revoked" : BigInt(swapDirect[2]) <= blockDirect.timestamp ? "expired" : swapDirect[1] === 0n || swapDirect[0] === 0n ? "spent" : "ready";
            expect(judgeRepay?.remaining === repayDirect[1].toString() && judgeRepay.expiry === repayDirect[2].toString() && judgeRepay.state === expectRepay, `${tag}: the judge repay grant is shown as ${JSON.stringify(judgeRepay)}, the RPC says mask ${repayDirect[0]}, ${repayDirect[1]}, ${repayDirect[2]} (${expectRepay}) at block ${judgeShown.block}`);
            expect(judgeSwap?.remaining === swapDirect[1].toString() && judgeSwap.expiry === BigInt(swapDirect[2]).toString() && judgeSwap.state === expectSwap, `${tag}: the judge swap grant is shown as ${JSON.stringify(judgeSwap)}, the RPC says ${swapDirect.join(", ")} (${expectSwap}) at block ${judgeShown.block}`);
            notes.push({ wallet: who.name, width, judgeDirect: { block: judgeShown.block, repay: [repayDirect[0], repayDirect[1].toString(), repayDirect[2].toString(), expectRepay], swap: [swapDirect[0].toString(), swapDirect[1].toString(), BigInt(swapDirect[2]).toString(), expectSwap] } });
          }
          // Its scoped activity snapshot: the file's own range, terminal block and gap, every event, labelled as history.
          const judgeLog = judgeCard.locator('[data-testid="judge-activity"]');
          await judgeLog.locator("details").evaluate((node) => (node.open = true));
          const judgeEvents = await judgeLog.locator("[data-judge-event]").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.hash}:${node.dataset.judgeEvent}`));
          const judgeGaps = await judgeLog.locator("[data-judge-gap]").evaluateAll((nodes) => nodes.map((node) => node.dataset.judgeGap));
          expect((await judgeLog.getAttribute("data-from")) === judgeActivity.coverage.fromBlock && (await judgeLog.getAttribute("data-to")) === judgeActivity.coverage.toBlock && judgeEvents.length === judgeActivity.events.length && judgeActivity.events.every((event) => judgeEvents.includes(`${event.transactionHash}:${event.eventName}`)), `${tag}: the judge activity snapshot shows ${judgeEvents.length} events for blocks ${await judgeLog.getAttribute("data-from")} to ${await judgeLog.getAttribute("data-to")}`);
          expect(judgeGaps.join() === judgeActivity.coverage.gaps.map((gap) => `${gap.fromBlock}-${gap.toBlock}`).join() && /Historical snapshot · not a live feed/i.test(await judgeLog.innerText()) && /Nothing after block/.test(await judgeLog.innerText()) && (await judgeLog.innerText()).includes(judgeActivity.coverage.toBlockHash.slice(0, 8)), `${tag}: the judge activity snapshot does not disclose its gaps (${judgeGaps.join()}), its end or its terminal block`);
          expect((await overflow(page)) <= 0, `${tag}: overflow ${await overflow(page)}px with the judge events open`);
          expect((await page.locator('[data-testid="connect-stop-link"]').getAttribute("href")) === "/strategies" && (await page.locator('[data-testid="connect-session-link"]').getAttribute("href")) === "#llm-session" && /There is no hosted AI/.test(main), `${tag}: the onboarding lacks the revocation link, the session link or the no-hosted-AI statement`);
          expect(!/0x[0-9a-fA-F]{64}/.test(await page.locator('[data-testid="connect-how"] pre').allInnerTexts().then((texts) => texts.join(" "))), `${tag}: a 32-byte hex value appears in a copyable block`);
          expect((await page.locator('[data-testid="connect-run"] [data-step]').count()) === 7, `${tag}: the recorded run does not show seven steps`);
          expect((await page.locator('[data-step="6"] a').count()) === 0 && /Simulated rejection · not a mined revert/.test(await page.locator('[data-step="6"]').innerText()) && (await page.locator('[data-testid="connect-rejection"]').getAttribute("data-error")) === "OperatorNotAuthorized", `${tag}: step 6 is not shown as a simulated rejection`);
          const quote = page.locator('[data-testid="connect-quote"]');
          const quoteText = (await quote.innerText()).replace(/\s+/g, " ");
          expect((await quote.getAttribute("data-available")) === "false" && /Quote unavailable/.test(quoteText) && !/\d[\d,.]* (WOKB|USDC)/.test(quoteText), `${tag}: the unavailable quote is shown as "${quoteText.slice(0, 160)}"`);
          // Kinds of evidence stay apart: scripted client verified, LLM session pending, simulated rejection, no mined revert.
          const kinds = Object.fromEntries(await page.locator('[data-testid="connect-evidence"] [data-evidence]').evaluateAll((nodes) => nodes.map((node) => [node.dataset.evidence, node.dataset.status])));
          expect(kinds.scripted === "Verified" && kinds.llm === "Verified" && /nothing sent/.test(kinds["simulated-rejection"] ?? "") && /reverted on chain/.test(kinds["mined-revert"] ?? ""), `${tag}: evidence kinds are ${JSON.stringify(kinds)}`);
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
        if (path === "/discover") {
          // D23: a curated set of genuine templates, each labelled available / demonstration / planned, with no
          // invented performance, TVL, APY or users.
          const cards = await page.locator('[data-testid="discover-card"]').evaluateAll((nodes) => nodes.map((node) => ({ profile: node.dataset.profile, availability: node.dataset.availability, canSign: node.dataset.canSign, adopt: node.querySelector('[data-testid="discover-adopt"]')?.getAttribute("href") ?? null, adoptText: node.querySelector('[data-testid="discover-adopt"]')?.innerText.trim() ?? null, text: node.innerText.replace(/\s+/g, " ").slice(0, 200) })));
          notes.push({ wallet: who.name, width, discover: cards });
          expect(cards.length === 2 && cards.every((card) => ["available", "demonstration", "planned"].includes(card.availability ?? "")), `${tag}: Discover lists ${JSON.stringify(cards)}`);
          // The v2 template can be signed only while the v2 deployment's own switch for this app is on.
          // The link says "Adopt" only when this build can sign; otherwise it offers the review, or nothing.
          for (const card of cards) expect((card.adopt === null || card.adopt === `/strategies?template=${card.profile}#create`) && (card.canSign === "true" ? /^Adopt/.test(card.adoptText ?? "") : card.adopt === null || /^Review the transaction/.test(card.adoptText ?? "")), `${tag}: the adopt link of ${card.profile} does not follow its availability: ${JSON.stringify(card)}`);
          const v2Card = cards.find((card) => card.availability === "demonstration");
          expect(v2Manifest.uiEnabled === true || (v2Card !== undefined && v2Card.canSign === "false"), `${tag}: with the v2 switch off, no template is shown as a demonstration that cannot be signed here`);
          expect(/Performance figures are not shown, because none exist yet/.test(main), `${tag}: Discover does not state that it shows no metrics`);
          const claims = main;
          expect(!/\bAPY\b|\bTVL\b/.test(claims) && !/\d[\d.,]*\s*%\s*(APR|yield|return)/i.test(claims) && !/\d[\d,]*\+?\s+(users|adopters|depositors)\b/i.test(claims), `${tag}: Discover shows a performance, TVL or user figure`);
          expect((await page.locator('[data-testid="discover-planned"] li').count()) >= 1 && /Not available yet/i.test(main), `${tag}: planned items are not listed apart`);
          // D24: "Available on testnet" and "Planned" cannot be mistaken for one another. The planned band holds no
          // card that can be adopted, no link and no button; its border is dashed and every badge in it says Planned;
          // no badge outside it does; and the band over the cards says "Available on testnet" only if each can be signed.
          const bands = await page.evaluate(() => {
            const planned = document.querySelector('[data-testid="discover-planned"]');
            const available = document.querySelector('[data-testid="discover-available"]');
            const badge = (node) => node.getAttribute("data-strategy-availability");
            return {
              plannedControls: planned.querySelectorAll('a, button, [data-testid="discover-card"]').length,
              plannedBorder: getComputedStyle(planned).borderTopStyle,
              plannedItemBorders: [...planned.querySelectorAll("li")].map((item) => getComputedStyle(item).borderTopStyle),
              plannedBadges: [...planned.querySelectorAll("[data-strategy-availability]")].map(badge),
              plannedBadgeBorders: [...planned.querySelectorAll("[data-strategy-availability]")].map((node) => getComputedStyle(node.parentElement).borderTopStyle),
              availableBadges: [...available.querySelectorAll("[data-strategy-availability]")].map(badge),
              availableBadgeBorders: [...available.querySelectorAll("[data-strategy-availability]")].map((node) => getComputedStyle(node.parentElement).borderTopStyle),
              availableHeading: available.querySelector("h2").innerText.replace(/\s+/g, " "),
              allAvailable: available.dataset.allAvailable,
              plannedAfterAvailable: Boolean(available.compareDocumentPosition(planned) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
          });
          expect(bands.plannedControls === 0 && bands.plannedBorder === "dashed" && bands.plannedItemBorders.every((style) => style === "dashed") && bands.plannedBadges.length >= 1 && bands.plannedBadges.every((status) => status === "planned") && bands.plannedBadgeBorders.every((style) => style === "dashed"), `${tag}: the planned band is not visibly apart (dashed, Planned badges only, no control): ${JSON.stringify(bands)}`);
          expect(bands.availableBadges.length === cards.length && !bands.availableBadges.includes("planned") && bands.availableBadgeBorders.every((style) => style !== "dashed") && bands.plannedAfterAvailable && /^Available on testnet/.test(bands.availableHeading) === (bands.allAvailable === "true") && (bands.allAvailable === "true") === cards.every((card) => card.availability === "available"), `${tag}: the band over the template cards does not follow their availability, or carries a Planned badge: ${JSON.stringify(bands)}`);
          // Inspecting a template shows its details without asking the wallet for anything.
          await page.locator('[data-testid="discover-inspect"]').first().click();
          expect((await page.locator('[data-testid="discover-details"]').count()) === 1 && (await overflow(page)) <= 0, `${tag}: the template details do not open, or overflow (${await overflow(page)}px)`);
          await shot(page, `testnet-${who.name}-discover-${width}`);
        }
        if (path === "/studio") {
          const workspace = (await page.locator('[data-testid="studio-workspace"]').innerText()).replace(/\s+/g, " ");
          // D23: Studio is the creator workspace; managed vaults stay roadmap (and are not the ERC-4626 adapter).
          expect((await page.locator('[data-testid="studio-create-strategy"]').getAttribute("href")) === "/strategies#create" && (await page.locator('[data-testid="studio-create-market"]').getAttribute("href")) === "/studio/create", `${tag}: the Studio workspace does not link to strategy and market creation`);
          expect(/Managed vaults/i.test(workspace) && /Roadmap/i.test(workspace) && /not the ERC-4626 adapter/.test(workspace), `${tag}: managed vaults are not shown as roadmap, apart from the ERC-4626 adapter: ${workspace.slice(0, 300)}`);
          await shot(page, `testnet-${who.name}-studio-${width}`);
        }
        if (path === "/activity") {
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
          // Historical snapshot (labelled with its range, terminal hash re-read) and the two mined reverts.
          const snapshotFile = JSON.parse(readFileSync(new URL("../../../packages/chain-config/activity/1952.json", import.meta.url), "utf8"));
          const snap = page.locator('[data-testid="activity-snapshot"]');
          await page.waitForFunction(() => !["checking", null].includes(document.querySelector('[data-testid="activity-snapshot"]')?.getAttribute("data-state") ?? null), null, { timeout: 60_000 }).catch(() => {});
          const snapShown = { state: await snap.getAttribute("data-state"), from: await snap.getAttribute("data-from"), to: await snap.getAttribute("data-to"), events: await snap.getAttribute("data-events"), gap: await snap.locator('[data-testid="snapshot-gap"]').getAttribute("data-gap").catch(() => null), listed: await snap.locator("[data-snapshot-event]").count() };
          expect(snapShown.state === "canonical" && snapShown.from === snapshotFile.coverage.fromBlock && snapShown.to === snapshotFile.coverage.toBlock && snapShown.events === String(snapshotFile.events.length) && snapShown.gap !== null, `${tag}: the activity snapshot is shown as ${JSON.stringify(snapShown)}`);
          expect(/Historical snapshot/i.test(await snap.innerText()) && /not a live feed/.test(await snap.innerText()), `${tag}: the snapshot is not labelled as historical`);
          const mined = await page.locator('[data-testid="mined-rejections"] [data-mined-rejection]').evaluateAll((nodes) => nodes.map((node) => ({ error: node.dataset.minedRejection, hash: node.dataset.hash, href: node.querySelector("a")?.getAttribute("href") ?? null })));
          expect(mined.length === 2 && rejectionsFile.rejections.every((entry) => mined.some((row) => row.hash === entry.hash && row.error === entry.minedRevert.name && row.href === explorerTxUrl(1952, entry.hash))) && /Mined reverts/.test(await page.locator('[data-testid="mined-rejections"]').innerText()), `${tag}: mined rejections are shown as ${JSON.stringify(mined)}`);
          notes.push({ wallet: who.name, width, snapshot: snapShown, minedRejections: mined });
          // The keeper service on this machine watches the LOCAL chain. On a 1952 build it must never contribute rows.
          // Without KEEPER_API_URL the panel is not rendered at all ("hidden"), which is what the hosted app must do.
          const keeper = (await page.locator('[data-testid="keeper-panel"]').count()) === 0 ? "hidden" : await page.locator('[data-testid="keeper-panel"]').getAttribute("data-keeper");
          const keeperRows = await page.locator('[data-testid="keeper-panel"] li[data-keeper-state], [data-testid="keeper-panel"] [data-chain-repay]').count();
          const keeperText = (await page.locator('[data-testid="keeper-message"]').first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
          notes.push({ wallet: who.name, width, ms, explorerLink: href, reread: rereadText, onChainEntries: chainRows.length, autoRepayInScan: chainRows.some((entry) => /Auto-repay/.test(entry.text)), coverage: coverage || "complete from the deployment block", ranges, unreadBlocks: gap, keeperPanel: keeper, keeperRows, keeperText });
          expect(["hidden", "scope-mismatch", "unavailable"].includes(keeper ?? "") && keeperRows === 0, `${tag}: keeper panel is "${keeper}" with ${keeperRows} row(s): a local keeper must not report into a testnet build`);
          if (process.env.EXPECT_KEEPER) expect(keeper === process.env.EXPECT_KEEPER, `${tag}: keeper panel is "${keeper}", expected "${process.env.EXPECT_KEEPER}"`);
          for (const entry of chainRows) expect(entry.link === null || entry.link.startsWith(`${DOCS_EXPLORER_ROOT}/tx/0x`), `${tag}: unexpected link ${entry.link}`);
          // The snapshot is merged into the list: its range counts as read only after its last block was verified, each
          // row says where it was read from, a row found by both sources appears once, and the blocks NEITHER source
          // covers are stated with their exact numbers.
          const merge = { state: await coverageNode.locator("[data-snapshot]").getAttribute("data-snapshot").catch(() => null), added: Number((await coverageNode.locator("[data-snapshot]").getAttribute("data-snapshot-added").catch(() => null)) ?? -1), shared: Number((await coverageNode.locator("[data-snapshot]").getAttribute("data-snapshot-shared").catch(() => null)) ?? -1), to: await coverageNode.locator("[data-snapshot]").getAttribute("data-snapshot-to").catch(() => null), complete: await coverageNode.getAttribute("data-complete").catch(() => null) };
          const rows = await page.locator('[data-testid="chain-activity"] li[data-result]').evaluateAll((nodes) => nodes.map((node) => ({ source: node.dataset.source ?? null, hash: node.querySelector("a")?.getAttribute("href")?.split("/tx/")[1] ?? null, title: node.querySelector("h3")?.innerText.replace(/\s+/g, " ") ?? "", text: node.innerText.replace(/\s+/g, " ") })));
          notes.push({ wallet: who.name, width, merge, rowsBySource: rows.reduce((count, row) => ({ ...count, [row.source ?? "none"]: (count[row.source ?? "none"] ?? 0) + 1 }), {}) });
          expect(merge.state === "merged" && merge.to === snapshotFile.coverage.toBlock, `${tag}: the snapshot is not merged into the activity list: ${JSON.stringify(merge)}`);
          expect(rows.every((row) => ["scan", "snapshot", "both"].includes(row.source ?? "")) && rows.filter((row) => row.source === "snapshot").length === merge.added && rows.filter((row) => row.source === "both").length === merge.shared, `${tag}: the rows' sources do not add up to the stated merge: ${JSON.stringify(merge)}, ${rows.map((row) => row.source).join(",")}`);
          expect(rows.every((row) => (row.source === "snapshot" ? /From the indexed snapshot/.test(row.text) : row.source === "both" ? /Live scan · also in the snapshot/.test(row.text) : /Live scan/.test(row.text))), `${tag}: a row does not say where it was read from`);
          expect(new Set(rows.map((row) => `${row.hash}:${row.title}`)).size === rows.length, `${tag}: the merged list shows an entry twice`);
          // Every snapshot-only row really is an event of the snapshot file, inside its range.
          expect(rows.filter((row) => row.source !== "scan").every((row) => snapshotFile.events.some((event) => event.transactionHash === row.hash && ["PolicyAllowed", "AutoRepayExecuted"].includes(event.eventName))), `${tag}: a row attributed to the snapshot is not in the snapshot file`);
          if (who.name === "demo-owner-watch-only") {
            // What the snapshot holds for this owner (same filter as the scan) must all be in the list.
            const owned = new Set([demoOwner.toLowerCase(), receipt.sentinelAccount.toLowerCase()]);
            const expected = snapshotFile.events.filter((event) => (event.eventName === "AutoRepayExecuted" && owned.has(event.address.toLowerCase())) || (event.eventName === "PolicyAllowed" && ["IsolatedController", "SentinelAccount"].includes(event.contract) && owned.has(String(event.args.account).toLowerCase())));
            const missing = expected.filter((event) => !rows.some((row) => row.hash === event.transactionHash));
            notes.push({ wallet: who.name, width, snapshotEventsForOwner: expected.length, missingFromList: missing.map((event) => event.transactionHash) });
            // Accounts of this owner that the snapshot does not index are still found by the scan, so "at least".
            expect(expected.length > 0 && missing.length === 0 && merge.added + merge.shared >= 1, `${tag}: ${missing.length} of the snapshot's ${expected.length} events for this owner are missing from the merged list`);
          } else expect(merge.added === 0 && merge.shared === 0, `${tag}: snapshot rows are shown for a wallet with no activity: ${JSON.stringify(merge)}`);
          // Honest gap: named exactly, and equal to the blocks between the snapshot's end and the head scan's start.
          const text = coverage;
          expect(/merged from two sources/.test(text) && /re-read from the chain for this page and matches/.test(text) && text.includes(Number(snapshotFile.coverage.toBlock).toLocaleString("en-US")), `${tag}: the merged coverage does not name both sources and the verified snapshot range: "${text}"`);
          if (merge.complete === "false") {
            expect(ranges === 2 && /deployment block/.test(text) && /have not been read by either source/.test(text) && /until the snapshot is refreshed/.test(text) && BigInt(gap ?? "0") > 0n && text.includes(`${LOG_PAGE_BLOCKS} blocks at a time`) && text.includes((BigInt(snapshotFile.coverage.toBlock) + 1n).toLocaleString("en-US")), `${tag}: the unread blocks are not described precisely: "${text}" (ranges ${ranges}, gap ${gap})`);
            // The snapshot card below states the same gap from its side.
            // (The two are computed from two reads of the head a moment apart, so they may differ by a few blocks.)
            const drift = BigInt(snapShown.gap ?? "0") - BigInt(gap ?? "0");
            expect(snapShown.gap !== null && drift > -120n && drift < 120n, `${tag}: the list says ${gap} blocks are unread, the snapshot card says ${snapShown.gap}`);
          } else expect(ranges === 1 && /leave no block unread from the deployment block/.test(text), `${tag}: a complete merged coverage is described as "${text}"`);
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
          expect(/Third-party circuit/i.test(await page.locator('[data-testid="live-mainnet-eval"]').innerText()) && /not a Peridot circuit/i.test(await page.locator('[data-testid="live-mainnet-eval"]').innerText()), `${tag}: the third-party example is not labelled as third-party`);
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
  await checkRedirects();
} else {
  throw new Error("mode must be wrong-network, broken-deployment, rejected-manifest, testnet-unverified, activity-recovery or testnet-live");
}

await browser.close();
const result = { mode, onlyPaths: process.env.ONLY_PATHS ?? null, case: process.env.CASE ?? null, base: BASE, account, readOnlyWallet: true, passed: failures.length === 0, failures, notes };
if (OUT) writeFileSync(`${OUT}/${mode}${process.env.CASE ? `-${process.env.CASE}` : ""}.json`, JSON.stringify(result, null, 2) + "\n");
if (failures.length) {
  console.error(`${mode}: ${failures.length} check(s) FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${mode}${process.env.CASE ? ` (${process.env.CASE})` : ""}: all checks passed. ${JSON.stringify(notes)}`);

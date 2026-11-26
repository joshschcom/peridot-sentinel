// Evidence screenshots of the strategy-first pages (DECISIONS D23) from a LIVE testnet build.
//   BASE_URL=http://127.0.0.1:3220 [OUT=<dir>] [ONLY=portfolio,connect] PLAYWRIGHT_BROWSERS_PATH=0 node scripts/shots-strategy-first.mjs
// Landing, Portfolio, Strategies, Discover, Studio and Connect at 390 and 1440 px, light and dark. The app pages are
// taken with a WATCH-ONLY test wallet that reports the public demo owner's address on chain 1952 (no key; it refuses
// to sign or send), so they show real public testnet data. Each context is a fresh profile with only the colour
// scheme set. A page is captured only after its live reads have settled; a read that fails is recorded, not hidden.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connectWallet, installTestWallet } from "./lib/test-wallet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3220").replace(/\/$/, "");
const OUT = resolve(process.env.OUT ?? resolve(here, "../../../evidence/screenshots/strategy-first"));
const WATCH = "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67"; // public demo owner address (AGENTS.md); no key is used
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
// `ready`: selectors that must exist before the capture (live reads that finish after first paint).
const PAGES = [
  { name: "landing", path: "/", wallet: false, ready: [] },
  { name: "portfolio", path: "/portfolio", wallet: true, ready: ['[data-testid="portfolio-summary"]', '[data-testid="portfolio-v2"]:not([data-state="loading"])', '[data-testid="portfolio-recent"]:not([data-count=""])', '[data-testid="sentinel-account"]'] },
  { name: "strategies", path: "/strategies", wallet: true, ready: ['[data-testid="active-strategies"]:not([data-count=""])', '[data-testid="emergency-stop"]', '[data-testid="account-repays"]:not([data-count=""])'] },
  { name: "discover", path: "/discover", wallet: true, ready: ['[data-testid="discover-card"]'] },
  { name: "studio", path: "/studio", wallet: true, ready: ['[data-testid="studio-workspace"]'] },
  { name: "connect", path: "/connect", wallet: true, ready: ['[data-testid="connect-grant"]:not([data-state="loading"])', '[data-testid="connect-judge"]:not([data-state="loading"])'] },
];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const entry of PAGES.filter((candidate) => !only || only.includes(candidate.name))) {
  for (const width of [390, 1440]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: width < 500 ? 2 : 1, reducedMotion: "reduce" });
      const wallet = entry.wallet ? await installTestWallet(context, { account: WATCH, walletChainId: "0x7a0", watchOnly: true }) : null;
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(BASE + entry.path, { waitUntil: "networkidle", timeout: 90_000 });
      await page.evaluate(() => document.fonts.ready);
      if (entry.wallet) await connectWallet(page);
      const notReady = [];
      for (const selector of entry.ready) await page.locator(selector).first().waitFor({ timeout: 90_000 }).catch(() => notReady.push(selector));
      await page.waitForFunction(() => !document.querySelector("[data-loading]"), null, { timeout: 90_000 }).catch(() => notReady.push("[data-loading] still present"));
      await page.waitForTimeout(800);
      // Grow the viewport to the document so sticky and fixed chrome sits where a reader sees it.
      for (let pass = 0; pass < 2; pass++) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width, height: Math.min(Math.max(height, 600), 16000) });
        await page.waitForTimeout(200);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = `${entry.name}-${width}-${scheme}.png`;
      await page.screenshot({ path: `${OUT}/${file}` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const state = { file, overflowPx: overflow, pageErrors: errors, notReady, deploymentBanner: await page.locator('[data-testid="deployment-banner"]').count(), fixtureBanner: await page.locator('[data-testid="fixture-banner"]').count(), walletRequests: wallet ? wallet.sent.length + wallet.refused.length : 0 };
      report.push(state);
      console.log(`${overflow > 0 || errors.length || notReady.length || state.deploymentBanner || state.fixtureBanner ? "!!" : "ok"} ${file}${notReady.length ? ` not ready: ${notReady.join(", ")}` : ""}${overflow > 0 ? ` overflow ${overflow}px` : ""}`);
      await context.close();
    }
  }
}
await browser.close();
const bad = report.filter((entry) => entry.overflowPx > 0 || entry.pageErrors.length || entry.notReady.length || entry.deploymentBanner || entry.fixtureBanner || entry.walletRequests);
writeFileSync(`${OUT}/shots.json`, `${JSON.stringify({ base: BASE, at: new Date().toISOString(), wallet: "watch-only test wallet reporting the public demo owner address on chain 1952; it cannot sign or send", passed: bad.length === 0, shots: report }, null, 2)}\n`);
console.log(bad.length ? `${bad.length} capture(s) with a problem` : `All ${report.length} captures are clean. ${OUT}`);
process.exit(bad.length ? 1 : 0);

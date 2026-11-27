// Evidence screenshots of the strategy-first pages (DECISIONS D23) from a LIVE testnet build.
//   BASE_URL=http://127.0.0.1:3220 [OUT=<dir>] [ONLY=portfolio,connect] [FORMAT=jpeg] PLAYWRIGHT_BROWSERS_PATH=0 node scripts/shots-strategy-first.mjs
// FORMAT=jpeg writes .jpg (quality 72) instead of .png: a fraction of the size, for a repository that keeps its evidence.
// With ONLY, the report is written to shots-<names>.json, so the report of a full run is not overwritten by a partial one.
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
const JPEG = process.env.FORMAT === "jpeg";
// `ready`: selectors that must exist before the capture (live reads that finish after first paint).
const PAGES = [
  { name: "landing", path: "/", wallet: false, ready: [] },
  { name: "portfolio", path: "/portfolio", wallet: true, ready: ['[data-testid="portfolio-summary"]', '[data-testid="portfolio-v2"]:not([data-state="loading"])', '[data-testid="portfolio-recent"]:not([data-count=""])', '[data-testid="sentinel-account"]'] },
  { name: "strategies", path: "/strategies", wallet: true, ready: ['[data-testid="active-strategies"]:not([data-count=""])', '[data-testid="emergency-stop"]', '[data-testid="account-repays"]:not([data-count=""])'] },
  { name: "discover", path: "/discover", wallet: true, ready: ['[data-testid="discover-card"]', '[data-testid="discover-published"]:not([data-state="loading"])'] },
  { name: "studio", path: "/studio", wallet: true, ready: ['[data-testid="studio-workspace"]'] },
  // Connect is the longest page (about 17,000 px at phone width): captured at scale 1 there so it is not cut off.
  { name: "connect", path: "/connect", wallet: true, tall: true, ready: ['[data-testid="connect-grant"]:not([data-state="loading"])', '[data-testid="connect-judge"]:not([data-state="loading"])'] },
];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const entry of PAGES.filter((candidate) => !only || only.includes(candidate.name))) {
  for (const width of [390, 1440]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: width < 500 && !entry.tall ? 2 : 1, reducedMotion: "reduce" });
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
      const CAP = entry.tall ? 30000 : 16000;
      let pageHeight = 0;
      for (let pass = 0; pass < 2; pass++) {
        pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width, height: Math.min(Math.max(pageHeight, 600), CAP) });
        await page.waitForTimeout(200);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = `${entry.name}-${width}-${scheme}.${JPEG ? "jpg" : "png"}`;
      await page.screenshot({ path: `${OUT}/${file}`, ...(JPEG ? { type: "jpeg", quality: 72 } : {}) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const registryTier = entry.name === "discover" ? { state: await page.locator('[data-testid="discover-published"]').getAttribute("data-state").catch(() => null), accepted: await page.locator('[data-testid="published-card"]').count(), rejected: await page.locator('[data-testid="published-rejected"]').count() } : undefined;
      const state = { file, registryTier, pageHeightPx: pageHeight, truncated: pageHeight > CAP, overflowPx: overflow, pageErrors: errors, notReady, deploymentBanner: await page.locator('[data-testid="deployment-banner"]').count(), fixtureBanner: await page.locator('[data-testid="fixture-banner"]').count(), walletRequests: wallet ? wallet.sent.length + wallet.refused.length : 0 };
      report.push(state);
      console.log(`${overflow > 0 || errors.length || notReady.length || state.deploymentBanner || state.fixtureBanner || state.truncated ? "!!" : "ok"} ${file}${state.truncated ? ` TRUNCATED at ${CAP}px of ${pageHeight}px` : ""}${notReady.length ? ` not ready: ${notReady.join(", ")}` : ""}${overflow > 0 ? ` overflow ${overflow}px` : ""}`);
      await context.close();
    }
  }
}
await browser.close();
const bad = report.filter((entry) => entry.truncated || entry.overflowPx > 0 || entry.pageErrors.length || entry.notReady.length || entry.deploymentBanner || entry.fixtureBanner || entry.walletRequests);
writeFileSync(`${OUT}/${only ? `shots-${only.join("-")}` : "shots"}.json`, `${JSON.stringify({ base: BASE, at: new Date().toISOString(), wallet: "watch-only test wallet reporting the public demo owner address on chain 1952; it cannot sign or send", passed: bad.length === 0, shots: report }, null, 2)}\n`);
console.log(bad.length ? `${bad.length} capture(s) with a problem` : `All ${report.length} captures are clean. ${OUT}`);
process.exit(bad.length ? 1 : 0);

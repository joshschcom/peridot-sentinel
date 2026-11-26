// Ad-hoc screenshot helper for visual review: node scripts/shot.mjs <path> <width> <light|dark> <out.png> [clipHeight]
import { chromium } from "playwright";
import { connectWallet, installTestWallet } from "./lib/test-wallet.mjs";
const [path, width, scheme, out, clip] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(width), height: 900 }, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: "reduce" });
// WALLET=<address>: a watch-only test wallet that only reports this address on WALLET_CHAIN (default 0x7a0 = 1952).
if (process.env.WALLET) await installTestWallet(context, { account: process.env.WALLET, walletChainId: process.env.WALLET_CHAIN ?? "0x7a0", watchOnly: true });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 400)));
page.on("pageerror", (e) => console.log("page error:", String(e).slice(0, 400)));
await page.goto((process.env.BASE_URL ?? "http://127.0.0.1:3210") + path, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
if (process.env.WALLET) {
  await connectWallet(page);
  await page.waitForTimeout(Number(process.env.SETTLE ?? 6000));
}
if (process.env.CLICK) {
  for (const selector of process.env.CLICK.split("|")) {
    await page.locator(selector).first().click();
    await page.waitForTimeout(Number(process.env.WAIT ?? 300));
  }
}
if (process.env.FILL) {
  const [selector, value] = process.env.FILL.split("::");
  await page.locator(selector).first().fill(value);
  await page.waitForTimeout(500);
  if (process.env.CLICK_AFTER) {
    await page.locator(process.env.CLICK_AFTER).first().click();
    await page.waitForTimeout(Number(process.env.WAIT ?? 300));
  }
}
await page.screenshot({ path: out, fullPage: !clip, ...(clip ? { clip: { x: 0, y: Number(process.env.Y ?? 0), width: Number(width), height: Number(clip) } } : {}) });
await browser.close();

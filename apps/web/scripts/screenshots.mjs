// Captures evidence screenshots and runs basic UI checks against a running server.
//   BASE_URL=http://127.0.0.1:3210 OUT=../../evidence/screenshots/m0 node scripts/screenshots.mjs [--checks-only] [--only=/path]
// Each shot uses a fresh browser context with only `colorScheme` set and no stored theme,
// so the screenshots also prove the "respect system preference" path.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const OUT = resolve(here, process.env.OUT ?? "../../../evidence/screenshots/m0");
const checksOnly = process.argv.includes("--checks-only");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);

const SHOTS = [
  { path: "/", name: "landing" },
  { path: "/sentinel", name: "sentinel" },
  { path: "/markets/example-0", name: "market-detail" },
  { path: "/studio/create", name: "studio-create" },
];
const ALL_ROUTES = ["/", "/sentinel", "/sentinel/policy", "/sentinel/activity", "/markets", "/markets/example-0", "/studio", "/studio/create", "/studio/example-2", "/circuits"];
const WIDTHS = [390, 768, 1440];
const SCHEMES = ["light", "dark"];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const failures = [];

async function open(path, width, scheme, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: width <= 768 ? 2 : 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector("[data-loading]"), null, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(250);
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
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (status !== 200) failures.push(`${path} @${width}: HTTP ${status}`);
    if (overflow > 0) failures.push(`${path} @${width}: horizontal overflow ${overflow}px`);
    for (const error of errors) failures.push(`${path} @${width}: console error: ${error.slice(0, 300)}`);
    const banner = path === "/" ? 1 : await page.locator('[data-testid="fixture-banner"]').count();
    if (process.env.EXPECT_FIXTURE !== "0" && banner === 0) failures.push(`${path} @${width}: fixture banner missing`);
    await context.close();
  }
  console.log(`checked ${path}`);
}

// 2. /app redirects to /sentinel.
{
  const { context, page } = await open("/app", 390, "light");
  if (!page.url().endsWith("/sentinel")) failures.push(`/app did not redirect to /sentinel (got ${page.url()})`);
  await context.close();
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
if (process.env.WALLET_CHECK === "wrong-network") {
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

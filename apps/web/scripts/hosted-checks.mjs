// Clean-browser validation of a deployed build (the hosted app, or a local `next start` of the production build).
//   BASE_URL=https://<deployment> [NEXT_DIR=.next] [OUT=<dir>] node scripts/hosted-checks.mjs
//
// Every context is a fresh browser profile (no storage, no cookies). The script checks that:
//   - no route asks for authentication or redirects off the origin (no deployment protection);
//   - the pages contact only the app's origin and the two public X Layer RPCs;
//   - the build targets testnet 1952: a wallet on 1952 connects without a network warning, a wallet on another
//     chain gets the wrong-network banner, and no wallet is ever asked to sign or send by browsing;
//   - live reads work (deployment check, Connect grant, v2 account, third-party mainnet eval);
//   - with either RPC unreachable the pages fail closed: errors and "unavailable", never example data or a decision;
//   - phone layout has no horizontal overflow, and light and dark themes both render;
//   - Connect, the native TapeOut page and the v1/v2 labels say what is actually implemented;
//   - (NEXT_DIR) the built bundle has no loopback address, no credential names and no unexplained 32-byte hex value.
// Read-only. The wallet is the watch-only test provider with a PUBLIC address; it refuses to sign or send.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { connectWallet, installTestWallet } from "./lib/test-wallet.mjs";
import { disclosureProblems, hasDisclosures } from "./lib/disclosures.mjs";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3220").replace(/\/$/, "");
const OUT = process.env.OUT ? resolve(process.env.OUT) : null;
const NEXT_DIR = process.env.NEXT_DIR ? resolve(process.env.NEXT_DIR) : null;
const WATCH = "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67"; // public demo owner address (AGENTS.md); no key is used
const ALLOWED_HOSTS = new Set([new URL(BASE).host, "testrpc.xlayer.tech", "rpc.xlayer.tech"]);
// Strategy-first routes (DECISIONS D23). The old URLs are redirects: they are checked as redirects further down.
const ROUTES = ["/", "/portfolio", "/strategies", "/discover", "/activity", "/sentinel/policy", "/markets", "/markets?view=borrow", "/connect", "/trade", "/studio", "/studio/create", "/circuits"];
const REDIRECTS = [["/app", "/portfolio"], ["/sentinel", "/portfolio"], ["/sentinel/activity", "/activity"], ["/automate", "/strategies"]];
if (OUT) mkdirSync(OUT, { recursive: true });

const failures = [];
const notes = {};
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);

/* ---------- 1. the built bundle ---------- */
if (NEXT_DIR) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|css|html|json|txt|rsc|body|meta)$/.test(name)) files.push(path);
    }
  };
  for (const part of ["static", "server"]) if (existsSync(join(NEXT_DIR, part))) walk(join(NEXT_DIR, part));
  const clientFiles = files.filter((file) => file.startsWith(join(NEXT_DIR, "static")));
  const hits = { loopback: [], credentialNames: [] };
  // The strategy SDK REJECTS imported template text that mentions a secret: its validator carries a deny-list regex
  // with the words "mnemonic", "private key" and so on. That one regex, read here from the SDK source, is the only
  // place where such words may appear in the build; it is removed before the scan, and only if it matches exactly.
  const sdkValidator = readFileSync(join(repoRoot, "packages/strategy-sdk/validate.ts"), "utf8");
  const denyList = /\/0x\[0-9a-f\]\{8,\}\|[^\n]*?mnemonic[^\n]*?\/i/.exec(sdkValidator)?.[0] ?? null;
  notes.sdkDenyList = denyList ? "found in packages/strategy-sdk/validate.ts" : "NOT FOUND";
  const hex64 = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const short = file.slice(NEXT_DIR.length + 1);
    // A loopback ADDRESS or a local service port. The bare word "localhost" also occurs inside dependencies' URL
    // parsers, so only its address forms count.
    // The one exception is Next.js's own server-side fallback for a missing metadataBase
    // ("http://localhost:${process.env.PORT}"), which is framework code in the SERVER bundle and is removed before testing.
    const own = clientFiles.includes(file) ? text : text.replaceAll("://localhost:${process.env.PORT", "");
    if (/127\.0\.0\.1|\/\/localhost|localhost:\d|:18545|:8787/.test(own)) hits.loopback.push(short);
    // Names of secrets must not even be referenced by the web build. (SENTINEL_OPERATOR_KEY is shown on /connect as the
    // NAME of a variable the reader sets in their own MCP host; it is documentation, and no value follows it.)
    if (/OKX_API_KEY|OKX_API_SECRET|OKX_API_PASSPHRASE|OK-ACCESS-|PERIDOT_TESTNET_KEY|KEEPER_TESTNET_OPERATOR_KEY|PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE KEY|mnemonic/i.test(denyList ? text.replaceAll(denyList, "") : text)) hits.credentialNames.push(short);
    if (clientFiles.includes(file)) for (const match of text.matchAll(/(?<![0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) hex64.add(match[1].toLowerCase());
  }
  // A private key looks like any 32-byte hex value. So every such value in the CLIENT bundle must be explained: it
  // occurs in a tracked public file of this repo (evidence, manifests, docs, app source) or in a dependency's own code.
  const haystacks = [];
  const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "evidence", "packages", "docs", "deployments", "apps/web/src", "contracts/expansion/policy", "services/mcp"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter((file) => /\.(json|md|ts|tsx|mjs|txt|ndjson)$/.test(file));
  for (const file of tracked) haystacks.push(readFileSync(join(repoRoot, file), "utf8").toLowerCase());
  const generated = join(repoRoot, "apps/web/src/generated");
  if (existsSync(generated)) for (const name of readdirSync(generated)) haystacks.push(readFileSync(join(generated, name), "utf8").toLowerCase());
  const libraryText = [];
  const collect = (dir, depth = 0) => {
    if (!existsSync(dir) || depth > 6) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) collect(path, depth + 1);
      else if (/\.(js|mjs|cjs)$/.test(name) && stat.size < 4_000_000) libraryText.push(readFileSync(path, "utf8").toLowerCase());
    }
  };
  for (const lib of ["viem", "ox", "@noble", "@scure", "wagmi", "@wagmi", "abitype", "next/dist/compiled", "react-dom/cjs", "@tanstack"]) collect(join(repoRoot, "node_modules", lib));
  const unexplained = [...hex64].filter((value) => !haystacks.some((text) => text.includes(value)) && !libraryText.some((text) => text.includes(value)) && !/^(.)\1{63}$/.test(value));
  notes.bundle = { files: files.length, clientFiles: clientFiles.length, hex64InClient: hex64.size, unexplained, loopback: hits.loopback, credentialNames: hits.credentialNames };
  expect(hits.loopback.length === 0, `bundle: loopback address or local port in ${hits.loopback.slice(0, 5).join(", ")}`);
  expect(hits.credentialNames.length === 0, `bundle: a credential name appears in ${hits.credentialNames.slice(0, 5).join(", ")}`);
  expect(unexplained.length === 0, `bundle: ${unexplained.length} 32-byte hex value(s) in the client bundle that no public repo file or dependency explains: ${unexplained.slice(0, 5).join(", ")}`);
  console.log(`bundle: ${files.length} files, ${hex64.size} distinct 32-byte hex values in the client bundle, ${unexplained.length} unexplained`);
}

/* ---------- 2. the pages, in clean browser profiles ---------- */
const browser = await chromium.launch();
async function open(path, { width = 1440, scheme = "light", walletChainId = "0x7a0", wallet = true, block = [] } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, colorScheme: scheme, reducedMotion: "reduce", deviceScaleFactor: width < 500 ? 2 : 1 });
  const handle = wallet ? await installTestWallet(context, { account: WATCH, walletChainId, watchOnly: true }) : null;
  for (const host of block) await context.route(`**://${host}/**`, (route) => route.abort("connectionrefused"));
  const page = await context.newPage();
  const errors = [];
  const hosts = new Set();
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 240)));
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:/.test(url)) hosts.add(new URL(url).host);
  });
  const response = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 });
  if (wallet && path !== "/") await connectWallet(page).catch((error) => errors.push(`connect: ${String(error).slice(0, 120)}`));
  await page.waitForFunction(() => !document.querySelector("[data-loading]"), null, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  page.setDefaultTimeout(3000);
  return { context, page, errors, hosts, handle, status: response?.status() ?? 0, finalUrl: page.url() };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const attr = (page, testid, name) => page.locator(`[data-testid="${testid}"]`).first().getAttribute(name).catch(() => null);
const text = async (page, selector = "main") => ((await page.locator(selector).first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");

const allHosts = new Set();
const backgrounds = {};
for (const [width, scheme] of [[1440, "light"], [390, "dark"]]) {
  for (const path of ROUTES) {
    const tag = `${path} @${width} ${scheme}`;
    const { context, page, errors, hosts, handle, status, finalUrl } = await open(path, { width, scheme });
    for (const host of hosts) allHosts.add(host);
    // No deployment protection: the page itself answers 200 on this origin, with the app's own document.
    expect(status === 200 && new URL(finalUrl).host === new URL(BASE).host, `${tag}: HTTP ${status} at ${finalUrl} (authentication or a redirect?)`);
    expect(/Peridot Sentinel/.test(await page.title()), `${tag}: the document is not the app ("${await page.title()}")`);
    expect([...hosts].every((host) => ALLOWED_HOSTS.has(host)), `${tag}: contacted ${[...hosts].filter((host) => !ALLOWED_HOSTS.has(host)).join(", ")}`);
    expect(errors.length === 0, `${tag}: page errors: ${errors.join(" | ")}`);
    expect((await overflow(page)) <= 0, `${tag}: horizontal overflow ${await overflow(page)}px`);
    if (hasDisclosures(path)) expect((await disclosureProblems(page)).length === 0, `${tag}: disclosures: ${(await disclosureProblems(page)).join("; ")}`);
    expect((await page.locator('[data-testid="fixture-banner"]').count()) === 0 && (await page.locator('[data-testid="deployment-banner"]').count()) === 0, `${tag}: a fixture or deployment banner is shown on the live testnet build`);
    if (path !== "/") {
      // Testnet chain selection: the wallet is on 1952, so there is no network warning and the pill says Testnet.
      expect((await page.locator('[data-testid="wrong-network-banner"]').count()) === 0 && /Testnet/.test(await text(page, '[data-testid="network-pill"]:visible')), `${tag}: a wallet on chain 1952 is not accepted as being on the right network`);
      expect((await page.locator('[data-testid="keeper-panel"]').count()) === 0, `${tag}: the keeper panel is rendered although no keeper service is configured`);
    }
    expect(handle.sent.length === 0 && handle.refused.length === 0, `${tag}: browsing asked the wallet to sign or send`);
    backgrounds[scheme] ??= await page.evaluate(() => [document.body, document.documentElement].map((node) => getComputedStyle(node).backgroundColor).find((colour) => !/rgba\(0, 0, 0, 0\)|transparent/.test(colour)) ?? "none");
    const main = await text(page);
    if (path === "/connect") {
      await page.waitForFunction(() => ["ok", "error"].includes(document.querySelector('[data-testid="connect-grant"]')?.getAttribute("data-state") ?? ""), null, { timeout: 60_000 }).catch(() => {});
      const kinds = Object.fromEntries(await page.locator('[data-testid="connect-evidence"] [data-evidence]').evaluateAll((nodes) => nodes.map((node) => [node.dataset.evidence, node.dataset.status])));
      notes[`connect@${width}`] = { availability: await attr(page, "connect", "data-connect"), tools: await attr(page, "connect-tools", "data-count"), executeTools: await attr(page, "connect-tools", "data-execute-count"), grant: await attr(page, "connect-grant", "data-state"), readiness: await attr(page, "connect-grant", "data-readiness"), kinds };
      expect((await attr(page, "connect", "data-connect")) === "available" && /Available on testnet \(agent-directed\)/.test(main) && (await attr(page, "connect-tools", "data-execute-count")) === "1" && (await attr(page, "connect-grant", "data-state")) === "ok", `${tag}: Connect availability does not match what is implemented: ${JSON.stringify(notes[`connect@${width}`])}`);
      expect((await page.locator('[data-testid="connect"] input, [data-testid="connect"] textarea').count()) === 0, `${tag}: the Connect page has an input`);
      expect(!/autonomous|continuous(ly)? monitor/i.test(main.replace(/not continuous autonomous monitoring/gi, "").replace(/nothing monitors/gi, "")), `${tag}: Connect claims autonomous or continuous monitoring`);
    }
    if (path === "/trade") {
      await page.waitForFunction(() => ["ok", "error"].includes(document.querySelector('[data-testid="v2-account"]')?.getAttribute("data-state") ?? ""), null, { timeout: 90_000 }).catch(() => {});
      notes[`trade@${width}`] = { deployment: await attr(page, "v2-deployment", "data-state"), account: await attr(page, "v2-account", "data-state"), quote: await attr(page, "v2-quote", "data-state") };
      expect((await attr(page, "v2-deployment", "data-state")) === "ok" && (await attr(page, "v2-account", "data-state")) === "ok", `${tag}: v2 live reads are ${JSON.stringify(notes[`trade@${width}`])}`);
      expect(/Mock swap on testnet; real Uniswap v3 verified on mainnet fork/.test(main) && /Sentinel v2/i.test(main) && /not an OKX quote/.test(main), `${tag}: the v2 swap is not labelled as a testnet mock`);
    }
    if (path === "/circuits") {
      await page.locator('[data-testid="live-result"]').waitFor({ timeout: 45_000 }).catch(() => {});
      const own = await text(page, '[data-testid="peridot-mainnet-circuits"]');
      const third = await text(page, '[data-testid="live-mainnet-eval"]');
      notes[`circuits@${width}`] = { peridotPublished: await attr(page, "peridot-mainnet-circuits", "data-published"), thirdParty: await attr(page, "live-mainnet-eval", "data-state"), processor: await attr(page, "peridot-processor-presence", "data-state") };
      expect(/Peridot circuits/i.test(own) && /Native evaluation \(read-only\)/.test(own) && /Evidence, not enforcement/.test(own), `${tag}: Peridot's circuits are not presented as read-only native evaluation`);
      expect(/Third-party circuit/i.test(third) && /not a Peridot circuit/i.test(third) && (await attr(page, "live-mainnet-eval", "data-state")) === "ok", `${tag}: the third-party example is not labelled or did not evaluate`);
      expect(!/enforced on mainnet/i.test(own + third), `${tag}: the page claims enforcement on mainnet`);
    }
    if (path === "/portfolio") expect(/Sentinel v2 account/.test(main) && /Peridot lending/.test(main), `${tag}: v1 and v2 positions are not labelled apart`);
    if (path === "/") {
      // D23 positioning, read from the hosted document itself.
      const headline = ((await page.locator('[data-testid="headline"]').innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      notes[`landing@${width}`] = { headline, create: await attr(page, "cta-create", "href"), explore: await attr(page, "cta-explore", "href") };
      expect(headline === "Put your portfolio on autopilot." && (await attr(page, "cta-create", "href")) === "/strategies#create" && (await attr(page, "cta-explore", "href")) === "/discover" && /Your money\.\s*Your rules\.\s*Your intelligence\./.test(await text(page, '[data-testid="tagline"]')), `${tag}: the landing page does not carry the D23 headline, calls to action and tagline: ${JSON.stringify(notes[`landing@${width}`])}`);
      expect(/testnet/i.test(await text(page, '[data-testid="hero-availability"]')) && /development reference processor/i.test(main) && /mock tokens and a mock price feed/i.test(main), `${tag}: the landing page does not state the testnet scope`);
    }
    if (path === "/discover") {
      const cards = await page.locator('[data-testid="discover-card"]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.profile}:${node.dataset.availability}:${node.dataset.canSign}`));
      notes[`discover@${width}`] = cards;
      expect(cards.length === 2 && /Performance figures are not shown, because none exist yet/.test(main), `${tag}: Discover does not list the two curated templates with the no-metrics statement: ${JSON.stringify(cards)}`);
      // The registry tier reads the public chain without a wallet. Whatever its state, it never offers a signature,
      // and when it lists a strategy it shows who published it.
      const tier = page.locator('[data-testid="discover-published"]');
      if (await tier.count()) {
        await page.locator('[data-testid="discover-published"]:not([data-state="loading"])').waitFor({ timeout: 120_000 }).catch(() => {});
        const published = await page.locator('[data-testid="published-card"]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.profile}:v${node.dataset.version}:${node.querySelector('[data-testid="published-creator"]')?.innerText.trim()}`));
        notes[`registry@${width}`] = { state: await tier.getAttribute("data-state"), published, coverage: await page.locator('[data-testid="published-coverage"] [data-coverage]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.coverage} ${node.dataset.from}-${node.dataset.to}`)) };
        expect((await tier.getAttribute("data-state")) !== "loading" && published.every((entry) => /:v\d+:0x[0-9a-fA-F]{40}$/.test(entry)) && (await page.locator('[data-testid="strategy-sign"]').count()) === 0, `${tag}: the registry tier did not settle, or lists a strategy without its creator: ${JSON.stringify(notes[`registry@${width}`])}`);
      }
    }
    if (path === "/strategies") {
      // Browsing never offers an enabled signature: the sign button exists only inside a review the user asked for.
      expect((await page.locator('[data-testid="strategy-builder"]').count()) === 1 && (await page.locator('[data-testid="strategy-sign"]').count()) === 0, `${tag}: the strategy builder is missing, or a sign button is shown before any review`);
    }
    if (OUT && ["/", "/connect", "/trade", "/circuits", "/portfolio", "/strategies", "/discover", "/studio"].includes(path)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${OUT}/hosted${path === "/" ? "-landing" : path.replace(/\W+/g, "-")}-${width}-${scheme}.png`, fullPage: true });
    }
    console.log(`${failures.length ? "…" : "ok"} ${tag}`);
    await context.close();
  }
}
// The old URLs: a temporary redirect on this origin to the new route, query string kept. Not followed.
notes.redirects = [];
for (const [from, to] of REDIRECTS) {
  for (const query of ["", "?market=0x0000000000000000000000000000000000000001"]) {
    const response = await fetch(BASE + from + query, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    const target = location ? new URL(location, BASE) : null;
    notes.redirects.push(`${from}${query} -> ${response.status} ${location}`);
    expect([307, 308].includes(response.status) && target !== null && target.host === new URL(BASE).host && target.pathname === to && target.search === query, `redirect ${from}${query}: HTTP ${response.status} to "${location}", expected a redirect to ${to}${query} on this origin`);
  }
}
notes.hosts = [...allHosts].sort();
notes.backgrounds = backgrounds;
expect(backgrounds.light && backgrounds.dark && backgrounds.light !== backgrounds.dark, `themes: light and dark render the same background (${JSON.stringify(backgrounds)})`);

// A wallet on another chain: the banner appears and the page offers the switch to testnet; mainnet is never a target.
{
  const { context, page, handle } = await open("/portfolio", { walletChainId: "0xc4" });
  const banner = await text(page, '[data-testid="wrong-network-banner"]');
  notes.wrongNetwork = banner.slice(0, 160);
  expect(/X Layer Testnet/i.test(banner), `wrong network: no banner asking for X Layer testnet for a wallet on chain 196 ("${banner.slice(0, 120)}")`);
  expect(handle.sent.length === 0, "wrong network: a transaction was requested");
  await context.close();
}

// RPC failure paths. Testnet RPC unreachable: no example data, no account data, an explicit failure state.
{
  const { context, page, errors } = await open("/portfolio", { block: ["testrpc.xlayer.tech"] });
  const main = await text(page, "body");
  notes.testnetRpcDown = { banner: (await text(page, '[data-testid="deployment-banner"]')).slice(0, 160), pageErrors: errors.length };
  expect((await page.locator('[data-testid="deployment-banner"]').count()) === 1 && (await page.locator('[data-testid="fixture-banner"]').count()) === 0 && (await page.getByText("Example", { exact: true }).count()) === 0, `testnet RPC down: /portfolio does not fail closed (${main.slice(0, 160)})`);
  expect(errors.length === 0, `testnet RPC down: page errors ${errors.join(" | ")}`);
  await context.close();
  for (const [path, testid] of [["/connect", "connect-grant"], ["/trade", "v2-deployment"]]) {
    const run = await open(path, { block: ["testrpc.xlayer.tech"] });
    await run.page.waitForFunction((id) => !["loading", null].includes(document.querySelector(`[data-testid="${id}"]`)?.getAttribute("data-state") ?? null), testid, { timeout: 90_000 }).catch(() => {});
    const state = await attr(run.page, testid, "data-state");
    notes[`testnetRpcDown ${path}`] = state;
    expect(state === "error" && run.errors.length === 0, `testnet RPC down: ${path} shows "${state}" (page errors: ${run.errors.length})`);
    if (path === "/trade") expect((await run.page.locator('[data-testid="v2-account"], [data-testid="v2-quote"]').count()) === 0, "testnet RPC down: /trade shows v2 data without a verified deployment");
    await run.context.close();
  }
}
// Mainnet RPC unreachable: the native evaluation reports a read failure, and no decision or result is shown.
{
  const { context, page, errors } = await open("/circuits", { block: ["rpc.xlayer.tech"] });
  await page.waitForFunction(() => ["ok", "error"].includes(document.querySelector('[data-testid="live-mainnet-eval"]')?.getAttribute("data-state") ?? ""), null, { timeout: 90_000 }).catch(() => {});
  const state = { thirdParty: await attr(page, "live-mainnet-eval", "data-state"), processor: await attr(page, "peridot-processor-presence", "data-state"), results: await page.locator('[data-testid="live-result"]').count() };
  notes.mainnetRpcDown = state;
  expect(state.thirdParty === "error" && state.processor === "error" && state.results === 0 && errors.length === 0 && !/The circuit answers (allow|deny)/.test(await text(page)), `mainnet RPC down: /circuits shows ${JSON.stringify(state)}`);
  await context.close();
}
await browser.close();

const result = { base: BASE, at: new Date().toISOString(), nextDir: NEXT_DIR ? "scanned" : "not scanned (pass NEXT_DIR for the bundle scan)", routes: ROUTES, passed: failures.length === 0, failures, notes };
if (OUT) writeFileSync(`${OUT}/hosted-checks.json`, JSON.stringify(result, null, 2) + "\n");
console.log(failures.length ? `hosted-checks: ${failures.length} check(s) FAILED:\n- ${failures.join("\n- ")}` : "hosted-checks: all checks passed.");
console.log(JSON.stringify(notes).slice(0, 1800));
process.exit(failures.length ? 1 : 0);

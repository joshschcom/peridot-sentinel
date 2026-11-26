// Strategy adoption and revocation, SIGNED in a real browser, against a PRIVATE FORK of X Layer testnet 1952.
//   Node:   a loopback Anvil fork of 1952 with --chain-id 1952 and --auto-impersonate. Claude runs it; this script never starts one.
//   Server: NEXT_PUBLIC_PERIDOT_FORK=1 NEXT_PUBLIC_TESTNET_RPC_URL=http://127.0.0.1:19750 npm run dev -- -p 3213 -H 127.0.0.1
//   Run:    PLAYWRIGHT_BROWSERS_PATH=0 node scripts/e2e-fork-strategy.mjs
// The "wallet" is the test-only EIP-1193 provider: it reports the public demo owner and forwards to the fork, which
// signs by impersonation. There is no private key anywhere. Nothing here touches the public chain, and no hash this
// script produces exists there.
//
// What it accepts, for each of the SDK's two templates:
//   review  buildAdoptionPlan in the page: nothing is sent while a plan is built, an existing grant or a trigger change
//           requires the acknowledgement, and the transactions are listed with their exact calldata;
//   sign    one transaction at a time; the calldata the node mined is byte-for-byte the calldata that was shown;
//   read    the grant on chain equals the template's values; then buildRevocationPlan, sign, and the grant is zero.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SentinelAccountAbi } from "@peridot/chain-config";
import { chromium } from "playwright";
import { createPublicClient, http, parseAbi } from "viem";
import { LOOPBACK_RPC, connectWallet, installTestWallet, jsonRpc } from "./lib/test-wallet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3213";
const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:19750";
const OWNER = process.env.FORK_OWNER ?? "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67"; // public demo owner, impersonated by the fork
const OPERATOR = process.env.FORK_OPERATOR ?? "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"; // an address only: it never signs
const V1_ACCOUNT = "0xAD7c0077CbdDe5CbBcDD207F612B124f0c3776A0";
const V2_ACCOUNT = "0x7dC8DD13f3C73DaeecAa37cB1f321A08AF741b5f";
const RUN_ID = `run-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
const SHOTS = resolve(here, "../../../evidence/screenshots/fork-strategy", RUN_ID);
const OUT = resolve(here, "../../../evidence/fable/run5");
if (!LOOPBACK_RPC.test(RPC)) throw new Error("This script only runs against a loopback fork");
if ((await jsonRpc(RPC, "eth_chainId")) !== "0x7a0") throw new Error("Expected a fork that reports chain 1952");
const version = await jsonRpc(RPC, "web3_clientVersion");
if (!/anvil/i.test(version)) throw new Error(`The node is not Anvil (${version}): refusing to send`);
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const chain = createPublicClient({ transport: http(RPC) });
const V2_ABI = parseAbi(["function grants(address operator, address adapter, uint8 op, address inputAsset) view returns (uint256 maxPerCall, uint256 remaining, uint64 expiry)", "function swapAdapter() view returns (address)", "function token0() view returns (address)", "function token1() view returns (address)"]);
const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", reducedMotion: "reduce" });
const { sent } = await installTestWallet(context, { rpcUrl: RPC, account: OWNER, walletChainId: "0x7a0" });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${String(error).slice(0, 300)}`));
page.on("console", (message) => message.type() === "error" && !/Failed to load resource/.test(message.text()) && problems.push(`console: ${message.text().slice(0, 300)}`));
const steps = [];
const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const plan = () => page.locator('[data-testid="strategy-plan"]');
const planAttr = (name) => plan().getAttribute(name);

async function open(profile) {
  await page.goto(`${BASE}/strategies?template=${profile}`, { waitUntil: "networkidle" });
  await connectWallet(page);
  await page.locator(`[data-testid="template-option-${profile}"][aria-checked="true"]`).waitFor({ timeout: 15000 });
  const pill = await page.locator('[data-testid="network-pill"]:visible').first().innerText().catch(() => "");
  assert(/fork/i.test(pill), `the network is not labelled as a fork (got "${pill}")`);
  assert((await page.locator('a[href*="okx.com/web3/explorer"]').count()) === 0, "a fork build shows an explorer link");
}

/** Builds the review. Returns what the page shows. Asserts that building sends nothing. */
async function buildReview(kind) {
  const before = sent.length;
  await page.locator(`[data-testid="strategy-kind-${kind}"]`).click();
  await page.locator('[data-testid="strategy-operator"]').fill(OPERATOR);
  await page.locator('[data-testid="strategy-review-submit"]').click();
  await plan().waitFor({ timeout: 60000 }).catch(async () => {
    throw new Error(`no plan: ${(await page.locator('[data-testid="strategy-review"]').innerText()).slice(0, 500)}`);
  });
  assert(sent.length === before, "building a review sent a transaction");
  assert((await planAttr("data-kind")) === kind, "the plan is of the wrong kind");
}

/** Signs every transaction of the current plan, one at a time, checking each mined input against what was shown. */
async function signAll(label) {
  const signed = [];
  for (let guard = 0; guard < 4; guard++) {
    if (await page.locator('[data-testid="strategy-confirmed"]').count()) break;
    const ack = page.locator('[data-testid="strategy-ack"]');
    if (await ack.count()) {
      const warnings = await page.locator('[data-testid="strategy-warnings"] li').allInnerTexts();
      assert(warnings.length > 0 && (await planAttr("data-tx-count")) === "0" && (await planAttr("data-review-id")) !== "", `${label}: an acknowledgement was asked for without a review id or warnings`);
      assert(await page.locator('[data-testid="strategy-ack-submit"]').isDisabled(), `${label}: the transactions can be shown without ticking the acknowledgement`);
      await ack.check();
      await page.locator('[data-testid="strategy-ack-submit"]').click();
      await page.locator('[data-testid="strategy-tx"]').first().waitFor({ timeout: 60000 });
      steps.push({ label: `${label}: acknowledged review ${await planAttr("data-review-id")}`, warnings });
    }
    const shown = await page.locator('[data-testid="strategy-tx"]').evaluateAll((nodes) => nodes.map((node) => ({ method: node.dataset.method, to: node.dataset.to, from: node.dataset.from, data: node.dataset.data, value: node.dataset.value })));
    assert(shown.length > 0, `${label}: no transaction is listed`);
    const next = shown[0];
    assert(same(next.from, OWNER) && next.value === "0", `${label}: the listed transaction is not a zero-value call from the owner`);
    await shot(`${label}-${signed.length + 1}-review-${next.method}`);
    const before = sent.length;
    const count = await page.locator('[data-testid="strategy-signed"] li').count();
    await page.locator('[data-testid="strategy-sign"]').click();
    await page.waitForFunction((expected) => document.querySelectorAll('[data-testid="strategy-signed"] li').length > expected || document.querySelector('[data-testid="strategy-review"] [data-rejection]'), count, { timeout: 90000 });
    if (await page.locator('[data-testid="strategy-review"] [data-rejection]').count()) throw new Error(`${label}: failed in the app: ${(await page.locator('[data-testid="strategy-review"] [data-testid="tx-feedback"]').innerText()).slice(0, 400)}`);
    assert(sent.length === before + 1, `${label}: one signature sent ${sent.length - before} transactions`);
    const hash = sent.at(-1).hash;
    const [tx, receipt] = await Promise.all([chain.getTransaction({ hash }), chain.getTransactionReceipt({ hash })]);
    assert(receipt.status === "success", `${label}: ${hash} did not succeed`);
    assert(tx.input === next.data && same(tx.to, next.to) && same(tx.from, OWNER) && tx.value === 0n, `${label}: the mined transaction is not the one that was shown`);
    signed.push({ method: next.method, hash, to: next.to, data: next.data, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), listedBefore: shown.map((entry) => entry.method) });
    console.log(`${label}: signed ${next.method} ${hash} (block ${receipt.blockNumber}); mined input equals the reviewed calldata`);
    // The page reads again after every receipt.
    await page.waitForFunction((block) => Number(document.querySelector('[data-testid="strategy-plan"]')?.getAttribute("data-block") ?? 0) >= Number(block), receipt.blockNumber.toString(), { timeout: 60000 });
    await page.waitForTimeout(500);
  }
  const confirmed = page.locator('[data-testid="strategy-confirmed"]');
  await confirmed.waitFor({ timeout: 30000 });
  assert((await confirmed.getAttribute("data-confirmed")) === "true", `${label}: the page does not confirm the result: ${await confirmed.innerText()}`);
  return signed;
}

let failure = null;
try {
  /* ---------- debt protection (v1): trigger change + repay-only grant, then revoke ---------- */
  const triggerBefore = Number(await chain.readContract({ address: V1_ACCOUNT, abi: SentinelAccountAbi, functionName: "autoRepayTriggerBps" }));
  const wanted = triggerBefore === 5000 ? 4800 : 5000;
  await open("debt-protection-v1");
  await page.locator('[data-testid="strategy-param-trigger"]').fill(String(wanted / 100));
  await page.locator('[data-testid="strategy-param-budget"]').fill("1.5");
  await page.locator('[data-testid="strategy-param-expiry"]').selectOption("3600");
  // A value over the SDK's cap is refused by the SDK, and the review disappears.
  await page.locator('[data-testid="strategy-param-budget"]').fill("2.5");
  await page.locator('[data-testid="strategy-param-error"]').waitFor({ timeout: 5000 });
  assert((await page.locator('[data-testid="strategy-review"]').count()) === 0, "a refused template still offers a review");
  await page.locator('[data-testid="strategy-param-budget"]').fill("1.5");
  const v1Hash = await page.locator('[data-testid="strategy-summary"]').getAttribute("data-hash");
  await buildReview("adopt");
  assert(same(await planAttr("data-account"), V1_ACCOUNT), "the plan is not for the owner's own v1 account");
  assert((await planAttr("data-trigger")) === String(triggerBefore), "the plan does not show the trigger that is on chain");
  const adoptV1 = await signAll("v1-adopt");
  assert(adoptV1.map((entry) => entry.method).join() === "setAutoRepayTrigger,setOperator", `v1 adoption signed ${adoptV1.map((entry) => entry.method)}`);
  const grantV1 = await chain.readContract({ address: V1_ACCOUNT, abi: SentinelAccountAbi, functionName: "operators", args: [OPERATOR] });
  const triggerAfter = Number(await chain.readContract({ address: V1_ACCOUNT, abi: SentinelAccountAbi, functionName: "autoRepayTriggerBps" }));
  const grantBlock = await chain.getBlock({ blockNumber: BigInt(adoptV1[1].block) });
  assert(Number(grantV1[0]) === 8 && grantV1[1] === 1_500_000n && triggerAfter === wanted, `v1 grant on chain is ${grantV1}, trigger ${triggerAfter}`);
  assert(grantV1[2] > grantBlock.timestamp && grantV1[2] <= grantBlock.timestamp + 3600n, "the v1 grant expiry is not within one hour of the block it was mined in");
  steps.push({ label: "v1 adoption (debt protection)", templateHash: v1Hash, account: V1_ACCOUNT, operator: OPERATOR, triggerBefore, triggerAfter, grant: { mask: Number(grantV1[0]), remainingRaw: grantV1[1].toString(), expiry: grantV1[2].toString() }, signed: adoptV1 });
  await shot("v1-adopt-confirmed");

  await buildReview("revoke");
  const revokeV1 = await signAll("v1-revoke");
  assert(revokeV1.map((entry) => entry.method).join() === "revokeOperator", `v1 revocation signed ${revokeV1.map((entry) => entry.method)}`);
  const afterV1 = await chain.readContract({ address: V1_ACCOUNT, abi: SentinelAccountAbi, functionName: "operators", args: [OPERATOR] });
  assert(Number(afterV1[0]) === 0 && afterV1[1] === 0n && afterV1[2] === 0n, `the v1 grant is not zero after revocation: ${afterV1}`);
  assert(Number(await chain.readContract({ address: V1_ACCOUNT, abi: SentinelAccountAbi, functionName: "autoRepayTriggerBps" })) === wanted, "per-operator revocation changed the account-wide trigger");
  steps.push({ label: "v1 revocation (this operator only; the trigger stays)", signed: revokeV1, grantAfter: afterV1.map(String) });
  await shot("v1-revoke-confirmed");

  /* ---------- restricted agent swap (v2): one setGrant, then revokeGrant ---------- */
  const [adapter, token0, token1] = await Promise.all(["swapAdapter", "token0", "token1"].map((functionName) => chain.readContract({ address: V2_ACCOUNT, abi: V2_ABI, functionName })));
  await open("restricted-swap-v2");
  await page.locator('[data-testid="strategy-param-percall"]').fill("0.25");
  await page.locator('[data-testid="strategy-param-budget"]').fill("0.75");
  await page.locator('[data-testid="strategy-param-expiry"]').selectOption("3600");
  const v2Hash = await page.locator('[data-testid="strategy-summary"]').getAttribute("data-hash");
  await buildReview("adopt");
  assert(same(await planAttr("data-account"), V2_ACCOUNT), "the plan is not for the owner's own v2 account");
  const adoptV2 = await signAll("v2-adopt");
  assert(adoptV2.map((entry) => entry.method).join() === "setGrant", `v2 adoption signed ${adoptV2.map((entry) => entry.method)}`);
  let grantV2 = null;
  let inputAsset = null;
  for (const token of [token0, token1]) {
    const grant = await chain.readContract({ address: V2_ACCOUNT, abi: V2_ABI, functionName: "grants", args: [OPERATOR, adapter, 5, token] });
    if (grant[2] !== 0n) [grantV2, inputAsset] = [grant, token];
  }
  assert(grantV2 && grantV2[0] === 250_000_000_000_000_000n && grantV2[1] === 750_000_000_000_000_000n, `v2 grant on chain is ${grantV2}`);
  steps.push({ label: "v2 adoption (restricted agent swap)", templateHash: v2Hash, account: V2_ACCOUNT, operator: OPERATOR, adapter, inputAsset, grant: grantV2.map(String), signed: adoptV2 });
  await shot("v2-adopt-confirmed");

  await buildReview("revoke");
  const revokeV2 = await signAll("v2-revoke");
  assert(revokeV2.map((entry) => entry.method).join() === "revokeGrant", `v2 revocation signed ${revokeV2.map((entry) => entry.method)}`);
  const afterV2 = await chain.readContract({ address: V2_ACCOUNT, abi: V2_ABI, functionName: "grants", args: [OPERATOR, adapter, 5, inputAsset] });
  assert(afterV2.every((value) => value === 0n), `the v2 grant is not zero after revocation: ${afterV2}`);
  steps.push({ label: "v2 revocation (this route only)", signed: revokeV2, grantAfter: afterV2.map(String) });
  await shot("v2-revoke-confirmed");
} catch (error) {
  failure = String(error?.message ?? error);
  await shot("zz-failure").catch(() => {});
}

const head = await chain.getBlock();
const file = `${OUT}/fork-strategy-${RUN_ID}.json`;
writeFileSync(
  file,
  `${JSON.stringify(
    {
      label: "PRIVATE FORK of X Layer testnet 1952 (loopback Anvil, auto-impersonation). Not public transactions: none of these hashes exists on the public chain, and none may be explorer-linked.",
      driver: "Playwright Chromium + injected test EIP-1193 provider forwarding to the fork; the owner is impersonated by the node; no private key",
      rpc: RPC,
      nodeClient: version,
      chainId: 1952,
      runId: RUN_ID,
      owner: OWNER,
      operator: OPERATOR,
      headAfter: { number: head.number.toString(), hash: head.hash },
      result: failure ? `FAILED: ${failure}` : "passed",
      steps,
      transactions: sent,
      pageProblems: problems,
    },
    null,
    2,
  )}\n`,
);
await browser.close();
console.log(`${failure ? `E2E FAILED: ${failure}\n` : "E2E passed. "}${sent.length} fork transactions, ${problems.length} page problem(s). Evidence: ${file}, screenshots: ${SHOTS}`);
process.exit(failure || problems.length ? 1 : 0);

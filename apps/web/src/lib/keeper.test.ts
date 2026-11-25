import assert from "node:assert/strict";
import { test } from "node:test";
import { type ScopeFacts, checkKeeperScope, groupKeeperItems, keeperRowView, parseKeeperItems, parseKeeperScope, parseKeeperStatus } from "./keeper.ts";

const A = (byte: string) => `0x${byte.repeat(20)}` as `0x${string}`;
const INSTANCE = "0x" + "b5".repeat(32);
const scopeJson = { schemaVersion: 1, environment: "anvil", instanceId: INSTANCE, chainId: 31337, factory: A("0d"), account: A("32"), operator: A("70") };
const facts: ScopeFacts = { target: "local", chainId: 31337, factory: A("0d"), nodeInstanceId: INSTANCE, accountFromFactory: true, operatorMask: 8 };
const scope = parseKeeperScope(scopeJson)!;

test("a matching scope passes with no problems and no warnings", () => {
  assert.deepEqual(checkKeeperScope(scope, facts), { ok: true, problems: [], warnings: [] });
});

test("each mismatch withholds the rows, with its own reason", () => {
  const cases: Array<[string, Partial<typeof scopeJson>, Partial<ScopeFacts>, RegExp]> = [
    ["chain", { chainId: 1952 }, {}, /chain 1952; this app targets chain 31337/],
    ["factory", { factory: A("ee") }, {}, /factory is not the one in this deployment's manifest/],
    ["instance", { instanceId: "0x" + "aa".repeat(32) }, {}, /different local node instance/],
    ["instance missing", { instanceId: null as unknown as string }, {}, /did not report a local node instance/],
    ["node instance unreadable", {}, { nodeInstanceId: null }, /instance id could not be read/],
    ["environment", { environment: "xlayer-testnet" }, {}, /not a local chain/],
    ["account not from factory", {}, { accountFromFactory: false }, /not a Sentinel account created by this deployment's factory/],
    ["account unverifiable", {}, { accountFromFactory: null }, /could not be verified on chain/],
  ];
  for (const [name, scopeChange, factChange, reason] of cases) {
    const parsed = parseKeeperScope({ ...scopeJson, ...scopeChange });
    assert.ok(parsed, name);
    const check = checkKeeperScope(parsed, { ...facts, ...factChange });
    assert.equal(check.ok, false, name);
    assert.ok(check.problems.some((problem) => reason.test(problem)), `${name}: ${check.problems.join(" / ")}`);
  }
});

test("on testnet the environment must be xlayer-testnet and no local instance may be reported", () => {
  const testnetFacts: ScopeFacts = { ...facts, target: "testnet", chainId: 1952, nodeInstanceId: null };
  const good = parseKeeperScope({ ...scopeJson, chainId: 1952, environment: "xlayer-testnet", instanceId: null })!;
  assert.equal(checkKeeperScope(good, testnetFacts).ok, true);
  assert.match(checkKeeperScope(parseKeeperScope({ ...scopeJson, chainId: 1952 })!, testnetFacts).problems.join(" "), /not X Layer testnet.*local node instance on a public network/);
});

test("an operator without a repay grant is a warning, not a reason to hide history", () => {
  for (const operatorMask of [0, 4]) {
    const check = checkKeeperScope(scope, { ...facts, operatorMask });
    assert.equal(check.ok, true);
    assert.match(check.warnings[0]!, /no repay permission/);
  }
});

test("malformed scopes are rejected outright", () => {
  for (const bad of [null, {}, { ...scopeJson, schemaVersion: 2 }, { ...scopeJson, account: "0x1234" }, { ...scopeJson, environment: "mainnet" }, { ...scopeJson, chainId: "31337" }, { ...scopeJson, instanceId: "abc" }]) {
    assert.equal(parseKeeperScope(bad), null);
  }
});

test("items are whitelisted: unknown fields are dropped and malformed values never pass through", () => {
  const parsed = parseKeeperItems({
    items: [
      { at: "2026-11-25T14:53:35.983Z", state: "simulated", amount: "20000000", trigger: 4500, ltv: "5000", fee: "317143462634038", privateKey: "0xdead", html: "<script>" },
      { at: "2026-11-25T14:53:20.000Z", state: "success", hash: "0x" + "ab".repeat(32), block: "70", gas: "123456", outcomes: [{ operator: A("70"), amount: "20000000", ltvBeforeBps: "5000", ltvAfterBps: "3750" }, { operator: "nope" }] },
      { at: "2026-11-25T14:53:10.000Z", state: "simulation-failed", reason: "TriggerNotMet", amount: "-5", hash: "0x12" },
      { at: "yesterday", state: "simulated" },
      { at: "2026-11-25T14:53:00.000Z", state: "<img src=x>" },
      "garbage",
    ],
    truncated: true,
  })!;
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(Object.keys(parsed.items[0]!).sort(), ["amount", "at", "balance", "block", "fee", "gas", "hash", "ltv", "outcomes", "reason", "state", "trigger"]);
  assert.equal((parsed.items[0] as unknown as Record<string, unknown>).privateKey, undefined);
  assert.equal(parsed.items[1]!.outcomes!.length, 1);
  assert.equal(parsed.items[2]!.amount, undefined);
  assert.equal(parsed.items[2]!.hash, undefined);
  assert.equal(parseKeeperItems({ items: "no" }), null);
});

test("every documented state has a distinct presentation, and off-chain states say nothing was sent", () => {
  const at = "2026-11-25T14:53:35.983Z";
  const views = Object.fromEntries(["disabled", "simulated", "simulation-failed", "gas-budget", "another-transaction-pending", "awaiting-confirmation", "submitted", "success", "reverted", "tick-failed"].map((state) => [state, keeperRowView({ at, state, reason: "TriggerNotMet" })]));
  assert.equal(new Set(Object.values(views).map((view) => view.label)).size, 10);
  for (const state of ["simulated", "simulation-failed", "gas-budget", "disabled", "tick-failed"]) {
    assert.equal(views[state]!.sent, false, state);
    assert.equal(views[state]!.mined, false, state);
  }
  assert.match(views.simulated!.label, /not sent/);
  assert.match(views["simulation-failed"]!.label, /not sent/);
  assert.match(views["simulation-failed"]!.summary, /TriggerNotMet/);
  assert.deepEqual([views.submitted!.sent, views.submitted!.mined], [true, false]);
  assert.deepEqual([views.success!.sent, views.success!.mined, views.success!.tone], [true, true, "success"]);
  assert.deepEqual([views.reverted!.mined, views.reverted!.tone], [true, "danger"]);
  assert.match(keeperRowView({ at, state: "brand-new" }).label, /Unrecognised state "brand-new"/);
});

test("identical consecutive off-chain rows collapse; rows with a hash never do", () => {
  const row = (at: string, extra = {}) => ({ at, state: "simulated", amount: "20000000", trigger: 4500, ltv: "5000", ...extra });
  const hash = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const groups = groupKeeperItems([row("2026-11-25T14:53:35.000Z"), row("2026-11-25T14:53:20.000Z"), row("2026-11-25T14:53:05.000Z"), { at: "2026-11-25T14:52:50.000Z", state: "success", hash }, { at: "2026-11-25T14:52:49.000Z", state: "success", hash }, row("2026-11-25T14:52:30.000Z", { ltv: "4900" })]);
  assert.deepEqual(groups.map((group) => [group.item.state, group.count]), [["simulated", 3], ["success", 1], ["success", 1], ["simulated", 1]]);
  assert.equal(groups[0]!.since, "2026-11-25T14:53:05.000Z");
  assert.equal(groups[0]!.item.at, "2026-11-25T14:53:35.000Z");
});

test("status keeps only known fields", () => {
  const status = parseKeeperStatus({ execute: false, intervalMs: 15000, phase: "waiting", cycles: 20, startedAt: "2026-11-25T14:48:50.321Z", lastAt: "2026-11-25T14:53:35.985Z", lastOutcome: "simulated", nextAt: "bad", secret: "x" })!;
  assert.deepEqual(status, { execute: false, intervalMs: 15000, phase: "waiting", cycles: 20, startedAt: "2026-11-25T14:48:50.321Z", lastAt: "2026-11-25T14:53:35.985Z", lastOutcome: "simulated", nextAt: null });
  assert.equal(parseKeeperStatus({ phase: "waiting" }), null);
});

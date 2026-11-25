import assert from "node:assert/strict";
import { test } from "node:test";
import { STUDIO_MARKET_ROOT } from "../lib/policy.ts";
import { CHAIN_IMPL_READY, resolveRuntime } from "./runtime.ts";

type Raw = Parameters<typeof resolveRuntime>[0];

const A = "0x" + "ab".repeat(20);
/** A synthetic 1952 manifest that passes every static check. No such deployment exists yet. */
const deployed = {
  schemaVersion: 1, abiVersion: "v1", chainId: 1952, profile: "testnet", status: "deployed", commit: "abc1234",
  capabilities: { studioMarketTemplateRoot: STUDIO_MARKET_ROOT, policyAllowedEvents: true },
  deploymentBlock: "47000000",
  contracts: { MarketFactory: A, PolicyRegistry: A, TapeOutPolicyAdapter: A, SentinelAccountFactory: A },
  markets: [], tapeout: { mode: "development-reference", processor: A, circuits: [] }, mocks: [],
};
const notReady = { market: false, account: false, policy: false, activity: false };
const allReady = { market: true, account: true, policy: true, activity: true };
const testnet = { chainId: 1952, forceFixture: false };
const raw1952 = (json: unknown): Raw => ({ "1952": { ok: true, json } });

test("no manifest, not-deployed manifest and bad manifest all resolve to fixture with a reason", () => {
  const cases: Raw[] = [{}, raw1952({ ...deployed, status: "not-deployed", commit: null, contracts: {} }), raw1952({ ...deployed, chainId: 196 })];
  for (const raw of cases) {
    const runtime = resolveRuntime(raw, allReady, testnet);
    assert.equal(runtime.fixture, true);
    assert.ok(runtime.fixtureReason.length > 0);
    assert.ok(Object.values(runtime.modes).every((mode) => mode.source === "fixture"));
  }
});

test("a deployed manifest alone does not switch a service: its chain implementation must also be ready", () => {
  const none = resolveRuntime(raw1952(deployed), notReady, testnet);
  assert.equal(none.manifest.state, "deployed");
  assert.ok(Object.values(none.modes).every((mode) => mode.source === "fixture"));
  const partial = resolveRuntime(raw1952(deployed), { ...notReady, market: true }, testnet);
  assert.equal(partial.modes.market.source, "chain");
  assert.equal(partial.modes.account.source, "fixture");
  assert.equal(partial.fixture, true, "banner stays while any service is still on example data");
  const all = resolveRuntime(raw1952(deployed), allReady, testnet);
  assert.equal(all.fixture, false);
  assert.deepEqual(all.live, { ok: true });
});

test("the shipped testnet readiness map takes a verified 1952 manifest live, and only a verified one", () => {
  assert.equal(resolveRuntime(raw1952(deployed), CHAIN_IMPL_READY.testnet, testnet).fixture, false);
  const tampered: Array<[string, unknown, RegExp]> = [
    ["template root differs from the compiler", { ...deployed, capabilities: { ...deployed.capabilities, studioMarketTemplateRoot: "0x" + "11".repeat(32) } }, /template root differs/],
    ["no template root", { ...deployed, capabilities: { policyAllowedEvents: true } }, /studioMarketTemplateRoot is not published/],
    ["a required contract is missing", { ...deployed, contracts: { MarketFactory: A, TapeOutPolicyAdapter: A, SentinelAccountFactory: A } }, /required contract address missing: PolicyRegistry/],
    ["a contract is the zero address", { ...deployed, contracts: { ...deployed.contracts, MarketFactory: "0x" + "00".repeat(20) } }, /zero address/],
    ["no deployment block", { ...deployed, deploymentBlock: undefined }, /deploymentBlock is missing/],
    ["no processor", { ...deployed, tapeout: { mode: "unavailable", processor: null, circuits: [] } }, /no policy processor/],
  ];
  for (const [name, json, reason] of tampered) {
    const runtime = resolveRuntime(raw1952(json), CHAIN_IMPL_READY.testnet, testnet);
    assert.equal(runtime.fixture, true, name);
    assert.ok(Object.values(runtime.modes).every((mode) => mode.source === "fixture"), name);
    assert.match(runtime.fixtureReason, /rejected for live use/, name);
    assert.match(runtime.fixtureReason, reason, name);
  }
});

test("the fixture override wins over a verified manifest", () => {
  const runtime = resolveRuntime(raw1952(deployed), allReady, { chainId: 1952, forceFixture: true });
  assert.equal(runtime.fixture, true);
  assert.match(runtime.fixtureReason, /pinned to example data/);
});

test("targets are independent: a deployed local manifest does not take the testnet target live", () => {
  const local = { ...deployed, chainId: 31337, profile: "local" };
  const raw: Raw = { "31337": { ok: true, json: local }, "1952": { ok: true, json: { ...deployed, status: "not-deployed", commit: null, contracts: {} } } };
  assert.equal(resolveRuntime(raw, allReady, { chainId: 31337, forceFixture: false }).fixture, false);
  assert.equal(resolveRuntime(raw, allReady, testnet).fixture, true);
});

test("a mainnet manifest can never enable chain mode", () => {
  const runtime = resolveRuntime({ "196": { ok: true as const, json: { ...deployed, chainId: 196, profile: "read-only" } } }, allReady, { chainId: 196, forceFixture: false });
  assert.equal(runtime.fixture, true);
});

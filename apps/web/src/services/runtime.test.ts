import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRuntime } from "./runtime.ts";

type Raw = Parameters<typeof resolveRuntime>[0];

const A = "0x" + "ab".repeat(20);
const deployed = {
  schemaVersion: 1, abiVersion: "v1", chainId: 1952, profile: "testnet", status: "deployed", commit: "abc1234",
  contracts: { MarketFactory: A }, markets: [], tapeout: { mode: "unavailable", processor: null, circuits: [] }, mocks: [],
};
const notReady = { market: false, account: false, policy: false, activity: false };

test("no manifest, not-deployed manifest and bad manifest all resolve to fixture with a reason", () => {
  const cases: Raw[] = [{}, { "1952": { ok: true, json: { ...deployed, status: "not-deployed", commit: null, contracts: {} } } }, { "1952": { ok: true, json: { ...deployed, chainId: 196 } } }];
  for (const raw of cases) {
    const runtime = resolveRuntime(raw, notReady);
    assert.equal(runtime.fixture, true);
    assert.ok(runtime.fixtureReason.length > 0);
    assert.ok(Object.values(runtime.modes).every((mode) => mode.source === "fixture"));
  }
});

test("a deployed manifest alone does not switch a service: its chain implementation must also be ready", () => {
  const raw: Raw = { "1952": { ok: true, json: deployed } };
  const none = resolveRuntime(raw, notReady);
  assert.equal(none.manifest.state, "deployed");
  assert.ok(Object.values(none.modes).every((mode) => mode.source === "fixture"));
  const partial = resolveRuntime(raw, { ...notReady, market: true });
  assert.equal(partial.modes.market.source, "chain");
  assert.equal(partial.modes.account.source, "fixture");
  assert.equal(partial.fixture, true, "banner stays while any service is still on example data");
  const all = resolveRuntime(raw, { market: true, account: true, policy: true, activity: true });
  assert.equal(all.fixture, false);
});

test("a mainnet manifest can never enable chain mode", () => {
  const runtime = resolveRuntime({ "196": { ok: true as const, json: { ...deployed, chainId: 196, profile: "read-only" } } }, { market: true, account: true, policy: true, activity: true });
  assert.equal(runtime.fixture, true);
});

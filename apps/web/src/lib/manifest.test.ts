import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveManifest } from "./manifest.ts";

const base = {
  schemaVersion: 1,
  abiVersion: "v1",
  chainId: 1952,
  profile: "testnet",
  status: "not-deployed",
  commit: null,
  contracts: {},
  markets: [],
  tapeout: { mode: "unavailable", processor: null, circuits: [] },
  mocks: [],
};
const A = "0x" + "ab".repeat(20);

test("absent and unreadable manifests", () => {
  assert.equal(resolveManifest(1952, undefined).state, "absent");
  assert.equal(resolveManifest(1952, { ok: false, error: "Invalid JSON" }).state, "invalid");
});

test("not-deployed manifest is valid but never enables chain mode", () => {
  assert.equal(resolveManifest(1952, { ok: true, json: base }).state, "not-deployed");
});

test("deployed manifest needs contracts and a commit", () => {
  const deployed = { ...base, status: "deployed", commit: "abc1234", contracts: { MarketFactory: A } };
  assert.equal(resolveManifest(1952, { ok: true, json: deployed }).state, "deployed");
  assert.equal(resolveManifest(1952, { ok: true, json: { ...deployed, contracts: {} } }).state, "invalid");
  assert.equal(resolveManifest(1952, { ok: true, json: { ...deployed, commit: null } }).state, "invalid");
  assert.equal(resolveManifest(1952, { ok: true, json: { ...deployed, contracts: { MarketFactory: "0x123" } } }).state, "invalid");
});

test("mismatches fall back with a reason", () => {
  const cases: Array<Record<string, unknown>> = [
    { ...base, chainId: 196 },
    { ...base, schemaVersion: 2 },
    { ...base, abiVersion: "v2" },
    { ...base, profile: "local" }, // a local profile must never be accepted for chain 1952
    { ...base, status: "live" },
    { ...base, tapeout: { mode: "unavailable", processor: "nope", circuits: [] } },
    { ...base, tapeout: { mode: "tapeout-for-real", processor: null, circuits: [] } },
    { ...base, tapeout: { mode: "unavailable", processor: null, circuits: [{ kind: "MARKET", circuitId: "1" }] } },
  ];
  for (const json of cases) {
    const result = resolveManifest(1952, { ok: true, json });
    assert.equal(result.state, "invalid", JSON.stringify(json));
    assert.ok("reason" in result && result.reason.length > 0);
  }
  // testnet manifest copied into mainnet slot is rejected
  assert.equal(resolveManifest(196, { ok: true, json: { ...base, chainId: 196 } }).state, "invalid");
  // read-only mainnet can never be "deployed" for writes
  assert.equal(
    resolveManifest(196, { ok: true, json: { ...base, chainId: 196, profile: "read-only", status: "deployed", commit: "x", contracts: { A } } }).state,
    "invalid",
  );
});

test("local profile may be deployed from a dirty tree only with provenance", () => {
  const local = { ...base, chainId: 31337, profile: "local", status: "deployed", contracts: { MarketFactory: A } };
  assert.equal(resolveManifest(31337, { ok: true, json: local }).state, "invalid");
  const withProvenance = { ...local, provenance: { baseCommit: "abc", sourceDigest: "0x01", sourcesDirty: true } };
  assert.equal(resolveManifest(31337, { ok: true, json: withProvenance }).state, "deployed");
  // the same relaxation never applies to testnet
  assert.equal(resolveManifest(1952, { ok: true, json: { ...withProvenance, chainId: 1952, profile: "testnet" } }).state, "invalid");
});

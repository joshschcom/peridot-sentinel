import assert from "node:assert/strict";
import { test } from "node:test";
import { EVIDENCE } from "./evidence.ts";

// These assertions run against the evidence files currently in the repo (synced by scripts/sync-manifests.mjs).
test("public mainnet sample parses and every vector matches its reference", { skip: EVIDENCE.publicSample.status !== "ok" }, () => {
  if (EVIDENCE.publicSample.status !== "ok") return;
  const sample = EVIDENCE.publicSample.value;
  assert.equal(sample.chainId, 196);
  assert.ok(sample.vectors.length >= 4);
  assert.ok(sample.vectors.every((vector) => vector.matches));
});

test("fork settlement: both circuits saw the same context and allowed", { skip: EVIDENCE.forkSettlement.status !== "ok" }, () => {
  if (EVIDENCE.forkSettlement.status !== "ok") return;
  const settlement = EVIDENCE.forkSettlement.value;
  assert.equal(new Set(settlement.evaluations.map((evaluation) => evaluation.context)).size, 1);
  assert.ok(settlement.evaluations.every((evaluation) => evaluation.allow === true));
  assert.notEqual(settlement.accountDenial.selector, settlement.marketDenial.selector);
});

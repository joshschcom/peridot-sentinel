import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Op, STUDIO_MARKET_ROOT, accountPolicySpec, checkTemplateRoots, compileSpec, evaluateLocally, marketPolicySpec, opMask, studioTemplate } from "./policy.ts";
import { ok, unavailable } from "./maybe.ts";

test("wrapper reproduces Astra's published fixture policies and vectors", () => {
  const fixtures = JSON.parse(readFileSync(new URL("../../../../packages/circuit-sdk/fixtures/policies-v1.json", import.meta.url), "utf8"));
  const specs = [marketPolicySpec(6500, true), accountPolicySpec(5500, [Op.BORROW, Op.SUPPLY, Op.EXIT_COLLATERAL, Op.REDEEM])];
  for (const [index, spec] of specs.entries()) {
    const compiled = compileSpec(spec);
    assert.equal(compiled.status, "ok");
    if (compiled.status !== "ok") return;
    const expected = fixtures.policies[index];
    assert.equal(compiled.value.configHash, expected.configHash);
    assert.equal(compiled.value.netlistHash, expected.netlistHash);
    assert.equal(compiled.value.gateCount, expected.gateCount);
    for (const vector of expected.vectors) {
      const result = evaluateLocally(compiled.value, vector.context);
      assert.equal(result.status, "ok");
      if (result.status === "ok") {
        assert.equal(result.value.inputs, vector.inputs);
        assert.equal(result.value.output, vector.output);
      }
    }
  }
});

test("INTERFACES v1 example context and fail-closed encoding", () => {
  const compiled = compileSpec(marketPolicySpec(6500, true));
  assert.equal(compiled.status, "ok");
  if (compiled.status !== "ok") return;
  const result = evaluateLocally(compiled.value, { op: Op.BORROW, oracleFresh: true, postLtvBps: 5000, cashOk: true });
  assert.equal(result.status === "ok" && result.value.inputs, "0x12710a");
  // Above 10000 bps cannot be encoded: unavailable, not "deny".
  assert.equal(evaluateLocally(compiled.value, { op: Op.BORROW, oracleFresh: true, postLtvBps: 10001, cashOk: true }).status, "unavailable");
  assert.equal(compileSpec(marketPolicySpec(10001, true)).status, "unavailable");
  assert.equal(opMask([Op.SUPPLY, Op.BORROW, Op.TRANSFER]), 0b1000000101);
});

test("v1.2 Studio template: proof, and creation gated on all three roots being equal", () => {
  const template = studioTemplate(6500, true);
  assert.equal(template.status, "ok");
  if (template.status === "ok") {
    assert.equal(template.value.proof.length, 15);
    const direct = compileSpec(marketPolicySpec(6500, true));
    assert.equal(direct.status === "ok" && direct.value.configHash, template.value.compiled.configHash);
  }
  assert.equal(studioTemplate(10001, true).status, "unavailable");
  const other = "0x" + "11".repeat(32);
  assert.equal(checkTemplateRoots(ok(STUDIO_MARKET_ROOT), ok(STUDIO_MARKET_ROOT.toUpperCase().replace("0X", "0x"))).status, "match");
  assert.equal(checkTemplateRoots(unavailable("absent"), ok(STUDIO_MARKET_ROOT)).status, "unverifiable");
  assert.equal(checkTemplateRoots(ok(STUDIO_MARKET_ROOT), unavailable("no rpc")).status, "unverifiable");
  assert.equal(checkTemplateRoots(ok(other), ok(STUDIO_MARKET_ROOT)).status, "mismatch");
  assert.equal(checkTemplateRoots(ok(STUDIO_MARKET_ROOT), ok(other)).status, "mismatch");
});

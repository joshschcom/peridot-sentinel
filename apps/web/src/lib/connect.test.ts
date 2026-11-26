import assert from "node:assert/strict";
import { test } from "node:test";
import { RAW_EVIDENCE } from "../generated/evidence.ts";
import { CONNECT, connectVerified, grantReadiness, parseConnectQuote, parseConnectTools, parseConnectTranscript, parseLlmSession } from "./connect.ts";

// These run against the evidence files in the repo (synced by scripts/sync-manifests.mjs), not against copies.
test("tool catalogue: twelve tools, exactly one can send a transaction", () => {
  assert.equal(CONNECT.tools.status, "ok");
  if (CONNECT.tools.status !== "ok") return;
  const { tools, server } = CONNECT.tools.value;
  assert.equal(server, "sentinel-connect");
  assert.equal(tools.length, 12);
  assert.deepEqual(tools.filter((tool) => tool.kind === "execute").map((tool) => tool.name), ["sentinel_execute_auto_repay"]);
  assert.deepEqual(tools.filter((tool) => tool.kind === "proposal").map((tool) => tool.name), ["sentinel_propose_auto_repay"]);
  assert.equal(tools.filter((tool) => tool.kind === "read").length, 10);
  // No tool takes an address, calldata, recipient or amount for the execute path.
  assert.deepEqual(tools.find((tool) => tool.kind === "execute")!.inputs, ["proposalId"]);
  assert.ok(!tools.some((tool) => /withdraw|operator_set|set_policy|revoke|calldata/i.test(tool.name)));
});

test("recorded run: the public execute, the rejected borrow and the unavailable quote", () => {
  assert.equal(CONNECT.transcript.status, "ok");
  if (CONNECT.transcript.status !== "ok") return;
  const run = CONNECT.transcript.value;
  assert.equal(run.chainId, 1952);
  assert.equal(run.step5.hash, "0xc5daaf3401cde7a7b1e8f93c97290f8d9711825ba871097af074304340569b0f");
  assert.equal(run.step5.block.number, "47246674");
  assert.equal(run.step5.amountRaw, 2_000_000n);
  assert.equal(run.debt.decimals, 6);
  assert.equal(run.step5.ltvBeforeBps, 5001);
  assert.equal(run.step5.ltvAfterBps, 4876);
  assert.equal(run.step5.grantBeforeRaw, 2_000_000n);
  assert.equal(run.step5.grantAfterRaw, 0n);
  assert.equal(run.step5.valueWei, "0");
  assert.equal(run.step5.from.toLowerCase(), run.operator.toLowerCase());
  assert.equal(run.step5.to.toLowerCase(), run.account.toLowerCase());
  assert.equal(run.step2.grant.opMask, 8);
  assert.equal(run.step2.grant.repayOnly, true);
  // Step 3: no credentials, so no quote and no number.
  assert.equal(run.step3.quote, null);
  assert.equal(run.step3.code, "OKX_CREDENTIALS_UNAVAILABLE");
  // Step 6: a simulation, rejected by the contract.
  assert.equal(run.step6.method, "eth_call");
  assert.equal(run.step6.rejected, true);
  assert.equal(run.step6.error, "OperatorNotAuthorized");
  assert.equal(run.step7.grant.remainingRaw, 0n);
  assert.equal(connectVerified(), true);
});

test("a transcript that is not a confirmed 1952 execute is rejected, never shown", () => {
  const json = structuredClone(RAW_EVIDENCE.connectTranscript.json) as { chainId: number; steps: Record<string, Record<string, unknown>> };
  const file = RAW_EVIDENCE.connectTranscript.file;
  assert.equal(parseConnectTranscript({ ...json, chainId: 196 }, file).status, "unavailable");
  const reverted = structuredClone(json);
  (reverted.steps["5"]!.receipt as Record<string, unknown>).status = "reverted";
  assert.equal(parseConnectTranscript(reverted, file).status, "unavailable");
  const otherSender = structuredClone(json);
  (otherSender.steps["5"]!.receipt as Record<string, unknown>).from = "0x0000000000000000000000000000000000000001";
  assert.equal(parseConnectTranscript(otherSender, file).status, "unavailable");
  const otherHash = structuredClone(json);
  ((otherHash.steps["7"]!.transaction as Record<string, unknown>).receipt as Record<string, unknown>).hash = `0x${"11".repeat(32)}`;
  assert.equal(parseConnectTranscript(otherHash, file).status, "unavailable");
  assert.equal(parseConnectTranscript(null, file).status, "unavailable");
  assert.equal(parseConnectTranscript(json, null).status, "unavailable");
});

test("Connect is not advertised without both the catalogue and the run", () => {
  assert.equal(connectVerified(parseConnectTools(null), CONNECT.transcript), false);
  assert.equal(connectVerified(CONNECT.tools, parseConnectTranscript(null, null)), false);
  const twoExecutes = structuredClone(RAW_EVIDENCE.connectTools.json) as { tools: Array<{ annotations: { destructiveHint: boolean } }> };
  twoExecutes.tools[0]!.annotations.destructiveHint = true;
  assert.equal(connectVerified(parseConnectTools(twoExecutes), CONNECT.transcript), false);
});

test("grant readiness: spent, expired, revoked and wider-than-repay are all 'cannot execute now'", () => {
  const repayBit = 3;
  assert.equal(grantReadiness({ opsMask: 8, remaining: 2_000_000n, expiry: 200n }, 100n, repayBit), "ready");
  assert.equal(grantReadiness({ opsMask: 8, remaining: 0n, expiry: 200n }, 100n, repayBit), "spent");
  assert.equal(grantReadiness({ opsMask: 8, remaining: 2_000_000n, expiry: 100n }, 100n, repayBit), "expired");
  assert.equal(grantReadiness({ opsMask: 0, remaining: 0n, expiry: 0n }, 100n, repayBit), "revoked");
  assert.equal(grantReadiness({ opsMask: 12, remaining: 1n, expiry: 200n }, 100n, repayBit), "not-repay-only");
});

test("a quote is shown only when it is a complete OKX quote for the served pair on chain 196", () => {
  // The shape services/onchainos/quote.mjs returns. The amounts here are placeholders for the parser, not a price.
  const shape = { source: "OKX OnchainOS", chainId: 196, tokenIn: "0xb6ceceab302e2e4948951ee7843fc24e92933061", amountIn: "1000000", tokenOut: "0xe538905cf8410324e03a5a23c1c177a474d59b2b", amountOut: "1", observedAt: "2026-11-26T12:00:00.000Z" };
  const parsed = parseConnectQuote(shape);
  assert.ok(parsed);
  assert.equal(parsed.tokenIn.symbol, "USDC");
  assert.equal(parsed.tokenOut.symbol, "WOKB");
  assert.equal(parsed.amountInRaw, 1_000_000n);
  assert.equal(parseConnectQuote(null), null);
  assert.equal(parseConnectQuote({ ...shape, source: "Mock" }), null);
  assert.equal(parseConnectQuote({ ...shape, chainId: 1952 }), null);
  assert.equal(parseConnectQuote({ ...shape, tokenOut: "0x0000000000000000000000000000000000000001" }), null);
  assert.equal(parseConnectQuote({ ...shape, amountOut: "0" }), null);
  assert.equal(parseConnectQuote({ ...shape, observedAt: undefined }), null);
  // A record that says "blocked" never yields a quote, even if a quote object is attached.
  const json = structuredClone(RAW_EVIDENCE.connectTranscript.json) as { steps: Record<string, Record<string, unknown>> };
  json.steps["3"]!.quote = shape;
  const blocked = parseConnectTranscript(json, RAW_EVIDENCE.connectTranscript.file);
  assert.equal(blocked.status === "ok" ? blocked.value.step3.quote : "x", null);
});

test("LLM-directed session: the model's swap, the simulated denial, the mined revert, and deltas that add up", () => {
  assert.equal(CONNECT.llm.status, "ok");
  if (CONNECT.llm.status !== "ok") return;
  const session = CONNECT.llm.value;
  assert.equal(session.model, "claude-opus-5-5");
  assert.equal(session.swap.hash, "0x54d49999e12e1dd0eb6247c54cf76cfec0ec3945e7f2b6c96e994768d5dcb79f");
  assert.equal(session.swap.block, "47250026");
  assert.equal(session.chosen.amountInRaw, 500_000_000_000_000_000n);
  assert.equal(session.chosen.minOutRaw, 39_900_000n);
  assert.equal(session.swap.gainedRaw, 39_980_000n);
  assert.equal(session.swap.grantBeforeRaw - session.swap.grantAfterRaw, 500_000_000_000_000_000n);
  assert.equal(session.swap.deltasMatch, true);
  assert.equal(session.rejection.mined.hash, "0xb50d45edea461c9f6d50e45e28f2faa9ffde4971f02f31909e591b5b1922f7f7");
  assert.equal(session.rejection.simulatedError, "OperatorNotAuthorized");
  assert.equal(session.rejection.minedError, "OperatorNotAuthorized");
  assert.equal(session.rejection.statePreserved, true);
  assert.equal(session.quote, null);
  assert.equal(session.quoteReason, "OKX_CREDENTIALS_UNAVAILABLE");
  assert.ok(session.transcript && session.transcript.result.length > 200);
  // Not the operator's transaction, not a revert, or another chain: no session is shown.
  const json = structuredClone(RAW_EVIDENCE.llmSession.json) as { chainId: number; swap: { receipt: Record<string, unknown> }; rejection: { receipt: Record<string, unknown> } };
  const file = RAW_EVIDENCE.llmSession.file;
  assert.equal(parseLlmSession({ ...json, chainId: 196 }, file).status, "unavailable");
  const other = structuredClone(json);
  other.swap.receipt.from = "0x8c1741a53d5fb97d74c1d105b0fbfbb4740d5d67";
  assert.equal(parseLlmSession(other, file).status, "unavailable");
  const notReverted = structuredClone(json);
  notReverted.rejection.receipt.status = "success";
  assert.equal(parseLlmSession(notReverted, file).status, "unavailable");
});

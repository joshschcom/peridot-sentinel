import assert from "node:assert/strict";
import { test } from "node:test";
import { Op } from "../../lib/policy.ts";
import type { OperationRequest } from "../types.ts";
import { ACCOUNT_POLICY, DIRECT_POSITIONS, MARKETS, SENTINEL_ACCOUNTS } from "./data.ts";
import { simulateOperation } from "./preview.ts";

const market = MARKETS[0]!;
const sentinel = SENTINEL_ACCOUNTS[0]!.position;
const direct = DIRECT_POSITIONS[0]!;
const usdc = (n: bigint) => n * 1_000_000n;
const borrow = (path: "sentinel" | "direct", amount: bigint): OperationRequest => ({ marketId: market.id, path, op: Op.BORROW, leg: "debt", amount });
const run = (request: OperationRequest) => simulateOperation(market, request.path === "sentinel" ? sentinel : direct, request.path === "sentinel" ? ACCOUNT_POLICY : null, request);

test("example account starts at 30% LTV", () => {
  const preview = run(borrow("sentinel", usdc(1n)));
  assert.deepEqual(preview.ltvBeforeBps, { status: "ok", value: 3000 });
});

test("allowed: within both policies (55% account cap, 65% market cap)", () => {
  const preview = run(borrow("sentinel", usdc(1_250n))); // 2750 / 5000 = 55.00%
  assert.equal(preview.outcome.status, "allowed");
  assert.deepEqual(preview.ltvAfterBps, { status: "ok", value: 5500 });
  assert.ok(preview.checks.every((check) => check.status === "pass"));
});

test("SENTINEL rejection: account cap exceeded while market policy would allow", () => {
  const preview = run(borrow("sentinel", usdc(1_251n)));
  assert.equal(preview.outcome.status === "rejected" && preview.outcome.by, "account-policy");
  assert.equal(preview.outcome.status === "rejected" && preview.outcome.error.name, "AccountPolicyRejected");
  const marketCheck = preview.checks.find((check) => check.id === "market-policy");
  assert.equal(marketCheck?.status, "pass");
  assert.equal(preview.checks.find((check) => check.id === "account-policy")?.decisive, true);
});

test("MARKET rejection: direct path has no account policy, market cap 65% decides", () => {
  // direct position: 1 tWETH ($2,000) collateral, 400 debt. 1,300 debt = 65% ok, 1,301 = 65.05% -> ceil 6505 deny
  assert.equal(run(borrow("direct", usdc(900n))).outcome.status, "allowed");
  const preview = run(borrow("direct", usdc(901n)));
  assert.equal(preview.outcome.status === "rejected" && preview.outcome.by, "market-policy");
  assert.equal(preview.checks.some((check) => check.id === "account-policy"), false);
});

test("protocol limit decides above the borrowing limit, before the market circuit", () => {
  const preview = run(borrow("direct", usdc(1_001n))); // 1401 / 2000 > 70%
  assert.equal(preview.outcome.status === "rejected" && preview.outcome.by, "protocol");
  assert.equal(preview.outcome.status === "rejected" && preview.outcome.error.name, "InsufficientLiquidity");
});

test("repay is never gated and never rejected by a policy", () => {
  const preview = run({ marketId: market.id, path: "sentinel", op: Op.REPAY, leg: "debt", amount: usdc(400n) });
  assert.equal(preview.applies, false);
  assert.equal(preview.outcome.status, "allowed");
  assert.equal(preview.checks.find((check) => check.id === "account-policy")?.status, "not-applicable");
  assert.equal(preview.checks.find((check) => check.id === "market-policy")?.status, "not-applicable");
  assert.equal(preview.context.status, "unavailable");
});

test("withdrawing collateral with debt is gated; disallowed op is an account rejection", () => {
  const redeem = run({ marketId: market.id, path: "sentinel", op: Op.REDEEM, leg: "collateral", amount: 2n * 10n ** 18n });
  assert.equal(redeem.applies, true); // 1500 / 1000 = 150% -> cannot be encoded
  assert.equal(redeem.outcome.status === "rejected" && redeem.outcome.error.name, "InvalidContext");
  const transfer = run({ marketId: market.id, path: "sentinel", op: Op.TRANSFER, leg: "collateral", amount: 10n ** 17n });
  assert.equal(transfer.outcome.status === "rejected" && transfer.outcome.by, "account-policy");
});

test("insufficient funds is reported before any policy", () => {
  const preview = run({ marketId: market.id, path: "sentinel", op: Op.REPAY, leg: "debt", amount: usdc(401n) });
  assert.equal(preview.outcome.status === "rejected" && preview.outcome.by, "balance");
});

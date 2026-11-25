/**
 * Local mirror of the on-chain decision order, used ONLY in fixture mode:
 *   Sentinel path: account policy -> market lifecycle/caps -> oracle -> borrowing limit/cash -> market policy
 *   Direct path:                     market lifecycle/caps -> oracle -> borrowing limit/cash -> market policy
 * (contracts/src/sentinel/SentinelAccount.sol `_checkAccountPolicy`, contracts/src/markets/IsolatedController.sol
 * `previewPolicy` / `_check`). Circuit decisions come from the compiled netlist run through the SDK reference
 * evaluator. The chain implementation replaces this with controller.previewPolicy + eth_call as the actual sender.
 */
import { formatAmount, formatBps, ltvBps, usdValueE18 } from "../../lib/amount.ts";
import type { RawError } from "../../lib/errors.ts";
import { type Maybe, ok, unavailable } from "../../lib/maybe.ts";
import { LOCAL_PREVIEW_LABEL, Op, OP_LABEL, evaluateLocally, type OpId, type PolicyContextInput } from "../../lib/policy.ts";
import type { CheckResult, Market, OperationPreview, OperationRequest, PolicyRecord, Position, RejectionSource } from "../types.ts";

const FIXTURE_POLICY_ID = "policyId unavailable in fixture mode";

export function simulateOperation(market: Market, position: Position, accountPolicy: PolicyRecord | null, request: OperationRequest): OperationPreview {
  const { op, leg, amount } = request;
  const token = leg === "collateral" ? market.collateral.token : market.debt.token;
  const fmt = (value: bigint) => `${formatAmount(value, token.decimals)} ${token.symbol}`;
  const cPrice = market.collateral.price;
  const dPrice = market.debt.price;
  const cash = market.debt.cash.status === "ok" ? market.debt.cash.value : null;

  const pledged = position.collateralEntered ? position.collateralSupplied : 0n;
  let postPledged = pledged;
  let postDebt = position.debt;
  let applies = false;
  let cashOk = true;
  let balance: CheckResult | null = null;
  const balanceCheck = (available: bigint, what: string): CheckResult => ({
    id: "balance",
    title: "Available funds",
    status: amount <= available ? "pass" : "fail",
    detail: amount <= available ? `${fmt(amount)} of ${fmt(available)} ${what}.` : `Only ${fmt(available)} ${what}.`,
    decisive: false,
    error: amount <= available ? undefined : { name: "InsufficientBalance", message: `Requested ${fmt(amount)}, available ${fmt(available)}` },
  });

  switch (op) {
    case Op.SUPPLY:
      applies = true;
      balance = balanceCheck(leg === "collateral" ? position.idleCollateral : position.idleDebtAsset, "available to supply");
      if (leg === "collateral" && position.collateralEntered) postPledged += amount;
      break;
    case Op.BORROW:
      applies = true;
      postDebt += amount;
      cashOk = cash !== null && amount <= cash && cash - amount >= market.limits.minCash;
      break;
    case Op.REDEEM:
    case Op.EXIT_COLLATERAL:
    case Op.TRANSFER:
      if (leg === "collateral") {
        balance = balanceCheck(position.collateralSupplied, "supplied");
        applies = position.collateralEntered && position.debt > 0n && amount > 0n;
        if (position.collateralEntered) postPledged = amount > pledged ? 0n : pledged - amount;
      } else {
        balance = balanceCheck(position.lent, "lent");
      }
      break;
    case Op.REPAY:
      balance = balanceCheck(position.idleDebtAsset, "available to repay");
      postDebt = amount >= postDebt ? 0n : postDebt - amount;
      break;
    case Op.ENTER_COLLATERAL:
      postPledged = position.collateralSupplied;
      break;
    default:
      break;
  }

  const fresh = cPrice.status === "ok" && dPrice.status === "ok" && cPrice.value.fresh && dPrice.value.fresh;
  const ltvOf = (collateral: bigint, debt: bigint): Maybe<number> => {
    if (debt === 0n) return ok(0);
    if (cPrice.status !== "ok" || dPrice.status !== "ok") return unavailable("Price unavailable");
    const value = ltvBps(usdValueE18(debt, market.debt.token.decimals, dPrice.value.usdE18), usdValueE18(collateral, market.collateral.token.decimals, cPrice.value.usdE18));
    if (value === null) return unavailable("No eligible collateral");
    return value > 1_000_000n ? unavailable("Above representable range") : ok(Number(value));
  };
  const ltvBefore = ltvOf(pledged, position.debt);
  const ltvAfter = ltvOf(postPledged, postDebt);
  const postLtv = ltvAfter.status === "ok" ? ltvAfter.value : null;
  const encodable = postLtv !== null && postLtv <= 10_000;
  const context: PolicyContextInput | null = applies && encodable ? { op, oracleFresh: fresh, postLtvBps: postLtv, cashOk } : null;

  const neverGated = `${OP_LABEL[op]} is never gated by a policy circuit here.`;

  const circuitCheck = (id: "account-policy" | "market-policy", title: string, record: PolicyRecord | null, errorName: string): CheckResult => {
    if (!applies) return { id, title, status: "not-applicable", detail: neverGated, decisive: false };
    if (!record) return { id, title, status: "fail", detail: "No policy is set.", decisive: false, error: { name: "AccountPolicyMissing" } };
    if (record.compiled.status !== "ok") return { id, title, status: "fail", detail: record.compiled.reason, decisive: false, error: { name: "UnavailablePolicy", args: [FIXTURE_POLICY_ID] } };
    if (!context) {
      return { id, title, status: "fail", detail: "Resulting loan-to-value is above 100% and cannot be encoded. Refused before the circuit is consulted.", decisive: false, error: { name: "InvalidContext" } };
    }
    const evaluation = evaluateLocally(record.compiled.value, context);
    if (evaluation.status !== "ok") return { id, title, status: "fail", detail: evaluation.reason, decisive: false, error: { name: "PolicyEvaluationFailed", args: [FIXTURE_POLICY_ID] } };
    const cap = formatBps(record.spec.params.maxLtvBps);
    const after = formatBps(context.postLtvBps);
    const allow = evaluation.value.allow;
    let detail = allow ? `Loan-to-value after: ${after}, cap ${cap}.` : `Circuit output 0x00 (deny). Loan-to-value after: ${after}, cap ${cap}.`;
    if (!allow && record.spec.kind === "ACCOUNT" && !record.spec.params.allowedOps.includes(op)) detail = `Circuit output 0x00 (deny). ${OP_LABEL[op]} is not in your allowed actions.`;
    if (!allow && !context.oracleFresh) detail = "Circuit output 0x00 (deny). The price feed is stale.";
    if (!allow && record.spec.kind === "MARKET" && record.spec.params.requireCashReserve && op === Op.BORROW && !context.cashOk && context.postLtvBps <= record.spec.params.maxLtvBps) {
      detail = "Circuit output 0x00 (deny). The borrow would breach the market's cash reserve.";
    }
    return { id, title, status: allow ? "pass" : "fail", detail, decisive: false, evaluation: evaluation.value, error: allow ? undefined : { name: errorName, args: [FIXTURE_POLICY_ID, 1] } };
  };

  const protocolCheck = (): CheckResult => {
    const base = { id: "protocol" as const, title: "Protocol safety limits", decisive: false };
    const fail = (name: string, detail: string): CheckResult => ({ ...base, status: "fail", detail, error: { name } });
    const supplied = leg === "collateral" ? market.collateral.totalSupplied : market.debt.totalSupplied;
    // Inactive is a borrow-only check (confirmed by Astra): supplying to an inactive market is allowed.
    if (!market.active && op === Op.BORROW) return fail("Inactive", "The market is not activated yet.");
    if (op === Op.SUPPLY && supplied.status === "ok") {
      const cap = leg === "collateral" ? market.limits.collateralSupplyCap : market.limits.debtSupplyCap;
      if (supplied.value + amount > cap) return fail("SupplyCapExceeded", `Supply cap is ${fmt(cap)}; ${fmt(supplied.value)} already supplied.`);
    }
    if (op === Op.BORROW && market.debt.totalBorrowed.status === "ok" && market.debt.totalBorrowed.value + amount > market.limits.borrowCap) {
      return fail("BorrowCapExceeded", `Borrow cap is ${fmt(market.limits.borrowCap)}.`);
    }
    if ((op === Op.REDEEM || op === Op.TRANSFER) && leg === "debt" && cash !== null && amount > cash) {
      return fail("InsufficientLiquidity", `Only ${fmt(cash)} is available in the market right now.`);
    }
    if (!applies) return { ...base, status: "pass", detail: "Solvency, cash and authentication still apply. No risk increase." };
    if (!fresh) return fail("InvalidOracle", "The price feed is stale or missing.");
    if (op !== Op.SUPPLY) {
      if (!cashOk) return fail("InsufficientLiquidity", `Not enough cash above the reserve of ${formatAmount(market.limits.minCash, market.debt.token.decimals)} ${market.debt.token.symbol}.`);
      if (postLtv === null || postLtv > market.limits.borrowLtvBps) {
        return fail("InsufficientLiquidity", `Loan-to-value after: ${postLtv === null ? "undefined" : formatBps(postLtv)}, market borrowing limit ${formatBps(market.limits.borrowLtvBps)}.`);
      }
    }
    return { ...base, status: "pass", detail: `Loan-to-value after: ${postLtv === null ? "n/a" : formatBps(postLtv)}, borrowing limit ${formatBps(market.limits.borrowLtvBps)}, liquidation at ${formatBps(market.limits.liquidationLtvBps)}.` };
  };

  const checks: CheckResult[] = [];
  if (balance) checks.push(balance);
  if (request.path === "sentinel") checks.push(circuitCheck("account-policy", "Your Sentinel policy", accountPolicy, "AccountPolicyRejected"));
  checks.push(protocolCheck());
  checks.push(circuitCheck("market-policy", "Market policy", market.policy, "MarketPolicyRejected"));

  const failing = checks.find((check) => check.status === "fail");
  if (failing) failing.decisive = true;

  let outcome: OperationPreview["outcome"] = { status: "allowed" };
  if (failing) {
    const error: RawError = failing.error ?? { name: "Unknown" };
    outcome = { status: "rejected", by: sourceOf(failing, error), error };
  }

  return {
    source: "fixture",
    method: LOCAL_PREVIEW_LABEL,
    request,
    applies,
    ltvBeforeBps: ltvBefore,
    ltvAfterBps: ltvAfter,
    context: context ? ok({ ...context, inputs: encodeFromChecks(checks) }) : unavailable(applies ? "Loan-to-value cannot be encoded" : "No policy context: this operation is not gated"),
    checks,
    outcome,
  };
}

function sourceOf(check: CheckResult, error: RawError): RejectionSource {
  if (check.id === "balance") return "balance";
  if (check.id === "protocol") return "protocol";
  if (error.name === "AccountPolicyRejected" || error.name === "AccountPolicyMissing") return "account-policy";
  if (error.name === "MarketPolicyRejected") return "market-policy";
  if (error.name === "InvalidContext") return "protocol";
  return "policy-unavailable";
}

function encodeFromChecks(checks: CheckResult[]): `0x${string}` {
  const evaluated = checks.find((check) => check.evaluation);
  return evaluated?.evaluation?.inputs ?? "0x";
}

export function opTitle(op: OpId): string {
  return OP_LABEL[op];
}

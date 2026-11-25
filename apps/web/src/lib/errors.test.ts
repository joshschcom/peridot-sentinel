import assert from "node:assert/strict";
import { test } from "node:test";
import { mapContractError, rawErrorText } from "./errors.ts";

test("market and account rejections are distinct categories", () => {
  const market = mapContractError({ name: "MarketPolicyRejected", args: ["0xabc", 1] });
  const account = mapContractError({ name: "AccountPolicyRejected", args: ["0xdef", 1] });
  assert.equal(market.category, "market-policy");
  assert.equal(account.category, "account-policy");
  assert.notEqual(market.title, account.title);
  assert.deepEqual(market.raw.args, ["0xabc", 1]);
});

test("evaluation failure is a third state, not a rejection", () => {
  assert.equal(mapContractError({ name: "PolicyEvaluationFailed", args: ["0xabc"] }).category, "policy-unavailable");
  assert.equal(mapContractError({ name: "UnavailablePolicy" }).category, "policy-unavailable");
});

test("M2 market errors map to protocol", () => {
  for (const name of ["InvalidOracle", "Inactive", "InsufficientLiquidity", "BorrowCapExceeded", "SupplyCapExceeded", "InvalidContext"]) {
    assert.equal(mapContractError({ name }).category, "protocol", name);
  }
});

test("viem-style nested revert is unwrapped", () => {
  const error = {
    name: "ContractFunctionExecutionError",
    shortMessage: "The contract function reverted",
    cause: { name: "ContractFunctionRevertedError", data: { errorName: "AccountPolicyRejected", args: ["0x01", 1] }, raw: "0xdeadbeef" },
  };
  const mapped = mapContractError(error);
  assert.equal(mapped.category, "account-policy");
  assert.equal(mapped.raw.data, "0xdeadbeef");
  const rejected = mapContractError({ name: "TransactionExecutionError", cause: { name: "UserRejectedRequestError" } });
  assert.equal(rejected.category, "wallet");
});

test("unknown errors keep raw details", () => {
  const mapped = mapContractError({ name: "SomethingNew", args: [5n] });
  assert.equal(mapped.category, "unknown");
  assert.match(mapped.message, /SomethingNew/);
  assert.match(rawErrorText(mapped.raw), /"5n"/);
  assert.equal(mapContractError("boom").raw.message, "boom");
  assert.equal(mapContractError(undefined).category, "unknown");
});

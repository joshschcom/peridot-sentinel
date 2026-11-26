import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("every custom error of the Sentinel v2 and vault ABIs has friendly text", () => {
  const dir = new URL("../../../../packages/chain-config/expansion/abi/", import.meta.url);
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    for (const item of JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Array<{ type: string; name?: string }>) if (item.type === "error" && item.name) names.add(item.name);
  }
  assert.ok(names.size > 30);
  const unmapped = [...names].filter((name) => mapContractError({ name }).category === "unknown");
  assert.deepEqual(unmapped, []);
  // The three policy layers stay distinct states: the execution policy is neither the market's nor the account's.
  assert.equal(mapContractError({ name: "ExecutionPolicyDenied" }).category, "protocol");
  assert.match(mapContractError({ name: "ExecutionPolicyDenied" }).title, /execution policy/);
  assert.equal(mapContractError({ name: "ExecutionEvaluationFailed" }).category, "policy-unavailable");
  assert.equal(mapContractError({ name: "BudgetExceeded" }).category, "operator");
  assert.match(mapContractError({ name: "VaultDepositLimit" }).message, /cap the owner set/);
});

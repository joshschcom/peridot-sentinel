import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAmount, formatBps, formatUsd, ltvBps, parseAmount, toDecimalString, usdValueE18 } from "./amount.ts";

test("parseAmount accepts plain decimals exactly", () => {
  assert.deepEqual(parseAmount("1", 6), { ok: true, value: 1_000_000n });
  assert.deepEqual(parseAmount("0.000001", 6), { ok: true, value: 1n });
  assert.deepEqual(parseAmount(".5", 6), { ok: true, value: 500_000n });
  assert.deepEqual(parseAmount("12.", 6), { ok: true, value: 12_000_000n });
  assert.deepEqual(parseAmount(" 0.1 ", 18), { ok: true, value: 100_000_000_000_000_000n });
  // 0.1 + 0.2 style float drift cannot happen: the value is built from digits.
  assert.deepEqual(parseAmount("0.3", 18), { ok: true, value: 300_000_000_000_000_000n });
  assert.deepEqual(parseAmount("123456789012345678901234567890.123456789012345678", 18), {
    ok: true,
    value: 123456789012345678901234567890123456789012345678n,
  });
});

test("parseAmount rejects instead of rounding", () => {
  assert.deepEqual(parseAmount("", 6), { ok: false, error: "empty" });
  assert.deepEqual(parseAmount("   ", 6), { ok: false, error: "empty" });
  assert.deepEqual(parseAmount("0.0000001", 6), { ok: false, error: "too-many-decimals" });
  assert.deepEqual(parseAmount("1.0000000", 6), { ok: true, value: 1_000_000n });
  for (const bad of ["-1", "+1", "1e6", "1,000", "1 000", "0x10", "1.2.3", ".", "abc", "١٢", "Infinity", "NaN"]) {
    assert.deepEqual(parseAmount(bad, 6), { ok: false, error: "invalid" }, bad);
  }
  assert.deepEqual(parseAmount("1" + "0".repeat(78), 0), { ok: false, error: "too-large" });
});

test("formatAmount truncates, never rounds up", () => {
  assert.equal(formatAmount(1_999_999n, 6, { maxFractionDigits: 2 }), "1.99");
  assert.equal(formatAmount(1_234_567_890_000n, 6), "1,234,567.89");
  assert.equal(formatAmount(0n, 6), "0");
  assert.equal(formatAmount(1n, 6, { maxFractionDigits: 2 }), "<0.01");
  assert.equal(formatAmount(2_500_000_000_000_000_000n, 18), "2.5");
  assert.equal(formatAmount(5n, 0), "5");
  assert.equal(toDecimalString(1_500_000n, 6), "1.5");
  assert.equal(toDecimalString(1n, 18), "0.000000000000000001");
});

test("usd and bps helpers stay in integers", () => {
  const price = 2_000n * 10n ** 18n;
  const value = usdValueE18(2_500_000_000_000_000_000n, 18, price);
  assert.equal(value, 5_000n * 10n ** 18n);
  assert.equal(formatUsd(value), "$5,000.00");
  assert.equal(formatUsd(1_234_567n * 10n ** 18n, { compact: true }), "$1.23M");
  assert.equal(formatBps(4550), "45.5%");
  assert.equal(formatBps(10000n), "100%");
  assert.equal(formatBps(0), "0%");
});

test("ltvBps follows INTERFACES v1: ceil, zero debt is 0, no collateral is undefined", () => {
  assert.equal(ltvBps(0n, 0n), 0n);
  assert.equal(ltvBps(0n, 100n), 0n);
  assert.equal(ltvBps(1n, 0n), null);
  assert.equal(ltvBps(1500n, 5000n), 3000n);
  assert.equal(ltvBps(1n, 3n), 3334n); // ceil(3333.33)
  assert.equal(ltvBps(2n, 1n), 20000n); // above 10000 is the caller's fail-closed case
});

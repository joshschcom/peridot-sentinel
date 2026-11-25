/**
 * Decimal-safe amount handling. Every token quantity is a bigint in raw units.
 * Nothing in this file converts a quantity through a JS floating point number.
 */

export type ParseError = "empty" | "invalid" | "too-many-decimals" | "too-large";
export type ParseResult = { ok: true; value: bigint } | { ok: false; error: ParseError };

const DECIMAL_PATTERN = /^(?:\d+\.?\d*|\.\d+)$/;
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Strict parser for user input. Rejects instead of rounding:
 * signs, exponents, thousands separators, inner whitespace, and more fraction digits than `decimals`.
 */
export function parseAmount(input: string, decimals: number): ParseResult {
  assertDecimals(decimals);
  const text = input.trim();
  if (text === "") return { ok: false, error: "empty" };
  if (!DECIMAL_PATTERN.test(text)) return { ok: false, error: "invalid" };
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    // Trailing zeros beyond the precision carry no value, anything else would need rounding.
    if (/[1-9]/.test(fraction.slice(decimals))) return { ok: false, error: "too-many-decimals" };
  }
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  const value = BigInt((whole || "0") + padded);
  if (value > MAX_UINT256) return { ok: false, error: "too-large" };
  return { ok: true, value };
}

export function parseErrorMessage(error: ParseError, decimals: number, symbol: string): string {
  switch (error) {
    case "empty":
      return "Enter an amount.";
    case "invalid":
      return "Use digits and one decimal point only.";
    case "too-many-decimals":
      return `${symbol} supports at most ${decimals} decimal places.`;
    case "too-large":
      return "Amount is too large.";
  }
}

export interface FormatOptions {
  /** Maximum fraction digits to show. Extra digits are truncated toward zero, never rounded up. */
  maxFractionDigits?: number;
  /** Minimum fraction digits to keep (pads with zeros). */
  minFractionDigits?: number;
  grouping?: boolean;
}

/** Exact decimal string for a raw amount, suitable for putting back into an input. */
export function toDecimalString(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatAmount(value: bigint, decimals: number, options: FormatOptions = {}): string {
  const { maxFractionDigits = Math.min(decimals, 4), minFractionDigits = 0, grouping = true } = options;
  const negative = value < 0n;
  const exact = toDecimalString(negative ? -value : value, decimals);
  const [whole = "0", fractionFull = ""] = exact.split(".");
  let fraction = fractionFull.slice(0, maxFractionDigits).replace(/0+$/, "");
  const truncatedToZero = value !== 0n && /^0*$/.test(whole) && fraction === "" && /[1-9]/.test(fractionFull);
  if (truncatedToZero) {
    return `${negative ? "-" : ""}<0.${"0".repeat(Math.max(maxFractionDigits - 1, 0))}1`;
  }
  fraction = fraction.padEnd(minFractionDigits, "0");
  const groupedWhole = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${negative ? "-" : ""}${groupedWhole}${fraction ? `.${fraction}` : ""}`;
}

/** USD values are carried as 1e18-scaled bigints (same scale as the test price feed). */
export const USD_DECIMALS = 18;

export function formatUsd(valueE18: bigint, options: { compact?: boolean } = {}): string {
  const negative = valueE18 < 0n;
  const abs = negative ? -valueE18 : valueE18;
  const sign = negative ? "-" : "";
  if (options.compact) {
    const units = abs / 10n ** BigInt(USD_DECIMALS);
    const tiers: Array<[bigint, string]> = [
      [1_000_000_000n, "B"],
      [1_000_000n, "M"],
      [1_000n, "K"],
    ];
    for (const [size, suffix] of tiers) {
      if (units >= size) {
        const scaled = (abs * 100n) / (size * 10n ** BigInt(USD_DECIMALS));
        return `${sign}$${formatAmount(scaled, 2, { maxFractionDigits: 2 })}${suffix}`;
      }
    }
  }
  return `${sign}$${formatAmount(abs, USD_DECIMALS, { maxFractionDigits: 2, minFractionDigits: 2 })}`;
}

/** value = amount * price / 10^decimals, rounded down. `priceE18` is USD per whole token, 1e18-scaled. */
export function usdValueE18(amount: bigint, decimals: number, priceE18: bigint): bigint {
  assertDecimals(decimals);
  return (amount * priceE18) / 10n ** BigInt(decimals);
}

/** Inverse of usdValueE18, rounded down. Returns null when the price is not positive. */
export function amountFromUsdE18(valueE18: bigint, decimals: number, priceE18: bigint): bigint | null {
  if (priceE18 <= 0n) return null;
  return (valueE18 * 10n ** BigInt(decimals)) / priceE18;
}

export const BPS = 10_000n;

/**
 * INTERFACES v1: LTV = ceil(post debt value x 10000 / post eligible collateral value). Zero debt gives 0.
 * Returns null when debt exists against zero collateral (undefined, not zero and not infinity).
 */
export function ltvBps(debtValue: bigint, collateralValue: bigint): bigint | null {
  if (debtValue < 0n || collateralValue < 0n) return null;
  if (debtValue === 0n) return 0n;
  if (collateralValue === 0n) return null;
  return (debtValue * BPS + collateralValue - 1n) / collateralValue;
}

/** "45.5%" from integer basis points, without floating point. */
export function formatBps(bps: bigint | number, fractionDigits = 2): string {
  const value = typeof bps === "number" ? BigInt(Math.trunc(bps)) : bps;
  return `${formatAmount(value, 2, { maxFractionDigits: fractionDigits, grouping: false })}%`;
}

export function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError(`Unsupported decimals: ${decimals}`);
  }
}

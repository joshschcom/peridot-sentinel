/**
 * SYNTHETIC answers of the two OKX Onchain OS routes, for an example-data build only (NEXT_PUBLIC_PERIDOT_DATA=fixture).
 * Every number and token here is invented. Nothing in this file is, or is derived from, an observation of OKX.
 *
 * Each scenario returns what the route would return (HTTP status and JSON body, same schema), so the page runs the
 * same checks and components on it as on a real answer. Together the scenarios cover every status a network can
 * have, the missing-credentials answer, an answer that fails the page's checks, and a refused request.
 */
import { INDICATIVE_QUOTE, type OkxSubject, PORTFOLIO_SCHEMA, QUOTE_SCHEMA } from "../../lib/okx-portfolio.ts";
import type { OkxChainIndex } from "../../lib/okx-switches.ts";

export const OKX_FIXTURE_SCENARIOS = ["mixed", "limited", "complete", "missing", "malformed", "refused"] as const;
export type OkxFixtureScenario = (typeof OKX_FIXTURE_SCENARIOS)[number];
export const parseOkxScenario = (value: string | null | undefined): OkxFixtureScenario | null => OKX_FIXTURE_SCENARIOS.find((scenario) => scenario === value) ?? null;

/** What each scenario is meant to show (also printed next to the example). */
export const OKX_SCENARIO_NOTE: Record<OkxFixtureScenario, string> = {
  mixed: "one network read, one without holdings, one OKX does not support, one this app's access does not include",
  limited: "one network rate limited, one not answering, one read twelve minutes ago, one read now",
  complete: "all four networks read",
  missing: "the deployment has no OKX read access",
  malformed: "two answers fail this page's checks (another address; an amount that is not a decimal), two are read",
  refused: "the app's server refuses the request",
};

export interface FixtureAnswer {
  status: number;
  body: unknown;
}

type Shape = "ok" | "empty" | "unsupported" | "not-entitled" | "rate-limited" | "unavailable" | "stale" | "other-address" | "bad-amount";
const PLAN: Record<Exclude<OkxFixtureScenario, "missing" | "refused">, Record<OkxChainIndex, Shape>> = {
  mixed: { "196": "ok", "1": "empty", "8453": "unsupported", "501": "not-entitled" },
  limited: { "196": "rate-limited", "1": "unavailable", "8453": "stale", "501": "ok" },
  complete: { "196": "ok", "1": "ok", "8453": "ok", "501": "ok" },
  malformed: { "196": "other-address", "1": "bad-amount", "8453": "ok", "501": "ok" },
};
const REASON: Partial<Record<Shape, string>> = { unsupported: "unsupported-chain", "not-entitled": "not-entitled", "rate-limited": "rate-limited", unavailable: "provider-unavailable" };

const evmToken = (n: number) => `0x00000000000000000000000000000000000000${n.toString(16).padStart(2, "0").toUpperCase()}`;
const HOLDINGS: Record<OkxChainIndex, { walletUsd: string; tokens: Array<Record<string, unknown>> }> = {
  "196": {
    walletUsd: "1284.513",
    tokens: [
      { tokenAddress: null, symbol: "OKB", balance: "12.5", rawBalance: "12500000000000000000", priceUsd: "51.2", isNative: true },
      { tokenAddress: evmToken(0xa1), symbol: "USDC", balance: "644.5", rawBalance: "644500000", priceUsd: "1.0002", isNative: false },
      { tokenAddress: evmToken(0xa2), symbol: "SYNTHETICLONGSYMBOLTOKEN", balance: "9007199254740993.120003400000000001", rawBalance: null, priceUsd: null, isNative: false },
      { tokenAddress: evmToken(0xa3), symbol: "DUST", balance: "0.000000000000000001", rawBalance: "1", priceUsd: "0", isNative: false },
    ],
  },
  "1": {
    walletUsd: "2110.04",
    tokens: [
      { tokenAddress: null, symbol: "ETH", balance: "0.61", rawBalance: null, priceUsd: "3050.1", isNative: true },
      { tokenAddress: evmToken(0xb1), symbol: "USDT", balance: "249.479", rawBalance: "249479000", priceUsd: "1", isNative: false },
    ],
  },
  "8453": {
    walletUsd: "310.07",
    tokens: [
      { tokenAddress: null, symbol: "ETH", balance: "0.05", rawBalance: null, priceUsd: "3050.1", isNative: true },
      { tokenAddress: evmToken(0xc1), symbol: "USDC", balance: "157.565", rawBalance: "157565000", priceUsd: "1", isNative: false },
      ...Array.from({ length: 9 }, (_, index) => ({ tokenAddress: evmToken(0xd0 + index), symbol: `EX${index + 1}`, balance: `${index + 1}.25`, rawBalance: null, priceUsd: null, isNative: false })),
    ],
  },
  "501": {
    walletUsd: "95.4",
    tokens: [
      { tokenAddress: null, symbol: "SOL", balance: "0.4", rawBalance: "400000000", priceUsd: "176", isNative: true },
      { tokenAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", symbol: "EXAMPLE", balance: "25", rawBalance: "25000000", priceUsd: "1", isNative: false },
    ],
  },
};

function network(subject: OkxSubject, shape: Shape, now: string, old: string): Record<string, unknown> {
  const at = shape === "stale" ? old : now;
  const base = { chainIndex: subject.chainIndex, address: subject.address, requestedAt: at, receivedAt: at, walletUsdScope: "wallet-tokens" };
  if (shape === "ok" || shape === "stale") return { ...base, status: "ok", reason: null, ...HOLDINGS[subject.chainIndex] };
  if (shape === "empty") return { ...base, status: "empty", reason: null, tokens: [], walletUsd: "0" };
  if (shape === "other-address") return { ...base, address: subject.chainIndex === "501" ? "So11111111111111111111111111111111111111112" : evmToken(0xee), status: "ok", reason: null, ...HOLDINGS[subject.chainIndex] };
  if (shape === "bad-amount") return { ...base, status: "ok", reason: null, walletUsd: "1e20", tokens: HOLDINGS[subject.chainIndex].tokens };
  return { ...base, status: shape, reason: REASON[shape] ?? null, tokens: [], walletUsd: null };
}

export function fixturePortfolio(scenario: OkxFixtureScenario, subjects: readonly OkxSubject[], nowMs: number): FixtureAnswer {
  if (scenario === "refused") return { status: 400, body: { schema: PORTFOLIO_SCHEMA, error: "bad-request" } };
  const now = new Date(nowMs).toISOString();
  const old = new Date(nowMs - 12 * 60_000).toISOString();
  if (scenario === "missing") {
    return { status: 200, body: { schema: PORTFOLIO_SCHEMA, source: "OKX Onchain OS", credentials: "missing", requestedAt: now, networks: subjects.map((subject) => ({ chainIndex: subject.chainIndex, address: subject.address, status: "unavailable", reason: "credentials-missing", requestedAt: now, receivedAt: now, tokens: [], walletUsd: null, walletUsdScope: "wallet-tokens" })) } };
  }
  return { status: 200, body: { schema: PORTFOLIO_SCHEMA, source: "OKX Onchain OS", credentials: "present", requestedAt: now, networks: subjects.map((subject) => network(subject, PLAN[scenario][subject.chainIndex], now, old)) } };
}

export function fixtureQuote(scenario: OkxFixtureScenario, nowMs: number): FixtureAnswer {
  const base = { schema: QUOTE_SCHEMA, chainId: INDICATIVE_QUOTE.chainId, tokenIn: INDICATIVE_QUOTE.tokenIn, amountIn: INDICATIVE_QUOTE.amountIn, tokenOut: INDICATIVE_QUOTE.tokenOut };
  const now = new Date(nowMs).toISOString();
  switch (scenario) {
    case "refused":
      return { status: 400, body: { schema: QUOTE_SCHEMA, error: "bad-request" } };
    case "missing":
      return { status: 200, body: { ...base, status: "unavailable", reason: "credentials-missing", amountOut: null, observedAt: now } };
    case "limited":
      return { status: 200, body: { ...base, status: "rate-limited", reason: "rate-limited", amountOut: null, observedAt: now } };
    case "malformed":
      // A number for another output token: the page must show no number.
      return { status: 200, body: { ...base, tokenOut: evmToken(0xee), status: "ok", reason: null, amountOut: "51234500", observedAt: now } };
    case "complete":
      return { status: 200, body: { ...base, status: "ok", reason: null, amountOut: "51234500", observedAt: new Date(nowMs - 12 * 60_000).toISOString() } };
    case "mixed":
      return { status: 200, body: { ...base, status: "ok", reason: null, amountOut: "51234500", observedAt: now } };
  }
}

/**
 * "Other networks" on Portfolio and the indicative mainnet quote on Trade, as far as they can be decided without a
 * request: which address goes to which network, what an answer of the app's own routes (api/onchainos) must look
 * like before anything of it is shown, the words for every status, and the arithmetic of the totals.
 *
 * Pure, so it runs in node tests. Rules this module encodes:
 *   - Fail closed per network. An answer that is not exactly the documented shape for the address that was asked
 *     about becomes "not available" for that network; no part of it is shown.
 *   - Every amount is a decimal STRING from the route. Nothing here goes through a floating point number: sums are
 *     exact, and display truncates toward zero.
 *   - A cross-network total counts only networks whose status is "ok" and that carry an estimate. Anything else makes
 *     the total partial. A missing estimate is unknown, never zero.
 *   - These are mainnet wallet tokens. They are never added to the testnet figures of this app; nothing in this
 *     module takes a testnet value as input.
 */
import { QUOTE_TOKENS } from "./connect.ts";
import { formatAmount } from "./amount.ts";
import { formatTime } from "./format.ts";
import { OKX_CHAIN_INDEXES, type OkxChainIndex } from "./okx-switches.ts";

/* ---------- networks and addresses ---------- */

export const OKX_NETWORKS: Record<OkxChainIndex, { name: string; kind: "evm" | "solana" }> = {
  "196": { name: "X Layer", kind: "evm" },
  "1": { name: "Ethereum", kind: "evm" },
  "8453": { name: "Base", kind: "evm" },
  "501": { name: "Solana", kind: "solana" },
};

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet, as Solana uses it) to bytes; null for any character outside the alphabet. */
export function decodeBase58(text: string): Uint8Array | null {
  if (text.length === 0 || text.length > 64) return null;
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  // Each leading "1" is one leading zero byte.
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

/** A Solana account address: base58, case-sensitive, decoding to exactly 32 bytes. */
export const isSolanaAddress = (text: string): boolean => decodeBase58(text)?.length === 32;
export const isEvmAddress = (text: string): boolean => EVM_ADDRESS.test(text);

export interface OkxSubject {
  chainIndex: OkxChainIndex;
  address: string;
}

/**
 * One subject per enabled network that has an address: the wallet's EVM address on the EVM networks, the typed
 * Solana address on Solana. A network that is not enabled is never asked about, whatever addresses exist.
 */
export function buildSubjects(enabled: readonly OkxChainIndex[], evmAddress: string | null, solanaAddress: string | null): OkxSubject[] {
  const subjects: OkxSubject[] = [];
  for (const chainIndex of OKX_CHAIN_INDEXES) {
    if (!enabled.includes(chainIndex)) continue;
    const address = OKX_NETWORKS[chainIndex].kind === "evm" ? evmAddress : solanaAddress;
    if (address === null) continue;
    if (OKX_NETWORKS[chainIndex].kind === "evm" ? !isEvmAddress(address) : !isSolanaAddress(address)) continue;
    subjects.push({ chainIndex, address });
  }
  return subjects;
}

/** The route's query: `subjects=chainIndex:address,…` (at most four). */
export const subjectsParam = (subjects: readonly OkxSubject[]): string => subjects.map((subject) => `${subject.chainIndex}:${subject.address}`).join(",");
export const portfolioPath = (subjects: readonly OkxSubject[]): string => `/api/onchainos/portfolio?${new URLSearchParams({ subjects: subjectsParam(subjects) })}`;

/* ---------- exact decimal strings ---------- */

const DECIMAL = /^\d{1,60}(?:\.\d{1,40})?$/;
export const isDecimalString = (value: unknown): value is string => typeof value === "string" && DECIMAL.test(value);

/** Exact sum of non-negative decimal strings, as a decimal string without trailing fraction zeros. */
export function addDecimalStrings(values: readonly string[]): string {
  let scale = 0;
  for (const value of values) scale = Math.max(scale, value.split(".")[1]?.length ?? 0);
  let sum = 0n;
  for (const value of values) {
    const [whole = "0", fraction = ""] = value.split(".");
    sum += BigInt(whole + fraction.padEnd(scale, "0"));
  }
  const digits = sum.toString().padStart(scale + 1, "0");
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return `${digits.slice(0, digits.length - scale)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * A decimal string for display: grouped, at most `maxFractionDigits`, truncated toward zero and never rounded up.
 * A positive value that would truncate to zero is shown as "<0.01" (for two digits), not as zero.
 */
export function formatDecimalString(value: string, maxFractionDigits: number, minFractionDigits = 0): string {
  const [wholeRaw = "0", fractionFull = ""] = value.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  let fraction = fractionFull.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (whole === "0" && fraction === "" && /[1-9]/.test(fractionFull)) return `<0.${"0".repeat(Math.max(maxFractionDigits - 1, 0))}1`;
  fraction = fraction.padEnd(minFractionDigits, "0");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

export function formatUsdString(value: string): string {
  const text = formatDecimalString(value, 2, 2);
  return text.startsWith("<") ? `<$${text.slice(1)}` : `$${text}`;
}

/* ---------- the portfolio answer ---------- */

export const PORTFOLIO_SCHEMA = "peridot.okx-portfolio/v1";
export const OKX_STATUSES = ["ok", "empty", "unsupported", "not-entitled", "rate-limited", "unavailable"] as const;
export type OkxStatus = (typeof OKX_STATUSES)[number];

export interface OkxTokenView {
  /** Contract address or mint. Null for the network's native token. */
  tokenAddress: string | null;
  /** The provider's symbol for the token: untrusted text, shown as plain text only. */
  symbol: string;
  balance: string;
  rawBalance: string | null;
  /** USD per whole token, or null when OKX gave no price. Null is unknown, not zero. */
  priceUsd: string | null;
  isNative: boolean;
}

export interface OkxNetworkView {
  chainIndex: OkxChainIndex;
  address: string;
  status: OkxStatus;
  /** A short code: the route's own, or one of this module's (LOCAL_REASONS). Never provider text. */
  reason: string | null;
  /** When the route received OKX's answer (or asked, when there was none). Null: not reported. */
  observedAt: string | null;
  tokens: OkxTokenView[];
  /** OKX's USD estimate of the wallet's tokens on this network (scope "wallet-tokens"), or null: unknown. */
  walletUsd: string | null;
}

export interface OkxPortfolioView {
  /** "unknown": the answer did not say (it was not in the expected format, or the route did not answer 200). */
  credentials: "present" | "missing" | "unknown";
  networks: OkxNetworkView[];
}

/** Reasons this app assigns itself, next to the route's own codes. */
export const LOCAL_REASONS = {
  invalid: "invalid-answer",
  route: "route-error",
  refused: "request-refused",
  failed: "request-failed",
} as const;

const REASON = /^[a-z0-9-]{1,48}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RAW_UNITS = /^\d{1,80}$/;
const MAX_TOKENS = 500;
const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const isoTime = (value: unknown): string | null => (typeof value === "string" && ISO_TIME.test(value) && !Number.isNaN(Date.parse(value)) ? value : null);
const sameAddress = (chainIndex: OkxChainIndex, a: string, b: string): boolean => (OKX_NETWORKS[chainIndex].kind === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** No control, zero-width, bidirectional-override or line-separator character (code points, so no escape survives a copy). */
function printable(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f) || (code >= 0x2060 && code <= 0x206f) || code === 0xfeff) return false;
  }
  return true;
}

function parseToken(chainIndex: OkxChainIndex, value: unknown): OkxTokenView | null {
  const token = record(value);
  if (!token || typeof token.isNative !== "boolean") return null;
  const { tokenAddress, symbol, balance, rawBalance, priceUsd } = token;
  if (tokenAddress === null ? !token.isNative : typeof tokenAddress !== "string" || !(OKX_NETWORKS[chainIndex].kind === "evm" ? isEvmAddress(tokenAddress) : isSolanaAddress(tokenAddress))) return null;
  // The symbol is somebody's text. It is kept only as printable characters of a bounded length, and rendered as text.
  if (typeof symbol !== "string" || symbol.length === 0 || symbol.length > 64 || !printable(symbol)) return null;
  if (!isDecimalString(balance)) return null;
  if (rawBalance !== null && (typeof rawBalance !== "string" || !RAW_UNITS.test(rawBalance))) return null;
  if (priceUsd !== null && !isDecimalString(priceUsd)) return null;
  return { tokenAddress: tokenAddress as string | null, symbol, balance, rawBalance: rawBalance as string | null, priceUsd: priceUsd as string | null, isNative: token.isNative };
}

function parseNetwork(subject: OkxSubject, value: unknown): OkxNetworkView | null {
  const network = record(value);
  if (!network || network.chainIndex !== subject.chainIndex || typeof network.address !== "string" || !sameAddress(subject.chainIndex, network.address, subject.address)) return null;
  const status = OKX_STATUSES.find((candidate) => candidate === network.status);
  if (!status) return null;
  const reason = network.reason === null || network.reason === undefined ? null : typeof network.reason === "string" && REASON.test(network.reason) ? network.reason : undefined;
  if (reason === undefined) return null;
  const observedAt = isoTime(network.receivedAt) ?? isoTime(network.requestedAt);
  const walletUsd = network.walletUsd === null || network.walletUsd === undefined ? null : isDecimalString(network.walletUsd) ? network.walletUsd : undefined;
  if (walletUsd === undefined) return null;
  const base = { chainIndex: subject.chainIndex, address: subject.address, status, reason, observedAt };
  // Only an "ok" network carries holdings. An estimate is kept for "ok" and for "empty" (where it is OKX's zero).
  if (status !== "ok") return { ...base, tokens: [], walletUsd: status === "empty" ? walletUsd : null };
  if (network.walletUsdScope !== "wallet-tokens" && walletUsd !== null) return null;
  if (!Array.isArray(network.tokens) || network.tokens.length === 0 || network.tokens.length > MAX_TOKENS) return null;
  const tokens: OkxTokenView[] = [];
  for (const entry of network.tokens) {
    const token = parseToken(subject.chainIndex, entry);
    if (!token) return null;
    tokens.push(token);
  }
  return { ...base, tokens, walletUsd };
}

const refusedNetwork = (subject: OkxSubject, reason: string, observedAt: string | null = null): OkxNetworkView => ({ chainIndex: subject.chainIndex, address: subject.address, status: "unavailable", reason, observedAt, tokens: [], walletUsd: null });

/** Every requested network as "not available", with one of this app's own reasons (the route did not answer usably). */
export const portfolioFailure = (subjects: readonly OkxSubject[], reason: string): OkxPortfolioView => ({ credentials: "unknown", networks: subjects.map((subject) => refusedNetwork(subject, reason)) });

/**
 * The route's 200 answer, checked against what was asked. The result always has exactly the requested networks, in
 * the requested order: a network that is missing from the answer, answers for another address, or is not of the
 * documented shape is "not available" with reason "invalid-answer", and nothing of it is kept.
 */
export function parsePortfolioBody(json: unknown, subjects: readonly OkxSubject[]): OkxPortfolioView {
  const body = record(json);
  if (!body || body.schema !== PORTFOLIO_SCHEMA || (body.credentials !== "present" && body.credentials !== "missing") || !Array.isArray(body.networks) || body.networks.length > OKX_CHAIN_INDEXES.length) return portfolioFailure(subjects, LOCAL_REASONS.invalid);
  const entries = body.networks;
  return {
    credentials: body.credentials,
    networks: subjects.map((subject) => {
      const matches = entries.filter((entry) => record(entry)?.chainIndex === subject.chainIndex);
      const parsed = matches.length === 1 ? parseNetwork(subject, matches[0]) : null;
      if (!parsed) return refusedNetwork(subject, LOCAL_REASONS.invalid);
      // Without credentials the route sends nothing to OKX, so no network of such an answer can carry holdings.
      if (body.credentials === "missing" && parsed.status !== "unavailable") return refusedNetwork(subject, LOCAL_REASONS.invalid);
      return parsed;
    }),
  };
}

/** A route answer (HTTP status and parsed JSON) as a view. Only a 200 can carry holdings. */
export function portfolioFromAnswer(status: number, json: unknown, subjects: readonly OkxSubject[]): OkxPortfolioView {
  if (status === 200) return parsePortfolioBody(json, subjects);
  return portfolioFailure(subjects, status === 400 ? LOCAL_REASONS.refused : LOCAL_REASONS.route);
}

/* ---------- words ---------- */

export type StatusTone = "success" | "neutral" | "warning";
export interface StatusWords {
  label: string;
  /** One sentence for the card. Null for "ok": the holdings speak for themselves. */
  detail: string | null;
  tone: StatusTone;
}

const UNAVAILABLE_DETAIL: Record<string, string> = {
  "credentials-missing": "This deployment has no OKX read access configured, so nothing was sent to OKX.",
  "native-marker-unverified": "OKX's answer could not be matched to this network's native token, so nothing of it is shown.",
  "malformed-provider": "OKX's answer was not in the expected format, so nothing of it is shown.",
  [LOCAL_REASONS.invalid]: "The answer was not in the expected format for this address, so nothing of it is shown.",
  [LOCAL_REASONS.route]: "This app's server could not complete the lookup.",
  [LOCAL_REASONS.refused]: "This app's server refused the request as malformed. Nothing was sent to OKX.",
  [LOCAL_REASONS.failed]: "The request did not reach this app's server.",
};

/** What a network's status means, in words. `what` is "balances" on Portfolio and "quotes" on Trade. */
export function statusWords(status: OkxStatus, reason: string | null, what: "balances" | "quotes" = "balances"): StatusWords {
  switch (status) {
    case "ok":
      return { label: "Read from OKX", detail: null, tone: "success" };
    case "empty":
      return { label: "No holdings returned", detail: "OKX returned no tokens for this address on this network. Tokens that OKX filters out as risky are not listed.", tone: "neutral" };
    case "unsupported":
      return { label: "Not supported by OKX", detail: `OKX doesn't support this network for ${what}.`, tone: "neutral" };
    case "not-entitled":
      return { label: "Not enabled", detail: `This app's OKX access does not include ${what} on this network.`, tone: "neutral" };
    case "rate-limited":
      return { label: "Busy", detail: "Too many requests right now. Try again in a minute.", tone: "warning" };
    case "unavailable":
      if (reason === LOCAL_REASONS.invalid && what === "quotes") return { label: "Not available right now", detail: "The answer was not a complete quote for exactly this pair and amount, so nothing of it is shown.", tone: "warning" };
      return { label: "Not available right now", detail: (reason !== null ? UNAVAILABLE_DETAIL[reason] : undefined) ?? (what === "balances" ? "OKX did not answer. This says nothing about your balances." : "OKX did not answer."), tone: "warning" };
  }
}

/* ---------- when it was observed ---------- */

export const STALE_AFTER_MS = 5 * 60_000;
export interface Observation {
  /** "28 Nov, 12:00 UTC", or "Time not reported". */
  text: string;
  /** Older than five minutes, or of unknown age. */
  stale: boolean;
  minutes: number | null;
}
export function observation(observedAt: string | null, nowMs: number): Observation {
  const at = observedAt === null ? Number.NaN : Date.parse(observedAt);
  if (Number.isNaN(at)) return { text: "Time not reported", stale: true, minutes: null };
  const age = Math.max(0, nowMs - at);
  return { text: formatTime(observedAt as string), stale: age > STALE_AFTER_MS, minutes: Math.floor(age / 60_000) };
}

/* ---------- totals ---------- */

export interface CrossNetworkTotal {
  /** Exact sum of the counted networks' estimates. Null: no network could be counted. */
  usd: string | null;
  counted: OkxChainIndex[];
  notCounted: OkxChainIndex[];
  /** True when any requested network is not counted. A partial total is a lower bound of what was asked about. */
  partial: boolean;
}

/** Only "ok" networks with an estimate count. Everything else (including "empty" and an "ok" network without an estimate) makes it partial. */
export function crossNetworkTotal(networks: readonly OkxNetworkView[]): CrossNetworkTotal {
  const counted = networks.filter((network) => network.status === "ok" && network.walletUsd !== null);
  return {
    usd: counted.length === 0 ? null : addDecimalStrings(counted.map((network) => network.walletUsd as string)),
    counted: counted.map((network) => network.chainIndex),
    notCounted: networks.filter((network) => !counted.includes(network)).map((network) => network.chainIndex),
    partial: counted.length !== networks.length,
  };
}

/* ---------- the indicative quote ---------- */

export const QUOTE_SCHEMA = "peridot.okx-quote/v1";
const WOKB = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
const USDC = "0xb6ceceab302e2e4948951ee7843fc24e92933061";
/** The one question this app asks: what does 1 WOKB fetch in USDC on X Layer mainnet (chain 196)? */
export const INDICATIVE_QUOTE = { from: "WOKB", amountIn: "1000000000000000000", tokenIn: WOKB, tokenOut: USDC, chainId: 196 } as const;
export const quotePath = (): string => `/api/onchainos/quote?${new URLSearchParams({ from: INDICATIVE_QUOTE.from, amount: INDICATIVE_QUOTE.amountIn })}`;

export type OkxQuoteView =
  | { status: "ok"; amountIn: string; amountOut: string; observedAt: string }
  | { status: Exclude<OkxStatus, "ok" | "empty">; reason: string | null; observedAt: string | null };

export const quoteFailure = (reason: string): OkxQuoteView => ({ status: "unavailable", reason, observedAt: null });

/**
 * A number is shown only for a complete answer to exactly the question asked: chain 196, both token identities, the
 * echoed input amount, a positive raw output and a time. Anything else is a status without a number.
 */
export function parseQuoteBody(json: unknown): OkxQuoteView {
  const body = record(json);
  if (!body || body.schema !== QUOTE_SCHEMA) return quoteFailure(LOCAL_REASONS.invalid);
  const status = OKX_STATUSES.find((candidate) => candidate === body.status);
  const reason = typeof body.reason === "string" && REASON.test(body.reason) ? body.reason : null;
  const observedAt = isoTime(body.observedAt);
  if (!status || status === "empty") return quoteFailure(LOCAL_REASONS.invalid);
  if (status !== "ok") return { status, reason, observedAt };
  const tokenIn = QUOTE_TOKENS[INDICATIVE_QUOTE.tokenIn];
  const tokenOut = QUOTE_TOKENS[INDICATIVE_QUOTE.tokenOut];
  const complete =
    body.chainId === INDICATIVE_QUOTE.chainId &&
    typeof body.tokenIn === "string" &&
    body.tokenIn.toLowerCase() === INDICATIVE_QUOTE.tokenIn &&
    typeof body.tokenOut === "string" &&
    body.tokenOut.toLowerCase() === INDICATIVE_QUOTE.tokenOut &&
    body.amountIn === INDICATIVE_QUOTE.amountIn &&
    typeof body.amountOut === "string" &&
    /^[1-9]\d{0,77}$/.test(body.amountOut) &&
    observedAt !== null;
  if (!complete || !tokenIn || !tokenOut) return quoteFailure(LOCAL_REASONS.invalid);
  return {
    status: "ok",
    amountIn: `${formatAmount(BigInt(INDICATIVE_QUOTE.amountIn), tokenIn.decimals, { maxFractionDigits: 6 })} ${tokenIn.symbol}`,
    amountOut: `${formatAmount(BigInt(body.amountOut as string), tokenOut.decimals, { maxFractionDigits: 6 })} ${tokenOut.symbol}`,
    observedAt: observedAt as string,
  };
}

/** A route answer (HTTP status and parsed JSON) as a view. Only a 200 can carry a number. */
export function quoteFromAnswer(status: number, json: unknown): OkxQuoteView {
  if (status === 200) return parseQuoteBody(json);
  return quoteFailure(status === 400 ? LOCAL_REASONS.refused : LOCAL_REASONS.route);
}

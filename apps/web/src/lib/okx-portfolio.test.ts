import assert from "node:assert/strict";
import { test } from "node:test";
import { OKX_FIXTURE_SCENARIOS, fixturePortfolio, fixtureQuote, parseOkxScenario } from "../services/fixture/okx.ts";
import {
  INDICATIVE_QUOTE,
  LOCAL_REASONS,
  OKX_STATUSES,
  type OkxNetworkView,
  type OkxSubject,
  STALE_AFTER_MS,
  addDecimalStrings,
  buildSubjects,
  crossNetworkTotal,
  decodeBase58,
  formatDecimalString,
  formatUsdString,
  isSolanaAddress,
  observation,
  parsePortfolioBody,
  parseQuoteBody,
  portfolioFromAnswer,
  portfolioPath,
  quoteFromAnswer,
  quotePath,
  statusWords,
  subjectsParam,
} from "./okx-portfolio.ts";

const EVM = "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67";
const SOL = "So11111111111111111111111111111111111111112";
const TOKEN = "0x1234567890AbcdEF1234567890aBcdef12345678";
const NOW = Date.parse("2026-11-28T12:00:00Z");
const ISO = "2026-11-28T12:00:00.000Z";
const ALL = ["196", "1", "8453", "501"] as const;
const SUBJECTS: OkxSubject[] = [
  { chainIndex: "196", address: EVM },
  { chainIndex: "1", address: EVM },
  { chainIndex: "8453", address: EVM },
  { chainIndex: "501", address: SOL },
];
const token = (change: Record<string, unknown> = {}) => ({ tokenAddress: TOKEN, symbol: "SYN", balance: "1.5", rawBalance: "1500000", priceUsd: "2", isNative: false, ...change });
const net = (subject: OkxSubject, change: Record<string, unknown> = {}) => ({ chainIndex: subject.chainIndex, address: subject.address, status: "ok", reason: null, requestedAt: ISO, receivedAt: ISO, tokens: [token(subject.chainIndex === "501" ? { tokenAddress: SOL } : {})], walletUsd: "3", walletUsdScope: "wallet-tokens", ...change });
const body = (networks: unknown[], change: Record<string, unknown> = {}) => ({ schema: "peridot.okx-portfolio/v1", source: "OKX Onchain OS", credentials: "present", requestedAt: ISO, networks, ...change });
const view = (chainIndex: (typeof ALL)[number], status: OkxNetworkView["status"], walletUsd: string | null): OkxNetworkView => ({ chainIndex, address: chainIndex === "501" ? SOL : EVM, status, reason: null, observedAt: ISO, tokens: [], walletUsd });

/* ---------- addresses ---------- */

test("a Solana address is base58 that stands for exactly 32 bytes; case matters", () => {
  for (const address of [SOL, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "11111111111111111111111111111111", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]) assert.equal(isSolanaAddress(address), true, address);
  // The system program is 32 ones: each leading "1" is a zero byte.
  assert.deepEqual([...(decodeBase58("11111111111111111111111111111111") ?? [])], new Array(32).fill(0));
  assert.deepEqual([...(decodeBase58("2g") ?? [])], [0x61]);
  assert.deepEqual([...(decodeBase58("1112") ?? [])], [0, 0, 0, 1]);
  for (const [label, address] of [
    ["empty", ""],
    ["31 bytes", "1111111111111111111111111111111"],
    ["33 bytes", "111111111111111111111111111111111"],
    ["a zero", "So1111111111111111111111111111111111111111O".replace("O", "0")],
    ["capital O", "So1111111111111111111111111111111111111111O"],
    ["capital I", "So1111111111111111111111111111111111111111I"],
    ["lower l", "So1111111111111111111111111111111111111111l"],
    ["an EVM address", EVM],
    ["surrounding space", ` ${SOL}`],
    ["too long", "z".repeat(65)],
    ["44 characters that stand for 33 bytes", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"],
  ] as const) assert.equal(isSolanaAddress(address), false, label);
  // Another casing of a valid address is another address (or none): it is never normalised.
  assert.notEqual(SOL.toLowerCase(), SOL);
  assert.notDeepEqual(decodeBase58(SOL.toLowerCase()), decodeBase58(SOL));
});

test("subjects: the wallet's address on the enabled EVM networks, the typed address on Solana, nothing else", () => {
  assert.deepEqual(buildSubjects([...ALL], EVM, SOL), SUBJECTS);
  assert.deepEqual(buildSubjects([...ALL], EVM, null), SUBJECTS.slice(0, 3));
  assert.deepEqual(buildSubjects([...ALL], null, SOL), SUBJECTS.slice(3));
  assert.deepEqual(buildSubjects([], EVM, SOL), []);
  // A network that is not enabled is never asked about; the order is fixed, whatever order the switches are given in.
  assert.deepEqual(buildSubjects(["501", "196"], EVM, SOL), [SUBJECTS[0], SUBJECTS[3]]);
  assert.deepEqual(buildSubjects(["1"], EVM, SOL), [SUBJECTS[1]]);
  // A value that is not an address of the network's kind is not sent.
  assert.deepEqual(buildSubjects([...ALL], SOL, EVM), []);
  assert.deepEqual(buildSubjects([...ALL], "0x1234", "abc"), []);
  assert.equal(subjectsParam(SUBJECTS), `196:${EVM},1:${EVM},8453:${EVM},501:${SOL}`);
  const url = new URL(portfolioPath(SUBJECTS), "https://app.example");
  assert.equal(url.pathname, "/api/onchainos/portfolio");
  assert.deepEqual([...url.searchParams.keys()], ["subjects"]);
  assert.equal(url.searchParams.get("subjects"), subjectsParam(SUBJECTS));
  const quote = new URL(quotePath(), "https://app.example");
  assert.equal(quote.pathname, "/api/onchainos/quote");
  assert.deepEqual([...quote.searchParams.entries()], [["from", "WOKB"], ["amount", "1000000000000000000"]]);
});

/* ---------- decimal strings ---------- */

test("sums are exact, beyond what a floating point number holds", () => {
  assert.equal(addDecimalStrings(["0.1", "0.2"]), "0.3");
  assert.equal(addDecimalStrings(["10000000000000000000.000000000000000001", "0.000000000000000001"]), "10000000000000000000.000000000000000002");
  assert.equal(addDecimalStrings(["9007199254740993", "1"]), "9007199254740994");
  assert.equal(addDecimalStrings(["1284.513", "310.07", "95.4", "2110.04"]), "3800.023");
  assert.equal(addDecimalStrings(["0.50", "0.50"]), "1");
  assert.equal(addDecimalStrings(["0"]), "0");
  assert.equal(addDecimalStrings(["007.10", "0.9"]), "8");
  assert.equal(addDecimalStrings([]), "0");
});

test("display truncates toward zero, groups thousands and never shows a positive amount as zero", () => {
  assert.equal(formatDecimalString("9007199254740993.120003400000000001", 6), "9,007,199,254,740,993.120003");
  assert.equal(formatDecimalString("1.999999999", 6), "1.999999");
  assert.equal(formatDecimalString("0.000000000000000001", 6), "<0.000001");
  assert.equal(formatDecimalString("0", 6), "0");
  assert.equal(formatDecimalString("0.000", 6), "0");
  assert.equal(formatDecimalString("12.5", 6), "12.5");
  assert.equal(formatDecimalString("0012.50", 6), "12.5");
  assert.equal(formatUsdString("1284.513"), "$1,284.51");
  assert.equal(formatUsdString("1284.519"), "$1,284.51");
  assert.equal(formatUsdString("3"), "$3.00");
  assert.equal(formatUsdString("0"), "$0.00");
  assert.equal(formatUsdString("0.004"), "<$0.01");
  assert.equal(formatUsdString("10000000000000000000.000000000000000001"), "$10,000,000,000,000,000,000.00");
});

/* ---------- the answer ---------- */

test("a complete answer is kept as it is, per requested network and in the requested order", () => {
  const answer = body([...SUBJECTS].reverse().map((subject) => net(subject)));
  const result = parsePortfolioBody(answer, SUBJECTS);
  assert.equal(result.credentials, "present");
  assert.deepEqual(result.networks.map((network) => network.chainIndex), [...ALL]);
  for (const network of result.networks) {
    assert.equal(network.status, "ok");
    assert.equal(network.walletUsd, "3");
    assert.equal(network.observedAt, ISO);
    assert.equal(network.tokens.length, 1);
  }
  // The reader returns EVM addresses checksummed whatever case was asked: the same address either way.
  const lower = parsePortfolioBody(body([net(SUBJECTS[0]!)]), [{ chainIndex: "196", address: EVM.toLowerCase() }]);
  assert.equal(lower.networks[0]?.status, "ok");
  // A native token has no contract address.
  const native = parsePortfolioBody(body([net(SUBJECTS[1]!, { tokens: [token({ tokenAddress: null, isNative: true, symbol: "ETH", rawBalance: null, priceUsd: null })] })]), [SUBJECTS[1]!]);
  assert.deepEqual(native.networks[0]?.tokens, [{ tokenAddress: null, symbol: "ETH", balance: "1.5", rawBalance: null, priceUsd: null, isNative: true }]);
  // "ok" without an estimate is kept: the estimate is unknown, not zero.
  assert.equal(parsePortfolioBody(body([net(SUBJECTS[0]!, { walletUsd: null })]), [SUBJECTS[0]!]).networks[0]?.walletUsd, null);
});

test("every status other than ok carries no holdings; empty keeps OKX's zero", () => {
  for (const status of OKX_STATUSES.filter((entry) => entry !== "ok")) {
    const result = parsePortfolioBody(body([net(SUBJECTS[0]!, { status, reason: status === "empty" ? null : "provider-unavailable", walletUsd: status === "empty" ? "0" : "999", tokens: status === "empty" ? [] : [token()] })]), [SUBJECTS[0]!]);
    const network = result.networks[0]!;
    assert.equal(network.status, status);
    assert.deepEqual(network.tokens, []);
    assert.equal(network.walletUsd, status === "empty" ? "0" : null);
  }
});

test("fail closed per network: an answer for another address, a wrong shape or an inexact amount shows nothing of it", () => {
  const good = net(SUBJECTS[1]!);
  const cases: Array<[string, unknown]> = [
    ["missing network", null],
    ["another EVM address", net(SUBJECTS[0]!, { address: TOKEN })],
    ["another chain", net(SUBJECTS[0]!, { chainIndex: "1952" })],
    ["unknown status", net(SUBJECTS[0]!, { status: "fine" })],
    ["a reason that is a sentence", net(SUBJECTS[0]!, { status: "unavailable", reason: "Upstream said: quota exceeded for key ab12" })],
    ["exponent balance", net(SUBJECTS[0]!, { tokens: [token({ balance: "1e20" })] })],
    ["number balance", net(SUBJECTS[0]!, { tokens: [token({ balance: 1.5 })] })],
    ["negative balance", net(SUBJECTS[0]!, { tokens: [token({ balance: "-1" })] })],
    ["price with a currency sign", net(SUBJECTS[0]!, { tokens: [token({ priceUsd: "$2" })] })],
    ["raw units with a fraction", net(SUBJECTS[0]!, { tokens: [token({ rawBalance: "1.5" })] })],
    ["exponent estimate", net(SUBJECTS[0]!, { walletUsd: "1e20" })],
    ["number estimate", net(SUBJECTS[0]!, { walletUsd: 3 })],
    ["another estimate scope", net(SUBJECTS[0]!, { walletUsdScope: "all-assets" })],
    ["ok without tokens", net(SUBJECTS[0]!, { tokens: [] })],
    ["tokens not a list", net(SUBJECTS[0]!, { tokens: "SYN" })],
    ["token without an address that is not native", net(SUBJECTS[0]!, { tokens: [token({ tokenAddress: null })] })],
    ["a Solana mint on an EVM network", net(SUBJECTS[0]!, { tokens: [token({ tokenAddress: SOL })] })],
    ["a symbol with a control character", net(SUBJECTS[0]!, { tokens: [token({ symbol: "SY" + String.fromCharCode(0x202e) + "N" })] })],
    ["an empty symbol", net(SUBJECTS[0]!, { tokens: [token({ symbol: "" })] })],
    ["isNative as text", net(SUBJECTS[0]!, { tokens: [token({ isNative: "false" })] })],
    ["one bad token among good ones", net(SUBJECTS[0]!, { tokens: [token(), token({ balance: "NaN" })] })],
  ];
  for (const [label, bad] of cases) {
    const result = parsePortfolioBody(body(bad === null ? [good] : [bad, good]), [SUBJECTS[0]!, SUBJECTS[1]!]);
    assert.deepEqual(result.networks[0], { chainIndex: "196", address: EVM, status: "unavailable", reason: LOCAL_REASONS.invalid, observedAt: null, tokens: [], walletUsd: null }, label);
    // The other network of the same answer is unaffected.
    assert.equal(result.networks[1]?.status, "ok", label);
  }
  // Solana: case is part of the address.
  assert.equal(parsePortfolioBody(body([net(SUBJECTS[3]!, { address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" })]), [SUBJECTS[3]!]).networks[0]?.reason, LOCAL_REASONS.invalid);
  // The same network twice: which one would be shown? Neither.
  assert.equal(parsePortfolioBody(body([net(SUBJECTS[0]!), net(SUBJECTS[0]!, { walletUsd: "9" })]), [SUBJECTS[0]!]).networks[0]?.reason, LOCAL_REASONS.invalid);
});

test("an answer that is not the documented envelope shows nothing at all", () => {
  for (const bad of [null, "text", [], {}, body([net(SUBJECTS[0]!)], { schema: "peridot.okx-portfolio/v2" }), body([net(SUBJECTS[0]!)], { credentials: "maybe" }), body("networks" as unknown as unknown[]), body([...SUBJECTS, SUBJECTS[0]!].map((subject) => net(subject!)))]) {
    const result = parsePortfolioBody(bad, SUBJECTS);
    assert.equal(result.credentials, "unknown");
    assert.deepEqual(result.networks.map((network) => [network.status, network.reason, network.tokens.length, network.walletUsd]), SUBJECTS.map(() => ["unavailable", LOCAL_REASONS.invalid, 0, null]));
  }
  // "Credentials missing" with holdings contradicts itself.
  const contradiction = parsePortfolioBody(body([net(SUBJECTS[0]!)], { credentials: "missing" }), [SUBJECTS[0]!]);
  assert.equal(contradiction.networks[0]?.reason, LOCAL_REASONS.invalid);
});

test("only a 200 can carry holdings", () => {
  const good = body(SUBJECTS.map((subject) => net(subject)));
  assert.equal(portfolioFromAnswer(200, good, SUBJECTS).networks.every((network) => network.status === "ok"), true);
  for (const [status, reason] of [[400, LOCAL_REASONS.refused], [404, LOCAL_REASONS.route], [500, LOCAL_REASONS.route], [503, LOCAL_REASONS.route], [201, LOCAL_REASONS.route]] as const) {
    const result = portfolioFromAnswer(status, good, SUBJECTS);
    assert.equal(result.credentials, "unknown");
    assert.deepEqual(result.networks.map((network) => [network.status, network.reason, network.walletUsd]), SUBJECTS.map(() => ["unavailable", reason, null]));
  }
});

/* ---------- words, time, totals ---------- */

test("every status has words, and none of them is a provider's sentence", () => {
  assert.equal(statusWords("unsupported", "unsupported-chain").detail, "OKX doesn't support this network for balances.");
  assert.equal(statusWords("unavailable", "provider-unavailable").label, "Not available right now");
  assert.match(statusWords("unavailable", "credentials-missing").detail ?? "", /no OKX read access configured/);
  assert.match(statusWords("unavailable", LOCAL_REASONS.invalid).detail ?? "", /not in the expected format/);
  assert.match(statusWords("unavailable", "some-new-code").detail ?? "", /OKX did not answer/);
  assert.match(statusWords("empty", null).detail ?? "", /returned no tokens/);
  assert.equal(statusWords("ok", null).detail, null);
  for (const status of OKX_STATUSES) {
    const words = statusWords(status, null);
    assert.ok(words.label.length > 0 && words.label.length <= 28, status);
    if (status !== "ok") assert.ok((words.detail ?? "").length > 20, status);
  }
  assert.match(statusWords("not-entitled", "not-entitled", "quotes").detail ?? "", /quotes/);
  // A quote has no address and no balances: its words do not mention either.
  for (const reason of [LOCAL_REASONS.invalid, "provider-unavailable", null]) assert.doesNotMatch(statusWords("unavailable", reason, "quotes").detail ?? "", /address|balances/);
  assert.match(statusWords("unavailable", LOCAL_REASONS.invalid, "quotes").detail ?? "", /not a complete quote for exactly this pair and amount/);
});

test("an observation is stale after five minutes, and an unknown time is stale", () => {
  assert.deepEqual(observation(ISO, NOW), { text: "28 Nov, 12:00 UTC", stale: false, minutes: 0 });
  assert.equal(observation(ISO, NOW + STALE_AFTER_MS).stale, false);
  assert.deepEqual(observation(ISO, NOW + STALE_AFTER_MS + 1), { text: "28 Nov, 12:00 UTC", stale: true, minutes: 5 });
  assert.equal(observation(ISO, NOW + 12 * 60_000).minutes, 12);
  // A clock that is behind the server's does not produce a negative age.
  assert.deepEqual(observation(ISO, NOW - 60_000), { text: "28 Nov, 12:00 UTC", stale: false, minutes: 0 });
  assert.deepEqual(observation(null, NOW), { text: "Time not reported", stale: true, minutes: null });
  assert.equal(observation("yesterday", NOW).stale, true);
});

test("the cross-network total counts only ok networks with an estimate, exactly, and is partial otherwise", () => {
  const complete = crossNetworkTotal([view("196", "ok", "1284.513"), view("1", "ok", "2110.04"), view("8453", "ok", "310.07"), view("501", "ok", "95.4")]);
  assert.deepEqual(complete, { usd: "3800.023", counted: ["196", "1", "8453", "501"], notCounted: [], partial: false });
  // Every other status makes it partial, and contributes nothing.
  for (const status of OKX_STATUSES.filter((entry) => entry !== "ok")) {
    const total = crossNetworkTotal([view("196", "ok", "10.5"), view("1", status, status === "empty" ? "0" : null)]);
    assert.deepEqual(total, { usd: "10.5", counted: ["196"], notCounted: ["1"], partial: true }, status);
  }
  // An ok network without an estimate is unknown, not zero.
  assert.deepEqual(crossNetworkTotal([view("196", "ok", "10.5"), view("1", "ok", null)]), { usd: "10.5", counted: ["196"], notCounted: ["1"], partial: true });
  // Nothing counted: no total at all, not $0.
  assert.deepEqual(crossNetworkTotal([view("196", "unavailable", null), view("501", "empty", "0")]), { usd: null, counted: [], notCounted: ["196", "501"], partial: true });
  assert.deepEqual(crossNetworkTotal([]), { usd: null, counted: [], notCounted: [], partial: false });
  // Exact, where a floating point sum would not be.
  assert.equal(crossNetworkTotal([view("196", "ok", "10000000000000000000.000000000000000001"), view("1", "ok", "0.1"), view("8453", "ok", "0.2")]).usd, "10000000000000000000.300000000000000001");
  // The function has no input for a testnet value: only the networks of an OKX answer can be summed.
  assert.equal(crossNetworkTotal.length, 1);
});

/* ---------- the quote ---------- */

const quote = (change: Record<string, unknown> = {}) => ({ schema: "peridot.okx-quote/v1", status: "ok", reason: null, chainId: 196, tokenIn: INDICATIVE_QUOTE.tokenIn, amountIn: INDICATIVE_QUOTE.amountIn, tokenOut: INDICATIVE_QUOTE.tokenOut, amountOut: "51234500", observedAt: ISO, ...change });

test("a quote shows a number only for a complete answer to exactly the question asked", () => {
  assert.deepEqual(parseQuoteBody(quote()), { status: "ok", amountIn: "1 WOKB", amountOut: "51.2345 USDC", observedAt: ISO });
  assert.deepEqual(parseQuoteBody(quote({ amountOut: "1" })), { status: "ok", amountIn: "1 WOKB", amountOut: "0.000001 USDC", observedAt: ISO });
  // Checksummed or lower-case identities are the same token.
  assert.equal(parseQuoteBody(quote({ tokenIn: "0xE538905CF8410324E03A5A23C1C177A474D59B2B".replace("0X", "0x") })).status, "ok");
  for (const [label, change] of [
    ["another chain", { chainId: 1952 }],
    ["chain as text", { chainId: "196" }],
    ["another input token", { tokenIn: INDICATIVE_QUOTE.tokenOut }],
    ["another output token", { tokenOut: "0x00000000000000000000000000000000000000EE" }],
    ["another input amount", { amountIn: "2000000000000000000" }],
    ["zero output", { amountOut: "0" }],
    ["decimal output", { amountOut: "51.2345" }],
    ["number output", { amountOut: 51234500 }],
    ["null output", { amountOut: null }],
    ["no time", { observedAt: null }],
    ["a time that is not one", { observedAt: "now" }],
    ["another schema", { schema: "peridot.okx-quote/v2" }],
    ["a status a quote cannot have", { status: "empty" }],
    ["an unknown status", { status: "great" }],
  ] as const) {
    const result = parseQuoteBody(quote(change));
    assert.deepEqual(result, { status: "unavailable", reason: LOCAL_REASONS.invalid, observedAt: null }, label);
  }
  assert.deepEqual(parseQuoteBody(quote({ status: "unavailable", reason: "credentials-missing", amountOut: null })), { status: "unavailable", reason: "credentials-missing", observedAt: ISO });
  assert.deepEqual(parseQuoteBody(quote({ status: "rate-limited", reason: "rate-limited", amountOut: "51234500" })), { status: "rate-limited", reason: "rate-limited", observedAt: ISO });
  assert.deepEqual(quoteFromAnswer(400, quote()), { status: "unavailable", reason: LOCAL_REASONS.refused, observedAt: null });
  assert.deepEqual(quoteFromAnswer(500, quote()), { status: "unavailable", reason: LOCAL_REASONS.route, observedAt: null });
  assert.equal(quoteFromAnswer(200, quote()).status, "ok");
});

/* ---------- the synthetic scenarios of an example-data build ---------- */

test("the example scenarios cover every status, the missing-credentials answer, a rejected answer and a refused request", () => {
  const seen = new Set<string>();
  const reasons = new Set<string>();
  let stale = 0;
  for (const scenario of OKX_FIXTURE_SCENARIOS) {
    const answer = fixturePortfolio(scenario, SUBJECTS, NOW);
    const result = portfolioFromAnswer(answer.status, answer.body, SUBJECTS);
    assert.equal(result.networks.length, 4, scenario);
    for (const network of result.networks) {
      seen.add(network.status);
      if (network.reason) reasons.add(network.reason);
      if (network.status === "ok" && observation(network.observedAt, NOW).stale) stale++;
    }
    if (scenario === "missing") assert.equal(result.credentials, "missing");
    if (scenario === "complete") assert.deepEqual(crossNetworkTotal(result.networks), { usd: "3800.023", counted: ["196", "1", "8453", "501"], notCounted: [], partial: false });
    if (scenario === "mixed") assert.deepEqual(crossNetworkTotal(result.networks), { usd: "1284.513", counted: ["196"], notCounted: ["1", "8453", "501"], partial: true });
    if (scenario === "malformed") assert.deepEqual(result.networks.map((network) => network.reason), [LOCAL_REASONS.invalid, LOCAL_REASONS.invalid, null, null]);
    if (scenario === "refused") assert.equal(result.networks.every((network) => network.reason === LOCAL_REASONS.refused), true);
  }
  assert.deepEqual([...seen].sort(), [...OKX_STATUSES].sort());
  for (const reason of ["credentials-missing", "unsupported-chain", "not-entitled", "rate-limited", "provider-unavailable", LOCAL_REASONS.invalid, LOCAL_REASONS.refused]) assert.equal(reasons.has(reason), true, reason);
  assert.ok(stale >= 1);
  // The quote scenarios: a number, a stale number, and three ways of no number.
  const quotes = Object.fromEntries(OKX_FIXTURE_SCENARIOS.map((scenario) => [scenario, quoteFromAnswer(fixtureQuote(scenario, NOW).status, fixtureQuote(scenario, NOW).body)]));
  assert.equal(quotes.mixed?.status, "ok");
  assert.equal(quotes.complete?.status === "ok" && NOW - Date.parse(quotes.complete.observedAt) > STALE_AFTER_MS, true);
  assert.deepEqual([quotes.limited?.status, quotes.missing?.status, quotes.malformed?.status, quotes.refused?.status], ["rate-limited", "unavailable", "unavailable", "unavailable"]);
  assert.equal(parseOkxScenario("mixed"), "mixed");
  for (const value of [null, undefined, "", "on", "MIXED", "live"]) assert.equal(parseOkxScenario(value), null);
});

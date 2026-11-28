import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePortfolioBody, parseQuoteBody } from "./okx-portfolio.ts";
import { type OkxHandler, type OkxHandlerDeps, okxCacheControl, okxRespond, reportsMissingCredentials } from "./okx-route.ts";

const PORTFOLIO = "public, s-maxage=60, stale-while-revalidate=60";
const QUOTE = "public, s-maxage=15, stale-while-revalidate=15";
const deps: OkxHandlerDeps = { env: {}, fetch: () => Promise.reject(new Error("no network in tests")), now: () => Date.parse("2026-11-28T12:00:00Z") };
const request = (query = "") => new Request(`https://app.example/api/onchainos/x${query}`);
const fixed = (status: number, body: unknown): OkxHandler => async () => ({ status, body });
const present = { schema: "peridot.okx-portfolio/v1", source: "OKX Onchain OS", credentials: "present", requestedAt: "2026-11-28T12:00:00.000Z", networks: [] };
const quoteOk = { schema: "peridot.okx-quote/v1", status: "ok", reason: null, chainId: 196, amountOut: "1" };

test("a 200 of the expected schema is cacheable: 60 s for the portfolio, 15 s for the quote", async () => {
  const portfolio = await okxRespond("portfolio", fixed(200, present), request(), deps);
  assert.equal(portfolio.status, 200);
  assert.equal(portfolio.headers.get("cache-control"), PORTFOLIO);
  assert.match(portfolio.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(portfolio.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await portfolio.json(), present);
  const quote = await okxRespond("quote", fixed(200, quoteOk), request(), deps);
  assert.equal(quote.headers.get("cache-control"), QUOTE);
  // A 200 that reports a per-network or provider failure is still a 200 of the schema.
  assert.equal(okxCacheControl("portfolio", 200, { ...present, networks: [{ status: "rate-limited", reason: "rate-limited" }] }), PORTFOLIO);
  assert.equal(okxCacheControl("quote", 200, { ...quoteOk, status: "unavailable", reason: "provider-unavailable", amountOut: null }), QUOTE);
});

test("an answer that reports missing credentials is never cached, although it is a 200", async () => {
  const missing = { ...present, credentials: "missing", networks: [{ chainIndex: "196", status: "unavailable", reason: "credentials-missing" }] };
  const response = await okxRespond("portfolio", fixed(200, missing), request(), deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(okxCacheControl("quote", 200, { ...quoteOk, status: "unavailable", reason: "credentials-missing", amountOut: null }), "no-store");
  // Each of the three places such an answer can say it.
  assert.equal(reportsMissingCredentials({ credentials: "missing" }), true);
  assert.equal(reportsMissingCredentials({ reason: "credentials-missing" }), true);
  assert.equal(reportsMissingCredentials({ credentials: "present", networks: [{ reason: null }, { reason: "credentials-missing" }] }), true);
  assert.equal(reportsMissingCredentials(present), false);
  assert.equal(reportsMissingCredentials(null), false);
});

test("anything that is not a 200 of the schema is no-store, with the reader's status and body", async () => {
  const refused = await okxRespond("portfolio", fixed(400, { error: "Invalid request" }), request("?subjects=nonsense"), deps);
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.get("cache-control"), "no-store");
  assert.deepEqual(await refused.json(), { error: "Invalid request" });
  for (const status of [401, 404, 429, 500, 503]) {
    const response = await okxRespond("quote", fixed(status, { error: "x" }), request(), deps);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  // A 200 whose body is another route's schema, or no schema at all.
  assert.equal(okxCacheControl("portfolio", 200, quoteOk), "no-store");
  assert.equal(okxCacheControl("quote", 200, present), "no-store");
  assert.equal(okxCacheControl("portfolio", 200, {}), "no-store");
});

test("a reader that throws or returns nonsense becomes a fixed 500 without detail", async () => {
  const secret = "detail-that-must-not-leave-the-server";
  const cases: OkxHandler[] = [
    async () => {
      throw new Error(secret);
    },
    () => {
      throw new Error(secret);
    },
    fixed(200, null),
    fixed(200, "text"),
    fixed(200, [1]),
    fixed(302, { location: secret }),
    fixed(204, {}),
    fixed(Number.NaN, {}),
    fixed(200.5, {}),
    (async () => undefined) as unknown as OkxHandler,
    (async () => ({ status: "200", body: {} })) as unknown as OkxHandler,
  ];
  for (const handler of cases) {
    for (const kind of ["portfolio", "quote"] as const) {
      const response = await okxRespond(kind, handler, request(), deps);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const text = await response.text();
      assert.equal(text.includes(secret), false);
      assert.deepEqual(JSON.parse(text), { schema: kind === "portfolio" ? "peridot.okx-portfolio/v1" : "peridot.okx-quote/v1", error: "unavailable" });
    }
  }
});

test("the reader receives the request's query and exactly the injected dependencies", async () => {
  let seen: { query: string; deps: OkxHandlerDeps } | null = null;
  const handler: OkxHandler = async (searchParams, given) => {
    seen = { query: searchParams.toString(), deps: given };
    return { status: 200, body: present };
  };
  await okxRespond("portfolio", handler, request("?subjects=196%3A0xabc&extra=1&subjects=again"), deps);
  assert.ok(seen);
  const got = seen as { query: string; deps: OkxHandlerDeps };
  // Nothing is added, dropped or reordered: refusing extra or repeated parameters is the reader's job.
  assert.equal(got.query, "subjects=196%3A0xabc&extra=1&subjects=again");
  assert.equal(got.deps, deps);
});

/* ---------- the real reader behind the wrapper (synthetic transport, fake credentials) ---------- */

type Reader = { handlePortfolio: OkxHandler; handleQuote: OkxHandler };
// A computed specifier: the reader is plain JavaScript outside this package (services/onchainos), typed in src/types.
const reader = (await import(new URL("../../../../services/onchainos/reader.mjs", import.meta.url).href)) as Reader;
const EVM = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const TOKEN = "0x1234567890abcdef1234567890abcdef12345678";
const FAKE = { OKX_API_KEY: "SyntheticKeyForTests", OKX_API_SECRET: "SyntheticSecretForTests", OKX_API_PASSPHRASE: "SyntheticPassphraseForTests" };
const BALANCE = "9007199254740993.120003400000000001";
const WALLET_USD = "10000000000000000000.000000000000000001";

/** A transport that answers the four upstream reads the way OKX documents them. Every value is synthetic. */
function transport() {
  const calls: string[] = [];
  const ok = (data: unknown) => Response.json({ code: "0", data });
  const fetcher = (async (resource: string | URL | Request) => {
    const url = new URL(String(resource));
    assert.equal(url.origin, "https://web3.okx.com");
    calls.push(url.pathname);
    const q = url.searchParams;
    if (url.pathname.endsWith("/balance/supported/chain")) return ok(["196", "1", "8453", "501"].map((chainIndex) => ({ chainIndex })));
    if (url.pathname.endsWith("/all-token-balances-by-address")) return ok([{ tokenAssets: [{ chainIndex: q.get("chains"), address: q.get("address"), tokenContractAddress: TOKEN, symbol: "SYN", balance: BALANCE, rawBalance: "", tokenPrice: "", isRiskToken: false }] }]);
    if (url.pathname.endsWith("/total-value-by-address")) return ok([{ totalValue: WALLET_USD }]);
    if (url.pathname.endsWith("/aggregator/quote")) return ok([{ chainIndex: "196", fromToken: { tokenContractAddress: q.get("fromTokenAddress") }, toToken: { tokenContractAddress: q.get("toTokenAddress") }, fromTokenAmount: q.get("amount"), toTokenAmount: "51234500" }]);
    throw new Error("unexpected synthetic route");
  }) as typeof fetch;
  return { calls, fetcher };
}

test("real reader, no credentials: 200, credentials missing, no-store, no upstream request, and the page shows nothing", async () => {
  const { calls, fetcher } = transport();
  const local: OkxHandlerDeps = { env: {}, fetch: fetcher, now: () => Date.parse("2026-11-28T12:00:00Z") };
  const subjects = [{ chainIndex: "196" as const, address: EVM }, { chainIndex: "1" as const, address: EVM }];
  const response = await okxRespond("portfolio", reader.handlePortfolio, request(`?subjects=196:${EVM},1:${EVM}`), local);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.credentials, "missing");
  const view = parsePortfolioBody(body, subjects);
  assert.equal(view.credentials, "missing");
  assert.deepEqual(view.networks.map((network) => [network.status, network.reason, network.walletUsd, network.tokens.length]), [["unavailable", "credentials-missing", null, 0], ["unavailable", "credentials-missing", null, 0]]);
  const quote = await okxRespond("quote", reader.handleQuote, request("?from=WOKB&amount=1000000000000000000"), local);
  assert.equal(quote.status, 200);
  assert.equal(quote.headers.get("cache-control"), "no-store");
  assert.deepEqual(parseQuoteBody(await quote.json()), { status: "unavailable", reason: "credentials-missing", observedAt: "2026-11-28T12:00:00.000Z" });
  assert.equal(calls.length, 0);
});

test("real reader, refused requests: 400 with its fixed body, no-store, no upstream request", async () => {
  const { calls, fetcher } = transport();
  const local: OkxHandlerDeps = { env: { ...FAKE }, fetch: fetcher, now: () => Date.parse("2026-11-28T12:00:00Z") };
  for (const [kind, handler, query] of [
    ["portfolio", reader.handlePortfolio, ""],
    ["portfolio", reader.handlePortfolio, "?subjects=1952:" + EVM],
    ["portfolio", reader.handlePortfolio, `?subjects=196:${EVM}&cachebuster=1`],
    ["portfolio", reader.handlePortfolio, `?subjects=196:${EVM}&subjects=1:${EVM}`],
    ["quote", reader.handleQuote, "?from=WOKB"],
    ["quote", reader.handleQuote, "?from=USDG&amount=1"],
    ["quote", reader.handleQuote, "?from=WOKB&amount=1.5"],
  ] as const) {
    const response = await okxRespond(kind, handler, request(query), local);
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
    assert.deepEqual(await response.json(), { error: "Invalid request" });
  }
  assert.equal(calls.length, 0);
});

test("real reader, synthetic credentials and transport: cacheable 200s that this app's own checks accept", async () => {
  const { calls, fetcher } = transport();
  const local: OkxHandlerDeps = { env: { ...FAKE }, fetch: fetcher, now: () => Date.parse("2026-11-28T12:00:00Z") };
  const subjects = [{ chainIndex: "196" as const, address: EVM }, { chainIndex: "8453" as const, address: EVM }];
  const response = await okxRespond("portfolio", reader.handlePortfolio, request(`?subjects=196:${EVM},8453:${EVM}`), local);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), PORTFOLIO);
  const text = await response.text();
  for (const value of Object.values(FAKE)) assert.equal(text.includes(value), false);
  const view = parsePortfolioBody(JSON.parse(text), subjects);
  assert.equal(view.credentials, "present");
  for (const network of view.networks) {
    assert.equal(network.status, "ok");
    assert.equal(network.walletUsd, WALLET_USD);
    assert.equal(network.observedAt, "2026-11-28T12:00:00.000Z");
    assert.deepEqual(network.tokens.map((token) => [token.tokenAddress?.toLowerCase(), token.symbol, token.balance, token.rawBalance, token.priceUsd, token.isNative]), [[TOKEN, "SYN", BALANCE, null, null, false]]);
  }
  assert.ok(calls.length > 0);
  const quote = await okxRespond("quote", reader.handleQuote, request("?from=WOKB&amount=1000000000000000000"), local);
  assert.equal(quote.status, 200);
  assert.equal(quote.headers.get("cache-control"), QUOTE);
  assert.deepEqual(parseQuoteBody(await quote.json()), { status: "ok", amountIn: "1 WOKB", amountOut: "51.2345 USDC", observedAt: "2026-11-28T12:00:00.000Z" });
});

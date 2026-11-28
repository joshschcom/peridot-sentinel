/**
 * Read-only wallet tokens on X Layer, Ethereum, Base and Solana mainnet through OKX Onchain OS (DECISIONS D25).
 *
 *   GET /api/onchainos/portfolio?subjects=<chainIndex>:<address>[,…]     one to four subjects; chainIndex 196, 1, 8453 or 501
 *
 *   - GET only (no other method is exported, so Next answers 405 for the rest). Node runtime, never prerendered.
 *   - A thin wrapper: the reader (services/onchainos/reader.mjs) validates the query, allowlists the upstream reads,
 *     signs them with the server's credentials, rate limits, and returns a fixed schema that carries no provider
 *     text. This file only hands it the query, the server environment, `fetch` and the clock.
 *   - The credentials are sensitive server-side variables of the deployment. No name here starts with NEXT_PUBLIC_,
 *     and this file reads none of them itself.
 *   - The same `fetch` and `Date.now` references go to both routes: the reader keys its shared cache and rate
 *     limiter on them.
 *   - Status and caching headers: src/lib/okx-route.ts. An answer without credentials is never cached.
 *
 * The route exists in every deployment. Whether a page offers it is decided by src/lib/okx-switches.ts.
 */
import { handlePortfolio } from "@onchainos/reader.mjs";
import { okxRespond } from "@/lib/okx-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return okxRespond("portfolio", handlePortfolio, request, { env: process.env, fetch, now: Date.now });
}

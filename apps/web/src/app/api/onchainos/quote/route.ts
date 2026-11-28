/**
 * Indicative price of the fixed WOKB/USDC pair on X Layer mainnet (chain 196) through OKX Onchain OS (DECISIONS D25).
 *
 *   GET /api/onchainos/quote?from=WOKB|USDC&amount=<positive raw integer>
 *
 * Information only: not an offer, not executable here, and unrelated to the testnet swaps of this app, which use the
 * testnet venue's mock price. Everything else is as in ../portfolio/route.ts: GET only, Node runtime, a thin wrapper
 * around the reader with the same `fetch` and clock references, headers from src/lib/okx-route.ts.
 */
import { handleQuote } from "@onchainos/reader.mjs";
import { okxRespond } from "@/lib/okx-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return okxRespond("quote", handleQuote, request, { env: process.env, fetch, now: Date.now });
}

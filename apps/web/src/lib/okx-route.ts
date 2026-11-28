/**
 * What the two OKX Onchain OS routes (app/api/onchainos/portfolio and quote) add to the reader they wrap: the HTTP
 * status and the caching headers. Everything else is the reader's (services/onchainos/reader.mjs): which upstream
 * reads exist, input validation, signing, rate limiting, its own short cache and the fixed answer schema.
 *
 * Pure (a Request in, a Response out, the handler injected), so it runs in node tests. This file names no
 * credential: the routes hand the server's environment to the reader, and only the reader looks inside it.
 *
 * Caching:
 *   - Only a 200 of the expected schema may be cached by a shared cache (60 s for the portfolio, 15 s for the quote).
 *   - An answer that says the deployment has no credentials is never cached, even though it is a 200: once the
 *     credentials are set, the next request must reach the reader.
 *   - Everything else (a refused request, a failure) is `no-store`.
 */
export type OkxRouteKind = "portfolio" | "quote";

export interface OkxHandlerDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
}
export interface OkxHandlerResult {
  status: number;
  body: unknown;
}
export type OkxHandler = (searchParams: URLSearchParams, deps: OkxHandlerDeps) => Promise<OkxHandlerResult> | OkxHandlerResult;

const ROUTE: Record<OkxRouteKind, { schema: string; maxAge: number }> = {
  portfolio: { schema: "peridot.okx-portfolio/v1", maxAge: 60 },
  quote: { schema: "peridot.okx-quote/v1", maxAge: 15 },
};
const MISSING = "credentials-missing";
const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** Does this answer say, anywhere, that the deployment has no OKX credentials? */
export function reportsMissingCredentials(body: unknown): boolean {
  const answer = record(body);
  if (!answer) return false;
  if (answer.credentials === "missing" || answer.reason === MISSING) return true;
  return Array.isArray(answer.networks) && answer.networks.some((network) => record(network)?.reason === MISSING);
}

export function okxCacheControl(kind: OkxRouteKind, status: number, body: unknown): string {
  const { schema, maxAge } = ROUTE[kind];
  const cacheable = status === 200 && record(body)?.schema === schema && !reportsMissingCredentials(body);
  return cacheable ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` : "no-store";
}

const json = (kind: OkxRouteKind, status: number, body: unknown): Response =>
  Response.json(body, { status, headers: { "cache-control": okxCacheControl(kind, status, body), "x-content-type-options": "nosniff" } });

/**
 * The reader's status and body, unchanged, with the caching header. A reader that throws, or returns something that
 * is not a status with a body, becomes a fixed 500 that carries no detail.
 */
export async function okxRespond(kind: OkxRouteKind, handler: OkxHandler, request: Request, deps: OkxHandlerDeps): Promise<Response> {
  const failure = () => json(kind, 500, { schema: ROUTE[kind].schema, error: "unavailable" });
  let result: OkxHandlerResult;
  try {
    result = await handler(new URL(request.url).searchParams, deps);
  } catch {
    return failure();
  }
  const status = record(result)?.status;
  if (typeof status !== "number" || !Number.isInteger(status) || !(status === 200 || (status >= 400 && status <= 599)) || record(result.body) === null) return failure();
  return json(kind, status, result.body);
}

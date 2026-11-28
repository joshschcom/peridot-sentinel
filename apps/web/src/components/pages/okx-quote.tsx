"use client";
/**
 * Trade, "Indicative X Layer mainnet price (OKX)": what 1 WOKB fetches in USDC on X Layer MAINNET, as OKX Onchain OS
 * quotes it through this app's own server route (DECISIONS D25).
 *
 * It is information next to a testnet page, and says so: not an offer, nothing here can execute it, and the testnet
 * swaps on the same page use the testnet venue's mock price, which this number does not touch. A number is shown
 * only for a complete answer to exactly that question (src/lib/okx-portfolio.ts); otherwise a status in words.
 *
 * Behind the committed QUOTE switch (src/lib/okx-switches.ts): off, this component renders nothing and asks nothing.
 * The request names no address, so it is made when the card appears; it is not repeated on a timer or on focus.
 * A build pinned to example data never calls the route and shows a labelled example only for `?okx=<scenario>`.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardHeader, ExampleTag, Skeleton } from "@/components/ui/core";
import { STALE_AFTER_MS, statusWords } from "@/lib/okx-portfolio";
import { OKX_SWITCHES } from "@/lib/okx-switches";
import { OKX_SOURCE, readIndicativeQuote } from "@/services/okx";
import { useNow, useOkxScenario } from "./other-networks";

export const OKX_QUOTE_TITLE = "Indicative X Layer mainnet price (OKX)";
export const OKX_QUOTE_CAVEAT = "Informational, not an offer, does not affect testnet swaps.";
/** True when this build shows the card without an example scenario. Trade words its "not yet" list by it. */
export const OKX_QUOTE_ON = OKX_SOURCE === "route" && OKX_SWITCHES.quote;
const utc = (iso: string) => `${iso.slice(0, 19).replace("T", " ")} UTC`;

export function OkxQuote() {
  const scenario = useOkxScenario();
  const example = OKX_SOURCE === "example";
  const shown = example ? scenario !== null || OKX_SWITCHES.quote : OKX_SWITCHES.quote;
  const quote = useQuery({ queryKey: ["okx-quote", OKX_SOURCE, scenario], queryFn: ({ signal }) => readIndicativeQuote(scenario, signal), enabled: shown, staleTime: Number.POSITIVE_INFINITY, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, retry: false });
  const now = useNow(shown && quote.data?.status === "ok");
  if (!shown) return null;
  const data = quote.data;
  const stale = data?.status === "ok" && now - Date.parse(data.observedAt) > STALE_AFTER_MS;
  const words = data && data.status !== "ok" ? statusWords(data.status, data.reason, "quotes") : null;
  return (
    <Card as="section" data-testid="okx-quote" data-state={quote.isPending || quote.isFetching ? "loading" : (data?.status ?? "unavailable")} data-reason={data && data.status !== "ok" ? (data.reason ?? "") : ""} data-source={OKX_SOURCE} data-stale={String(stale)}>
      <CardHeader eyebrow="X Layer mainnet (chain 196) · read-only via OKX Onchain OS" title={OKX_QUOTE_TITLE} description="What one WOKB fetches in USDC on X Layer mainnet according to OKX's aggregator, shown for reference next to the testnet figures." action={example ? <ExampleTag /> : <Badge tone="outline">Mainnet · information only</Badge>} />
      <div className="space-y-3 p-5 text-sm sm:p-6">
        {quote.isPending || quote.isFetching ? (
          <Skeleton className="h-14" data-loading />
        ) : data?.status === "ok" ? (
          <>
            <div className="num text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="okx-quote-amount">
              {data.amountIn} <span className="font-normal text-muted">≈</span> {data.amountOut}
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted" data-testid="okx-quote-observed">
              Observed {utc(data.observedAt)}
              {stale ? <Badge tone="warning">Stale · more than 5 min old</Badge> : null}
            </p>
          </>
        ) : (
          <p className="text-muted" data-testid="okx-quote-status">
            <span className="font-medium text-fg">{words?.label ?? "Not available right now"}.</span> {words?.detail ?? "The price could not be read."} No number is shown.
          </p>
        )}
        <p className="text-[0.8125rem] text-muted" data-testid="okx-quote-caveat">
          {OKX_QUOTE_CAVEAT} Swaps on this page use the testnet venue's mock price, which is unrelated to this number, and this app cannot execute a mainnet swap.
        </p>
        {example ? (
          <p className="text-[0.8125rem] text-warning">Example data: the number is invented and this build asks no server for it.</p>
        ) : (
          <Button size="sm" variant="secondary" disabled={quote.isFetching} onClick={() => void quote.refetch()} data-testid="okx-quote-refresh">
            Ask again
          </Button>
        )}
      </div>
    </Card>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { MarketBadges, TokenPair, marketTitle, tokenAmount, utilizationBps } from "@/components/domain/market-bits";
import { SourceTag } from "@/components/domain/policy-card";
import { Card, EmptyState, PageHeader, Skeleton, Value, cx } from "@/components/ui/core";
import { IconChevronRight } from "@/components/ui/icons";
import { useMarkets } from "@/hooks/use-data";
import { formatBps } from "@/lib/amount";
import { services } from "@/services";

type Filter = "all" | "active" | "inactive";

export function MarketsList() {
  const markets = useMarkets();
  const [filter, setFilter] = useState<Filter>("all");
  const list = markets.data?.status === "ok" ? markets.data.value : [];
  const shown = list.filter((market) => filter === "all" || (filter === "active") === market.active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Markets"
        description="Isolated lending markets. Each has its own books, limits and policy circuit, so one market can never draw on another's collateral."
        actions={<SourceTag source={services.market.source} />}
      />
      <div role="group" aria-label="Filter markets" className="flex gap-2">
        {(["all", "active", "inactive"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)} className={cx("h-9 rounded-full border px-4 text-sm font-medium capitalize", filter === option ? "border-fg bg-inverse text-on-inverse" : "border-line-strong text-muted hover:text-fg")}>
            {option}
          </button>
        ))}
      </div>

      {markets.isPending ? (
        <div className="space-y-3" data-loading>
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : markets.data?.status !== "ok" ? (
        <EmptyState title="Market data unavailable">{markets.data?.status === "unavailable" ? markets.data.reason : "Markets could not be loaded."}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No markets match this filter" />
      ) : (
        <ul className="space-y-3">
          {shown.map((market) => {
            const util = utilizationBps(market);
            return (
              <Card as="li" key={market.id} className="transition-colors hover:border-line-strong">
                <Link href={`/markets/${market.id}`} className="block rounded-card p-5 sm:p-6">
                  <div className="flex items-center gap-4">
                    <TokenPair market={market} />
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-semibold tracking-tight">{marketTitle(market)}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <MarketBadges market={market} />
                      </div>
                    </div>
                    <IconChevronRight size={20} className="shrink-0 text-faint" />
                  </div>
                  <dl className="num mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:grid-cols-5">
                    <Cell label="Supplied">
                      <Value of={market.debt.totalSupplied} short>{(v) => tokenAmount(v, market.debt.token, 0)}</Value>
                    </Cell>
                    <Cell label="Borrowed">
                      <Value of={market.debt.totalBorrowed} short>{(v) => tokenAmount(v, market.debt.token, 0)}</Value>
                    </Cell>
                    <Cell label="Borrow rate">
                      <Value of={market.debt.borrowAprBps} short>{(v) => `${formatBps(v)} APR`}</Value>
                    </Cell>
                    <Cell label="Utilisation">
                      <Value of={util} short>{(v) => formatBps(v, 1)}</Value>
                    </Cell>
                    <Cell label="Policy cap · limit">
                      {formatBps(market.policy.spec.params.maxLtvBps)} · {formatBps(market.limits.borrowLtvBps)}
                    </Cell>
                  </dl>
                </Link>
              </Card>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-faint">Rates are variable and come from each market's interest model. They are not a forecast or a promise of return.</p>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{children}</dd>
    </div>
  );
}

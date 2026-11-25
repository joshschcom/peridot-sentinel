"use client";
import Link from "next/link";
import { useState } from "react";
import { ActionPanel, type ActionTab } from "@/components/domain/action-panel";
import { LtvMeter } from "@/components/domain/ltv-meter";
import { Amount, MarketBadges, TokenPair, marketTitle, tokenAmount, usdOf, usdText, utilizationBps } from "@/components/domain/market-bits";
import { PolicyIdentity, PolicyRules, SourceTag, capText } from "@/components/domain/policy-card";
import { Badge, Button, Card, CardHeader, DefinitionRow, EmptyState, Notice, Skeleton, Stat, Value, cx } from "@/components/ui/core";
import { IconAlert, IconChevronRight } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { useAccount, useDirectPosition, useMarket } from "@/hooks/use-data";
import { formatBps, ltvBps, usdValueE18 } from "@/lib/amount";
import { formatTime } from "@/lib/format";
import { type Maybe, ok, unavailable } from "@/lib/maybe";
import { services } from "@/services";
import type { ActingPath, Market, Position, SentinelAccount } from "@/services/types";

export function positionLtv(market: Market, position: Position): Maybe<number> {
  if (position.debt === 0n) return ok(0);
  const c = market.collateral.price;
  const d = market.debt.price;
  if (c.status !== "ok" || d.status !== "ok") return unavailable("Price unavailable");
  const pledged = position.collateralEntered ? position.collateralSupplied : 0n;
  const value = ltvBps(usdValueE18(position.debt, market.debt.token.decimals, d.value.usdE18), usdValueE18(pledged, market.collateral.token.decimals, c.value.usdE18));
  return value === null ? unavailable("No eligible collateral") : ok(Number(value));
}

export function MarketDetail({ id }: { id: string }) {
  const market = useMarket(id);
  const account = useAccount(id);
  const direct = useDirectPosition(id);
  const [sheet, setSheet] = useState<ActionTab | null>(null);
  const [view, setView] = useState<ActingPath | null>(null);

  if (market.isPending) {
    return (
      <div className="space-y-6" data-loading>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (market.isError || market.data.status !== "ok") {
    return <EmptyState title="Market data unavailable">{market.data?.status === "unavailable" ? market.data.reason : "The market could not be loaded."}</EmptyState>;
  }
  const m = market.data.value;
  if (!m) {
    return (
      <EmptyState title="Market not found" action={<Link href="/markets" className="font-medium underline underline-offset-4">Back to markets</Link>}>
        No market with this identifier exists in the current data source.
      </EmptyState>
    );
  }

  const source = services.market.source;
  const sentinel: SentinelAccount | null = account.data?.status === "ok" ? account.data.value : null;
  const directPosition: Position | null = direct.data?.status === "ok" ? direct.data.value : null;
  const path: ActingPath = view ?? (sentinel ? "sentinel" : "direct");
  const position = path === "sentinel" ? (sentinel?.position ?? null) : directPosition;
  const ltv = position ? positionLtv(m, position) : unavailable<number>("No position");
  const util = utilizationBps(m);
  const panel = (tab: ActionTab) => <ActionPanel key={tab} market={m} account={sentinel} direct={directPosition} initialTab={tab} path={path} onPathChange={setView} />;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
        <Link href="/markets" className="rounded hover:text-fg">
          Markets
        </Link>
        <IconChevronRight size={14} />
        <span className="text-fg">{marketTitle(m)}</span>
      </nav>

      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <TokenPair market={m} size={44} />
        <div className="min-w-0">
          <h1 className="title">{marketTitle(m)}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <MarketBadges market={m} />
            <SourceTag source={source} />
          </div>
        </div>
      </header>

      {!m.active ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="This market is not active yet">
          It has been created but not activated. Activation needs seeded {m.debt.token.symbol} liquidity, a valid price feed and the owner's confirmation. Borrowing is closed until then.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23.5rem]">
        <div className="min-w-0 space-y-6">
          <Card className="grid grid-cols-2 gap-x-4 gap-y-6 p-5 sm:grid-cols-4 sm:p-6">
            <Stat label="Supplied" value={<Value of={m.debt.totalSupplied}>{(v) => <Amount value={v} token={m.debt.token} maxFractionDigits={0} />}</Value>} sub={usdText(usdOf(m.debt.totalSupplied, m.debt.token, m.debt.price), true)} />
            <Stat label="Borrowed" value={<Value of={m.debt.totalBorrowed}>{(v) => <Amount value={v} token={m.debt.token} maxFractionDigits={0} />}</Value>} sub={util.status === "ok" ? `${formatBps(util.value, 1)} utilised` : null} />
            <Stat label="Supply rate" value={<Value of={m.debt.supplyAprBps}>{(v) => formatBps(v)}</Value>} sub="APR (simple, variable)" />
            <Stat label="Borrow rate" value={<Value of={m.debt.borrowAprBps}>{(v) => formatBps(v)}</Value>} sub="APR (simple, variable)" />
          </Card>

          {/* Position */}
          <Card as="section">
            <CardHeader
              title="Your position"
              description="Loan-to-value is an estimate from the last accrued state and can change at execution."
              action={
                <div className="flex rounded-full bg-raised p-0.5 text-xs font-medium">
                  {(["sentinel", "direct"] as const).map((option) => (
                    <button key={option} type="button" aria-pressed={path === option} onClick={() => setView(option)} className={cx("h-8 rounded-full px-3", path === option ? "bg-bg ring-1 ring-line" : "text-muted")}>
                      {option === "sentinel" ? "Sentinel" : "Wallet"}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="p-5 sm:p-6">
              {position ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                    <Stat label="Collateral" value={<Amount value={position.collateralSupplied} token={m.collateral.token} />} sub={usdText(usdOf(ok(position.collateralSupplied), m.collateral.token, m.collateral.price))} />
                    <Stat label="Debt" value={<Amount value={position.debt} token={m.debt.token} />} sub={usdText(usdOf(ok(position.debt), m.debt.token, m.debt.price))} />
                    <Stat label="Loan-to-value" value={<Value of={ltv}>{(v) => formatBps(v)}</Value>} sub="Estimate" />
                    <Stat label={path === "sentinel" ? "Idle in account" : "In wallet"} value={<Amount value={position.idleDebtAsset} token={m.debt.token} />} sub={tokenAmount(position.idleCollateral, m.collateral.token)} />
                  </div>
                  <LtvMeter
                    className="mt-6"
                    value={ltv}
                    markers={[
                      ...(path === "sentinel" && sentinel?.policy.identified ? [{ bps: sentinel.policy.spec.params.maxLtvBps, label: "Your cap" }] : []),
                      ...(m.policy.identified ? [{ bps: m.policy.spec.params.maxLtvBps, label: "Market policy cap" }] : []),
                      { bps: m.limits.borrowLtvBps, label: "Borrowing limit", tone: "warning" as const },
                      { bps: m.limits.liquidationLtvBps, label: "Liquidation", tone: "danger" as const },
                    ]}
                  />
                  <p className="mt-4 text-[0.8125rem] text-muted">
                    Above <span className="num text-fg">{formatBps(m.limits.liquidationLtvBps)}</span> loan-to-value anyone can liquidate the position. Prices can move faster than you or any automation can react.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">{path === "sentinel" ? "You have no Sentinel account for this market." : "No position data for this wallet."}</p>
              )}
            </div>
          </Card>

          {/* Market policy */}
          <Card as="section" id="policy" className="scroll-mt-28">
            <CardHeader eyebrow="Set by the market owner" title="Market policy" description="Applies to every account and wallet using this market, including direct contract calls." action={<Badge tone="outline">{capText(m.policy)} cap</Badge>} />
            <div className="space-y-4 p-5 sm:p-6">
              <PolicyRules record={m.policy} />
              <PolicyIdentity record={m.policy} />
              <Link href="/circuits" className="inline-block text-sm font-medium underline underline-offset-4">
                How policy circuits are evaluated
              </Link>
            </div>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card as="section">
              <CardHeader title="Limits and reserve" description="Protocol limits. Immutable for this market." />
              <dl className="divide-y divide-line px-5 pb-3 sm:px-6">
                <DefinitionRow label="Borrowing limit (LTV)">{formatBps(m.limits.borrowLtvBps)}</DefinitionRow>
                <DefinitionRow label="Liquidation threshold">{formatBps(m.limits.liquidationLtvBps)}</DefinitionRow>
                <DefinitionRow label="Collateral supply cap">{tokenAmount(m.limits.collateralSupplyCap, m.collateral.token, 0)}</DefinitionRow>
                <DefinitionRow label="Lending supply cap">{tokenAmount(m.limits.debtSupplyCap, m.debt.token, 0)}</DefinitionRow>
                <DefinitionRow label="Borrow cap">{tokenAmount(m.limits.borrowCap, m.debt.token, 0)}</DefinitionRow>
                <DefinitionRow label="Cash reserve">{tokenAmount(m.limits.minCash, m.debt.token, 0)}</DefinitionRow>
                <DefinitionRow label="Available to borrow now">
                  <Value of={m.debt.cash}>{(cash) => tokenAmount(cash > m.limits.minCash ? cash - m.limits.minCash : 0n, m.debt.token, 0)}</Value>
                </DefinitionRow>
              </dl>
            </Card>
            <Card as="section">
              <CardHeader title="Price feed" description="Stale or missing prices block new risk, never repayment." />
              <dl className="divide-y divide-line px-5 pb-3 sm:px-6">
                {[m.collateral, m.debt].map((leg) => (
                  <DefinitionRow key={leg.token.symbol} label={leg.token.symbol}>
                    <Value of={leg.price}>
                      {(price) => (
                        <span className="inline-flex flex-wrap items-center justify-end gap-2">
                          {usdText(ok(price.usdE18))}
                          <Badge tone={price.fresh ? "success" : "danger"}>{price.fresh ? "Fresh" : "Stale"}</Badge>
                        </span>
                      )}
                    </Value>
                  </DefinitionRow>
                ))}
                <DefinitionRow label="Source">
                  <Value of={m.collateral.price}>{(price) => price.feed}</Value>
                </DefinitionRow>
                <DefinitionRow label="Last update">
                  <Value of={m.collateral.price}>{(price) => formatTime(price.updatedAt)}</Value>
                </DefinitionRow>
              </dl>
              <p className="px-5 pb-5 text-xs text-warning sm:px-6">Mock feed: prices are set by the test deployer and are not market prices.</p>
            </Card>
          </div>
        </div>

        {/* Desktop action panel */}
        <aside className="hidden lg:block">
          <Card className="sticky top-28 p-5">{panel("supply")}</Card>
        </aside>
      </div>

      {/* Mobile action bar + sheet */}
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-bg px-4 py-3 lg:hidden" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="mx-auto flex max-w-xl gap-2">
          <Button className="flex-1" onClick={() => setSheet("supply")}>
            Supply
          </Button>
          <Button className="flex-1" variant="secondary" onClick={() => setSheet("borrow")}>
            Borrow
          </Button>
          <Button className="flex-1" variant="secondary" onClick={() => setSheet("repay")}>
            Repay
          </Button>
        </div>
      </div>
      <div className="h-16 lg:hidden" aria-hidden="true" />
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={marketTitle(m)} wide>
        {sheet ? panel(sheet) : null}
      </Sheet>
    </div>
  );
}

import { Badge } from "@/components/ui/core";
import { formatAmount, formatUsd, usdValueE18 } from "@/lib/amount";
import { type Maybe, mapMaybe, all2 } from "@/lib/maybe";
import type { Market, PriceInfo, TokenInfo } from "@/services/types";

export function marketTitle(market: Market): string {
  return `${market.collateral.token.symbol} / ${market.debt.token.symbol}`;
}

export function MarketBadges({ market }: { market: Market }) {
  return (
    <>
      <Badge tone="outline">Market #{market.index}</Badge>
      {market.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
      {market.collateral.token.mock || market.debt.token.mock ? <Badge tone="warning">Test tokens</Badge> : null}
    </>
  );
}

export function TokenPair({ market, size = 36 }: { market: Market; size?: number }) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      <TokenGlyph token={market.collateral.token} size={size} />
      <TokenGlyph token={market.debt.token} size={size} className="-ml-2.5" />
    </span>
  );
}

/** Neutral monogram: no third-party token logos are used. */
export function TokenGlyph({ token, size = 36, className = "" }: { token: TokenInfo; size?: number; className?: string }) {
  return (
    <span className={`grid place-items-center rounded-full border border-line-strong bg-surface text-sm font-semibold ${className}`} style={{ width: size, height: size }}>
      {token.symbol.replace(/^t/, "").slice(0, 1)}
    </span>
  );
}

/** Number in full weight, symbol quieter and allowed to wrap: keeps large figures readable in narrow stat cells. */
export function Amount({ value, token, maxFractionDigits }: { value: bigint; token: TokenInfo; maxFractionDigits?: number }) {
  return (
    <>
      {formatAmount(value, token.decimals, maxFractionDigits === undefined ? {} : { maxFractionDigits })} <span className="text-[0.7em] font-medium text-muted">{token.symbol}</span>
    </>
  );
}

export function tokenAmount(value: bigint, token: TokenInfo, maxFractionDigits?: number): string {
  return `${formatAmount(value, token.decimals, maxFractionDigits === undefined ? {} : { maxFractionDigits })} ${token.symbol}`;
}

export function usdOf(amount: Maybe<bigint>, token: TokenInfo, price: Maybe<PriceInfo>): Maybe<bigint> {
  return mapMaybe(all2(amount, price), ([value, info]) => usdValueE18(value, token.decimals, info.usdE18));
}

export function usdText(value: Maybe<bigint>, compact = false): string | null {
  return value.status === "ok" ? formatUsd(value.value, { compact }) : null;
}

export function utilizationBps(market: Market): Maybe<number> {
  return mapMaybe(all2(market.debt.totalBorrowed, market.debt.totalSupplied), ([borrowed, supplied]) => (supplied === 0n ? 0 : Number((borrowed * 10_000n) / supplied)));
}

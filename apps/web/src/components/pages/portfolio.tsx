"use client";
/**
 * Portfolio: every position this app can actually read for the connected wallet. Today that is one position type,
 * Peridot lending (collateral, lent liquidity and debt in an isolated market), held either by a Sentinel account
 * or directly by the wallet. Other position types are added here only when their adapters are deployed.
 */
import Link from "next/link";
import { marketTitle, tokenAmount } from "@/components/domain/market-bits";
import { Badge, Card, CardHeader, ExampleTag, Value } from "@/components/ui/core";
import { useDirectPosition, useMarkets } from "@/hooks/use-data";
import { formatBps } from "@/lib/amount";
import { services } from "@/services";
import type { Market, Position, SentinelAccount } from "@/services/types";
import { positionLtv } from "./market-detail";

/** A wallet's "idle" fields are its plain token balances, which are not positions. */
const hasAny = (position: Position) => position.collateralSupplied > 0n || position.lent > 0n || position.debt > 0n;

export function Portfolio({ accounts }: { accounts: SentinelAccount[] }) {
  const markets = useMarkets();
  const list = markets.data?.status === "ok" ? markets.data.value : [];
  return (
    <Card as="section" data-testid="portfolio">
      <CardHeader
        eyebrow="Portfolio"
        title="Positions"
        description="Everything this app reads for your wallet and your Sentinel accounts, per market."
        action={services.account.source === "chain" ? <Badge tone="outline">Peridot lending</Badge> : <ExampleTag />}
      />
      {markets.isPending ? (
        <p className="p-5 text-sm text-muted sm:p-6">Reading markets…</p>
      ) : list.length === 0 ? (
        <p className="p-5 text-sm text-muted sm:p-6">{markets.data?.status === "unavailable" ? markets.data.reason : "There is no market yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">Market</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Held by</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Collateral</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Lent</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Debt</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">Loan-to-value</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {list.map((market) => (
                <MarketRows key={market.id} market={market} account={accounts.find((entry) => entry.marketId === market.id) ?? null} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-xs text-faint sm:px-6" data-testid="portfolio-scope">
        Position types shown: Peridot lending only. Swaps, vault deposits and liquidity positions are not supported by the deployed contracts, so none can exist for this account. Idle tokens inside a Sentinel account are listed on its card below.
      </p>
    </Card>
  );
}

function MarketRows({ market, account }: { market: Market; account: SentinelAccount | null }) {
  const direct = useDirectPosition(market.id);
  const wallet = direct.data?.status === "ok" && hasAny(direct.data.value) ? direct.data.value : null;
  const name = (
    <Link href={`/markets/${market.id}`} className="font-medium underline-offset-4 hover:underline">
      {marketTitle(market)} <span className="font-normal text-muted">#{market.index}</span>
    </Link>
  );
  if (!account && !wallet) {
    return (
      <tr data-portfolio-row="none" data-market={market.id}>
        <td className="px-5 py-3 sm:px-6">{name}</td>
        <td colSpan={5} className="px-3 py-3 text-muted">
          {direct.isPending ? "Reading…" : "No position"}
        </td>
      </tr>
    );
  }
  return (
    <>
      {account ? <Row market={market} position={account.position} holder="Sentinel account" name={name} /> : null}
      {wallet ? <Row market={market} position={wallet} holder="Wallet" name={account ? null : name} /> : null}
    </>
  );
}

function Row({ market, position, holder, name }: { market: Market; position: Position; holder: string; name: React.ReactNode }) {
  const ltv = positionLtv(market, position);
  const cell = (value: bigint, token: Market["debt"]["token"]) => (value === 0n ? <span className="text-faint">0</span> : tokenAmount(value, token));
  return (
    <tr data-portfolio-row={holder === "Wallet" ? "wallet" : "sentinel"} data-market={market.id}>
      <td className="px-5 py-3 sm:px-6">{name}</td>
      <td className="px-3 py-3">{holder}</td>
      <td className="px-3 py-3 text-right">{cell(position.collateralSupplied, market.collateral.token)}</td>
      <td className="px-3 py-3 text-right">{cell(position.lent, market.debt.token)}</td>
      <td className="px-3 py-3 text-right">{cell(position.debt, market.debt.token)}</td>
      <td className="px-5 py-3 text-right sm:px-6">{position.debt === 0n ? <span className="text-faint">No debt</span> : <Value of={ltv} short>{(v) => formatBps(v)}</Value>}</td>
    </tr>
  );
}

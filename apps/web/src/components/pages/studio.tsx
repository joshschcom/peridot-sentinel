"use client";
import Link from "next/link";
import { MarketBadges, TokenPair, marketTitle, tokenAmount, usdOf, usdText, utilizationBps } from "@/components/domain/market-bits";
import { PolicyIdentity, PolicyRules, SourceTag, capText } from "@/components/domain/policy-card";
import { Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, EmptyState, Mono, Notice, PageHeader, Skeleton, Stat, Value } from "@/components/ui/core";
import { IconAlert, IconArrowRight, IconCheck, IconChevronRight, IconLock, IconMinus } from "@/components/ui/icons";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useMarket, useMarkets } from "@/hooks/use-data";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { activatePlan } from "@/services/chain/plans";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatBps } from "@/lib/amount";
import { formatDay, shortAddress } from "@/lib/format";
import { services } from "@/services";
import type { Market } from "@/services/types";

export function StudioHome() {
  const markets = useMarkets();
  const owned = markets.data?.status === "ok" ? markets.data.value.filter((market) => market.ownedByViewer) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Studio"
        description="Launch and manage isolated markets. You choose the limits and the policy circuit; the protocol's safety checks always stay on."
        actions={
          <>
            <SourceTag source={services.market.source} />
            <ButtonLink href="/studio/create">
              Create a market <IconArrowRight size={16} />
            </ButtonLink>
          </>
        }
      />

      <ol className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
        {[
          ["Create", "One transaction. The market starts inactive, with immutable limits."],
          ["Seed liquidity", "Supply the borrowable asset and make sure the price feed is fresh."],
          ["Activate", "You confirm. Borrowing opens under your policy circuit."],
        ].map(([title, body], index) => (
          <li key={title} className="bg-bg p-5">
            <div className="num font-mono text-xs text-faint">0{index + 1}</div>
            <div className="mt-3 text-sm font-medium">{title}</div>
            <p className="mt-1 text-[0.8125rem] text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <h2 className="pt-2 text-base font-semibold tracking-tight">Your markets</h2>
      {markets.isPending ? (
        <Skeleton className="h-40" data-loading />
      ) : owned === null ? (
        <EmptyState title="Market data unavailable">{markets.data?.status === "unavailable" ? markets.data.reason : "Markets could not be loaded."}</EmptyState>
      ) : owned.length === 0 ? (
        <EmptyState title="You have not created a market yet" action={<ButtonLink href="/studio/create">Create a market</ButtonLink>}>
          Markets you create with the connected wallet appear here, with their activation status.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {owned.map((market) => (
            <Card as="li" key={market.id} className="transition-colors hover:border-line-strong">
              <Link href={`/studio/${market.id}`} className="flex items-center gap-4 rounded-card p-5">
                <TokenPair market={market} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold tracking-tight">{marketTitle(market)}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <MarketBadges market={market} />
                  </div>
                  <p className="mt-2 text-[0.8125rem] text-muted">{market.active ? `Policy cap ${capText(market.policy)} · created ${formatDay(market.createdAt)}` : "Draft: needs liquidity and activation"}</p>
                </div>
                <IconChevronRight size={20} className="shrink-0 text-faint" />
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StudioMarket({ id }: { id: string }) {
  const market = useMarket(id);
  const gate = useWriteGate("market");
  const tx = useChainTx();
  if (market.isPending) return <Skeleton className="h-96" data-loading />;
  const m = market.data?.status === "ok" ? market.data.value : null;
  if (!m) {
    return (
      <EmptyState title="Market not found" action={<Link href="/studio" className="font-medium underline underline-offset-4">Back to Studio</Link>}>
        {market.data?.status === "unavailable" ? market.data.reason : "No market with this identifier exists in the current data source."}
      </EmptyState>
    );
  }
  const liquidity = m.debt.totalSupplied.status === "ok" && m.debt.totalSupplied.value > 0n;
  const feed = m.collateral.price.status === "ok" && m.debt.price.status === "ok" && m.collateral.price.value.fresh && m.debt.price.value.fresh;
  const policyReady = m.policy.compiled.status === "ok";
  const canAct = gate.allowed && m.ownedByViewer;
  const util = utilizationBps(m);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
        <Link href="/studio" className="rounded hover:text-fg">
          Studio
        </Link>
        <IconChevronRight size={14} />
        <span className="text-fg">Market #{m.index}</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <TokenPair market={m} size={44} />
          <div>
            <h1 className="title">{marketTitle(m)}</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <MarketBadges market={m} />
              {m.ownedByViewer ? <Badge tone="solid">You are the owner</Badge> : null}
              <SourceTag source={services.market.source} />
            </div>
          </div>
        </div>
        <ButtonLink href={`/markets/${m.id}`} variant="secondary">
          Open public market page
        </ButtonLink>
      </header>

      {!m.active ? (
        <Card as="section">
          <CardHeader title="Activation checklist" description="Borrowing stays closed until all three are true and you activate." />
          <ul className="space-y-3 p-5 sm:p-6">
            <Check done={liquidity} title="Lending liquidity seeded" body={liquidity ? "The market holds borrowable funds." : `Supply ${m.debt.token.symbol} to the lending side first.`} />
            <Check done={feed} title="Price feed valid" body={feed ? "Both assets have a fresh, positive price." : "A price is missing or stale."} />
            <Check done={policyReady} title="Policy circuit set" body={`Market max LTV ${capText(m.policy)}.`} />
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-line p-5 sm:p-6">
            <Button disabled={!canAct || !liquidity || !feed || tx.state.phase === "running"} onClick={() => m.controller.status === "ok" && tx.run(activatePlan(m.controller.value), "Market activated. Borrowing is open under its policy.")} data-testid="activate-market">
              {!canAct ? <IconLock size={16} /> : null} Activate market
            </Button>
            <ButtonLink href={`/markets/${m.id}`} variant="secondary">
              Seed liquidity
            </ButtonLink>
            <p className="text-[0.8125rem] text-muted">{!gate.allowed ? gate.message : !m.ownedByViewer ? "Only the market owner can activate." : !liquidity ? "Seed liquidity before activating." : ""}</p>
          </div>

        </Card>
      ) : null}

      {/* Outside the checklist card: that card disappears the moment the market becomes active. */}
      {tx.state.phase !== "idle" ? (
        <Card className="p-5 sm:p-6">
          <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
        </Card>
      ) : null}

      <Card className="grid grid-cols-2 gap-x-4 gap-y-6 p-5 sm:grid-cols-4 sm:p-6">
        <Stat label="Lending supplied" value={<Value of={m.debt.totalSupplied}>{(v) => tokenAmount(v, m.debt.token, 0)}</Value>} sub={usdText(usdOf(m.debt.totalSupplied, m.debt.token, m.debt.price), true)} />
        <Stat label="Borrowed" value={<Value of={m.debt.totalBorrowed}>{(v) => tokenAmount(v, m.debt.token, 0)}</Value>} sub={util.status === "ok" ? `${formatBps(util.value, 1)} utilised` : null} />
        <Stat label="Collateral supplied" value={<Value of={m.collateral.totalSupplied}>{(v) => tokenAmount(v, m.collateral.token, 2)}</Value>} sub={usdText(usdOf(m.collateral.totalSupplied, m.collateral.token, m.collateral.price), true)} />
        <Stat label="Borrow rate" value={<Value of={m.debt.borrowAprBps}>{(v) => formatBps(v)}</Value>} sub="APR (simple, variable)" />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section">
          <CardHeader eyebrow="Policy circuit" title="Market policy" description="Evaluated inside the controller on every risk-increasing operation." />
          <div className="space-y-4 p-5 sm:p-6">
            <PolicyRules record={m.policy} />
            <PolicyIdentity record={m.policy} />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={!canAct}>
                {!canAct ? <IconLock size={15} /> : null} Replace policy
              </Button>
              <p className="text-[0.8125rem] text-muted">Only a registered policy can be attached. Testnet: the change is immediate. Production: policy changes are timelocked.</p>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card as="section">
            <CardHeader title="Configuration" description="Immutable for this market." />
            <dl className="divide-y divide-line px-5 pb-3 sm:px-6">
              <DefinitionRow label="Borrowing limit">{formatBps(m.limits.borrowLtvBps)}</DefinitionRow>
              <DefinitionRow label="Liquidation threshold">{formatBps(m.limits.liquidationLtvBps)}</DefinitionRow>
              <DefinitionRow label="Collateral supply cap">{tokenAmount(m.limits.collateralSupplyCap, m.collateral.token, 0)}</DefinitionRow>
              <DefinitionRow label="Lending supply cap">{tokenAmount(m.limits.debtSupplyCap, m.debt.token, 0)}</DefinitionRow>
              <DefinitionRow label="Borrow cap">{tokenAmount(m.limits.borrowCap, m.debt.token, 0)}</DefinitionRow>
              <DefinitionRow label="Cash reserve">{tokenAmount(m.limits.minCash, m.debt.token, 0)}</DefinitionRow>
            </dl>
          </Card>
          <Card as="section">
            <CardHeader title="Ownership and contracts" />
            <dl className="divide-y divide-line px-5 pb-3 sm:px-6">
              <DefinitionRow label="Owner">
                <Value of={m.owner}>{(v) => <Mono>{shortAddress(v)}</Mono>}</Value>
              </DefinitionRow>
              <DefinitionRow label="Controller">
                <Value of={m.controller}>{(v) => <Mono>{shortAddress(v)}</Mono>}</Value>
              </DefinitionRow>
              <DefinitionRow label="Collateral pToken">
                <Value of={m.collateral.pToken}>{(v) => <Mono>{shortAddress(v)}</Mono>}</Value>
              </DefinitionRow>
              <DefinitionRow label="Debt pToken">
                <Value of={m.debt.pToken}>{(v) => <Mono>{shortAddress(v)}</Mono>}</Value>
              </DefinitionRow>
              <DefinitionRow label="Created">{formatDay(m.createdAt)}</DefinitionRow>
            </dl>
            <div className="px-5 pb-5 sm:px-6">
              <Notice icon={<IconAlert size={18} />} title="What an owner cannot do">
                Owners cannot move user funds, change limits or the price feed, or touch other markets. Testnet profile: policy changes take effect immediately. The production profile timelocks them.
              </Notice>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Check({ done, title, body }: { done: boolean; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${done ? "bg-success-soft text-success" : "bg-raised text-faint"}`}>
        {done ? <IconCheck size={13} strokeWidth={2.4} /> : <IconMinus size={13} strokeWidth={2.4} />}
        <span className="sr-only">{done ? "Done" : "Pending"}</span>
      </span>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-[0.8125rem] text-muted">{body}</p>
      </div>
    </li>
  );
}

export type { Market };

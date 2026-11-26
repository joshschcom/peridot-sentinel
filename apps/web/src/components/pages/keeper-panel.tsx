"use client";
import Link from "next/link";
import { coverageRanges } from "@/components/domain/log-coverage";
import { marketTitle, tokenAmount } from "@/components/domain/market-bits";
import { Advanced, Badge, Card, CardHeader, DefinitionRow, ExampleTag, Mono, Notice, Skeleton, type Tone } from "@/components/ui/core";
import { IconAlert, IconBot } from "@/components/ui/icons";
import { useMarkets } from "@/hooks/use-data";
import { useKeeper, useKeeperChainFacts } from "@/hooks/use-keeper";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount, formatBps } from "@/lib/amount";
import { WRITE_CHAIN, WRITE_CHAIN_ID, explorerTxUrl } from "@/lib/chains";
import { mapContractError } from "@/lib/errors";
import { formatTime, shortAddress, shortHash } from "@/lib/format";
import { type KeeperFeed, type KeeperGroup, type KeeperItem, type KeeperTone, groupKeeperItems, keeperRowView } from "@/lib/keeper";
import { services } from "@/services";
import type { AutoRepayFact, ReceiptFact } from "@/services/chain/reads";
import type { LogCoverage, TokenInfo } from "@/services/types";

const TONE: Record<KeeperTone, Tone> = { neutral: "neutral", success: "success", warning: "warning", danger: "danger" };
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Labelled example rows for fixture mode: one per documented state, so each presentation can be reviewed. No hashes, no addresses. */
const EXAMPLE_ITEMS: KeeperItem[] = [
  { at: "2026-11-24T09:12:40.000Z", state: "success", amount: "150000000", trigger: 5000, ltv: "5200", outcomes: [{ operator: "0x0000000000000000000000000000000000000000", amount: "150000000", ltvBeforeBps: "5200", ltvAfterBps: "4350" }] },
  { at: "2026-11-24T09:12:31.000Z", state: "submitted", amount: "150000000", trigger: 5000, ltv: "5200" },
  { at: "2026-11-24T09:12:30.000Z", state: "simulated", amount: "150000000", trigger: 5000, ltv: "5200" },
  { at: "2026-11-24T09:11:30.000Z", state: "gas-budget", amount: "150000000", trigger: 5000, ltv: "5150" },
  { at: "2026-11-24T09:10:30.000Z", state: "simulation-failed", reason: "TriggerNotMet", trigger: 5000, ltv: "4800" },
  { at: "2026-11-24T09:09:30.000Z", state: "simulation-failed", reason: "TriggerNotMet", trigger: 5000, ltv: "4800" },
];

/**
 * The keeper is a separate off-chain service. This panel keeps its reports apart from on-chain events:
 * off-chain states say that nothing was sent, and a reported transaction is only called confirmed after this page
 * has read its receipt from the chain.
 */
export function KeeperPanel() {
  const fixture = services.activity.source === "fixture";
  const keeper = useKeeper();
  const facts = useKeeperChainFacts(keeper.data);
  const markets = useMarkets();
  const wallet = useWallet();
  const feed: KeeperFeed | undefined = keeper.data;
  const state = fixture ? "example" : keeper.isPending ? "loading" : (feed?.state ?? "unavailable");
  const market = feed?.state === "ok" && markets.data?.status === "ok" ? (markets.data.value.find((entry) => feed.accountController && sameAddress(entry.id, feed.accountController)) ?? null) : null;
  const token = market?.debt.token ?? null;
  const yours = feed?.state === "ok" && wallet.status === "connected" && feed.accountOwner !== null && sameAddress(feed.accountOwner, wallet.address);

  return (
    <Card as="section" data-testid="keeper-panel" data-keeper={state}>
      <CardHeader
        eyebrow="Off-chain service"
        title="Keeper reports"
        description="What the automation service says it checked or sent. These are reports, not chain events: a transaction counts as confirmed only once this page has read its receipt from the chain."
        action={fixture ? <ExampleTag /> : feed?.state === "ok" ? <Badge tone={feed.status?.execute ? "success" : "outline"}>{feed.status?.execute ? "Executing" : "Simulate-only"}</Badge> : null}
      />
      {state === "example" ? (
        <Rows groups={groupKeeperItems(EXAMPLE_ITEMS)} token={{ symbol: "tUSDC", name: "Example", decimals: 6, address: { status: "unavailable", reason: "example" }, mock: true }} example />
      ) : state === "loading" ? (
        <Skeleton className="m-5 h-32" />
      ) : feed?.state === "not-configured" ? (
        <p className="p-5 text-sm text-muted sm:p-6" data-testid="keeper-message">
          No keeper service is connected to this app. On-chain activity above is unaffected.
        </p>
      ) : feed?.state === "scope-mismatch" ? (
        <div className="space-y-3 p-5 sm:p-6" data-testid="keeper-message">
          <Notice tone="warning" icon={<IconAlert size={18} />} title="Keeper reports withheld">
            A keeper service answered, but it does not belong to this deployment, so none of its rows are shown.
          </Notice>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {feed.check.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : feed?.state === "ok" ? (
        <>
          <dl className="divide-y divide-line px-5 sm:px-6" data-testid="keeper-scope">
            <DefinitionRow label="Watching account">
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <Mono>{shortAddress(feed.scope.account)}</Mono>
                <Badge tone={yours ? "success" : "outline"}>{yours ? "Your account" : "Not your account"}</Badge>
              </span>
            </DefinitionRow>
            {!yours && feed.accountOwner ? (
              <DefinitionRow label="Account owner">
                <Mono>{shortAddress(feed.accountOwner)}</Mono>
              </DefinitionRow>
            ) : null}
            <DefinitionRow label="Market">
              {market ? (
                <Link href={`/markets/${market.id}`} className="underline underline-offset-4">
                  {marketTitle(market)}, market #{market.index}
                </Link>
              ) : (
                <span className="text-faint">Not resolved</span>
              )}
            </DefinitionRow>
            <DefinitionRow label="Operator">
              <Mono>{shortAddress(feed.scope.operator)}</Mono>
            </DefinitionRow>
            <DefinitionRow label="Mode">{feed.status ? (feed.status.execute ? "Sends transactions when the trigger is met" : "Simulate-only: it checks and simulates, and sends nothing") : "Not reported"}</DefinitionRow>
            <DefinitionRow label="Last check">{feed.status?.lastAt ? `${formatTime(feed.status.lastAt)}${feed.status.lastOutcome ? ` · ${feed.status.lastOutcome}` : ""}` : "None yet"}</DefinitionRow>
          </dl>
          <p className="px-5 pt-3 text-xs text-faint sm:px-6">
            Scope checked before showing rows: chain {feed.scope.chainId}, this deployment's Sentinel factory, {feed.scope.instanceId ? "the same local node instance, " : ""}and the account was created by that factory (read on chain).
          </p>
          {feed.check.warnings.map((warning) => (
            <div key={warning} className="px-5 pt-3 sm:px-6">
              <Notice tone="warning" icon={<IconAlert size={18} />}>
                {warning}
              </Notice>
            </div>
          ))}
          {feed.items.length === 0 ? (
            <p className="p-5 text-sm text-muted sm:p-6" data-testid="keeper-message">
              The keeper has no recent reports for this account. That is different from the service being unavailable.
            </p>
          ) : (
            <Rows groups={groupKeeperItems(feed.items)} token={token} receipts={facts.data?.receipts} />
          )}
          {feed.truncated ? <p className="px-5 pb-4 text-xs text-faint sm:px-6">Older reports exist in the keeper's journal and are not shown.</p> : null}
          <ChainRepays events={facts.data?.repays.events ?? null} coverage={facts.data?.repays.coverage ?? null} token={token} reported={new Set(feed.items.flatMap((item) => (item.hash ? [item.hash.toLowerCase()] : [])))} />
        </>
      ) : (
        <div className="p-5 sm:p-6" data-testid="keeper-message">
          <Notice icon={<IconBot size={18} />} title="Keeper service unavailable">
            {feed?.state === "unavailable" ? feed.reason : "The keeper route could not be reached."} On-chain activity above does not depend on it.
          </Notice>
        </div>
      )}
    </Card>
  );
}

function Rows({ groups, token, receipts, example = false }: { groups: KeeperGroup[]; token: TokenInfo | null; receipts?: Record<string, ReceiptFact>; example?: boolean }) {
  return (
    <ul className="mt-3 divide-y divide-line border-t border-line">
      {groups.map((group) => (
        <Row key={`${group.item.at}-${group.item.state}-${group.item.hash ?? ""}`} group={group} token={token} receipt={group.item.hash ? receipts?.[group.item.hash.toLowerCase()] : undefined} example={example} />
      ))}
    </ul>
  );
}

const raw = (value: string | undefined, token: TokenInfo | null) => (value === undefined ? null : token ? tokenAmount(BigInt(value), token) : `${value} raw units`);

function Row({ group, token, receipt, example }: { group: KeeperGroup; token: TokenInfo | null; receipt: ReceiptFact | undefined; example: boolean }) {
  const { item } = group;
  const view = keeperRowView(item);
  const reason = item.reason ? mapContractError({ name: item.reason }) : null;
  const url = item.hash ? explorerTxUrl(WRITE_CHAIN_ID, item.hash) : null;
  const facts = [
    raw(item.amount, token) ? `Amount ${raw(item.amount, token)}` : null,
    item.ltv !== undefined ? `loan-to-value ${formatBps(BigInt(item.ltv))}` : null,
    item.trigger !== undefined ? `trigger ${formatBps(item.trigger)}` : null,
    item.fee !== undefined ? `estimated fee ${formatAmount(BigInt(item.fee), WRITE_CHAIN.nativeCurrency.decimals, { maxFractionDigits: 6 })} ${WRITE_CHAIN.nativeCurrency.symbol}` : null,
  ].filter(Boolean);
  return (
    <li className="p-4 sm:p-5" data-keeper-state={item.state} data-sent={String(view.sent)} data-confirmed={receipt?.found ? receipt.status : receipt ? "not-found" : "none"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge wrap tone={TONE[view.tone]}>{view.label}</Badge>
          <Badge tone="outline">Keeper report</Badge>
          {example ? <ExampleTag /> : null}
        </div>
        <time dateTime={item.at} className="num text-xs text-faint">
          {formatTime(item.at)}
          {group.count > 1 ? ` · ${group.count} identical checks since ${formatTime(group.since)}` : ""}
        </time>
      </div>
      <p className="mt-2 text-sm text-muted">{view.summary}</p>
      {reason && reason.category !== "unknown" ? <p className="mt-1 text-sm">{reason.title}.</p> : null}
      {facts.length ? <p className="num mt-1 text-[0.8125rem] text-muted">{facts.join(" · ")}</p> : null}
      {item.outcomes?.map((outcome) => (
        <p key={`${outcome.operator}-${outcome.amount}`} className="num mt-1 text-[0.8125rem] text-muted">
          Reported outcome: repaid {raw(outcome.amount, token)}, loan-to-value {formatBps(BigInt(outcome.ltvBeforeBps))} → {formatBps(BigInt(outcome.ltvAfterBps))}.
        </p>
      ))}
      {view.sent ? (
        <div className="mt-2 text-xs">
          {item.hash ? (
            <>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  {shortHash(item.hash)}
                </a>
              ) : (
                <Mono className="text-xs">{shortHash(item.hash)}</Mono>
              )}{" "}
              <ReceiptLine receipt={receipt} token={token} />
            </>
          ) : (
            <span className="text-faint">No transaction hash: {example ? "example data" : "the keeper did not report one"}.</span>
          )}
        </div>
      ) : null}
      {item.hash ? (
        <Advanced label="Transaction hash" className="mt-3">
          <span className="font-mono text-xs break-all">{item.hash}</span>
        </Advanced>
      ) : null}
    </li>
  );
}

function ReceiptLine({ receipt, token }: { receipt: ReceiptFact | undefined; token: TokenInfo | null }) {
  if (!receipt) return <span className="text-faint">Checking the receipt on chain…</span>;
  if (!receipt.found) return <span className="text-warning">Not found on this chain. Treat this report as unconfirmed.</span>;
  if (receipt.status === "reverted") return <span className="text-danger">Receipt read from chain: mined and reverted, block {receipt.blockNumber.toString()}.</span>;
  return (
    <span className="text-success" data-testid="keeper-receipt-confirmed">
      Receipt read from chain: success, block {receipt.blockNumber.toString()}
      {receipt.autoRepay ? `, AutoRepayExecuted ${token ? tokenAmount(receipt.autoRepay.amount, token) : receipt.autoRepay.amount.toString()}, loan-to-value ${formatBps(receipt.autoRepay.ltvBeforeBps)} → ${formatBps(receipt.autoRepay.ltvAfterBps)}` : ", but no AutoRepayExecuted event from this account"}.
    </span>
  );
}

/** AutoRepayExecuted events emitted by the watched account, read from the chain independently of the keeper's journal. */
function ChainRepays({ events, coverage, token, reported }: { events: AutoRepayFact[] | null; coverage: LogCoverage | null; token: TokenInfo | null; reported: Set<string> }) {
  if (events === null) return null;
  const complete = coverage?.complete ?? true;
  const url = (hash: string) => explorerTxUrl(WRITE_CHAIN_ID, hash);
  return (
    <div className="border-t border-line p-5 sm:p-6" data-testid="keeper-chain-repays" data-count={events.length}>
      <h3 className="text-sm font-medium">On chain for this account</h3>
      <p className="mt-0.5 text-xs text-faint">
        AutoRepayExecuted events emitted by the account itself{complete || !coverage ? "" : `, read from ${coverageRanges(coverage)} only`}.
      </p>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No auto-repay has been executed for this account{complete ? "" : " in the blocks that were read"}.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {events.map((event) => (
            <li key={event.hash} className="text-sm" data-chain-repay={event.hash}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="success">Mined</Badge>
                <Badge wrap tone="outline">{reported.has(event.hash.toLowerCase()) ? "Also in the keeper's reports" : "Not in the keeper's recent reports"}</Badge>
              </div>
              <p className="num mt-1.5 text-muted">
                Repaid {token ? tokenAmount(event.amount, token) : `${event.amount.toString()} raw units`}, loan-to-value {formatBps(event.ltvBeforeBps)} → {formatBps(event.ltvAfterBps)}, block {event.blockNumber.toString()}, operator <Mono>{shortAddress(event.operator)}</Mono>.
              </p>
              <p className="mt-1 text-xs">
                {url(event.hash) ? (
                  <a href={url(event.hash)!} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                    {shortHash(event.hash)}
                  </a>
                ) : (
                  <span className="font-mono break-all text-faint">{event.hash}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

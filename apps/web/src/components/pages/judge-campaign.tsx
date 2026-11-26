"use client";
/**
 * The prepared judge campaign, READ-ONLY (docs/JUDGE_DEMO.md, "Read-only UI data"). Three kinds of information, kept
 * apart on screen:
 *   prepared   what the campaign manifest recorded at its prepared block (addresses, caps, the two grants);
 *   live       what the public testnet RPC reports right now for those two grants, at one stated block;
 *   snapshot   the campaign's own scoped activity file, with its range, terminal block hash and gaps.
 * The card has no input and no control that could act on the campaign: its owner key is not this app's business.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Button, Card, CardHeader, DefinitionRow, Mono, Notice, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight } from "@/components/ui/icons";
import { RAW_CONFIG } from "@/generated/config";
import { formatAmount, formatBps } from "@/lib/amount";
import { TARGET_KIND, explorerAddressUrl, explorerTxUrl, xLayerTestnet } from "@/lib/chains";
import { shortAddress, shortHash } from "@/lib/format";
import { JUDGE_GRANT_STATE_LABEL, JUDGE_LABEL, type JudgeActivity, type JudgeCampaign, type JudgeGrantState, parseJudgeCampaign } from "@/lib/judge";
import { readJudgeCampaign } from "@/services/chain/judge";
import { FORCE_FIXTURE } from "@/services/runtime";

export const JUDGE = parseJudgeCampaign(RAW_CONFIG.judge.json, RAW_CONFIG.judge.file, RAW_CONFIG.judge.activity, RAW_CONFIG.judge.activityFile);

const num = (value: bigint) => value.toLocaleString("en-US");
const utc = (seconds: bigint) => `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
// Symbols and decimals as the guide states them for this campaign: mUSD has 6 decimals, the campaign's own swap
// tokens are jWOKB (18) and jUSDC (6). They are mock tokens without value.
const DEBT = { symbol: "mUSD", decimals: 6 };
const SWAP_IN = { symbol: "jWOKB", decimals: 18 };
const SWAP_OUT = { symbol: "jUSDC", decimals: 6 };
const amount = (raw: bigint, token: { symbol: string; decimals: number }) => `${formatAmount(raw, token.decimals)} ${token.symbol}`;
const STATE_TONE: Record<JudgeGrantState, "success" | "warning" | "danger" | "outline"> = { ready: "success", spent: "warning", expired: "warning", revoked: "outline", unexpected: "danger" };

function Addr({ address }: { address: string }) {
  const url = explorerAddressUrl(xLayerTestnet.id, address);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] break-all underline underline-offset-4">
      {address} <IconArrowUpRight size={13} />
    </a>
  ) : (
    <Mono>{address}</Mono>
  );
}
function Tx({ hash }: { hash: string }) {
  const url = explorerTxUrl(xLayerTestnet.id, hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] underline underline-offset-4" data-judge-tx={hash}>
      {shortHash(hash)} <IconArrowUpRight size={13} />
    </a>
  ) : (
    <Mono>{shortHash(hash)}</Mono>
  );
}

export function JudgeCampaignCard() {
  // The campaign lives on the public testnet. A local-target or example-data build shows the prepared record alone.
  const enabled = TARGET_KIND === "testnet" && !FORCE_FIXTURE;
  const campaign = JUDGE.status === "ok" ? JUDGE.value : null;
  const live = useQuery({ queryKey: ["judge-campaign", campaign?.campaign], queryFn: () => readJudgeCampaign(campaign!), enabled: enabled && campaign !== null, staleTime: 30_000, retry: 1 });
  if (!campaign) return null;
  const data = live.data;
  const state = !enabled ? "off" : live.isPending ? "loading" : live.isError || !data ? "error" : "ok";
  const [a] = campaign.markets;

  return (
    <Card as="section" id="judge" className="scroll-mt-28" data-testid="connect-judge" data-campaign={campaign.campaign} data-state={state} data-block={data ? data.block.toString() : ""} data-owner={campaign.owner} data-operator={campaign.operator}>
      <CardHeader
        eyebrow="Prepared campaign · X Layer testnet (chain 1952)"
        title={`Judge campaign ${campaign.campaign}`}
        description="A fresh owner with two Studio markets, two v1 Sentinel accounts and one v2 account, prepared so a reviewer can reproduce the demonstration with an agent of their own. Shown read-only: nothing on this page can act on it."
        action={<Badge tone="outline">Read-only</Badge>}
      />
      <div className="space-y-6 p-5 sm:p-6">
        <p className="rounded-control border border-line bg-subtle p-3.5 text-[0.8125rem] text-muted" data-testid="judge-label">
          {JUDGE_LABEL}. Recorded in <Mono>{campaign.file}</Mono> at testnet block {num(campaign.preparedBlock)}
          {campaign.setupReceiptCount !== null ? ` after ${campaign.setupReceiptCount} setup transactions` : ""}. The steps to use it are in <Mono>{RAW_CONFIG.onboarding.judgeDemo.file}</Mono>.
        </p>

        <dl className="divide-y divide-line">
          <DefinitionRow stack label="Owner (controls all three accounts)">
            <Addr address={campaign.owner} />
          </DefinitionRow>
          <DefinitionRow stack label="Operator (the agent's restricted signer)">
            <Addr address={campaign.operator} />
          </DefinitionRow>
          {campaign.markets.map((market) => (
            <DefinitionRow key={market.key} stack label={`Market ${market.key} · v1 account`}>
              <span className="flex flex-col gap-1 sm:items-end" data-judge-market={market.key} data-controller={market.controller} data-account={market.account}>
                <span>
                  <Link href={`/markets/${market.controller}`} className="underline underline-offset-4">
                    mCOL / mUSD, market #{market.marketId}
                  </Link>{" "}
                  · market policy cap {formatBps(market.marketCapBps)}
                </span>
                <span className="text-muted">
                  account <Mono>{shortAddress(market.account)}</Mono> · account policy cap {formatBps(campaign.accountCapBps)}
                </span>
              </span>
            </DefinitionRow>
          ))}
          <DefinitionRow stack label="v2 account (swap)">
            <Addr address={campaign.v2.account} />
          </DefinitionRow>
        </dl>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">The two grants</h3>
            {enabled ? <Badge tone={live.isError ? "danger" : data ? "success" : "neutral"}>{live.isError ? "Live read unavailable" : data ? `Live read · block ${num(data.block)}` : "Reading…"}</Badge> : <Badge tone="outline">Live read off</Badge>}
          </div>
          {enabled && (live.isError || (data && !data.ownersMatch)) ? (
            <Notice tone="danger" icon={<IconAlert size={18} />} title={live.isError ? "The grants could not be read" : "The accounts do not answer with the campaign's owner"} className="mt-3">
              {live.isError ? (live.error instanceof Error ? live.error.message.split("\n")[0] : "The public testnet RPC did not answer.") : "At least one account's owner() is not the owner recorded in the manifest."} Only the prepared values are shown below; they are not the current state.{" "}
              <Button size="sm" variant="secondary" onClick={() => void live.refetch()} disabled={live.isFetching}>
                {live.isFetching ? "Reading…" : "Try again"}
              </Button>
            </Notice>
          ) : null}
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            <Grant
              kind="repay"
              title="Repay only · v1 account of market A"
              prepared={[
                ["Budget", amount(campaign.repayGrant.budgetRaw, DEBT)],
                ["Expires", utc(campaign.repayGrant.expiry)],
              ]}
              preparedExpiry={campaign.repayGrant.expiry}
              receipt={campaign.repayGrant.receipt}
              account={a?.account ?? campaign.repayGrant.account}
              loading={enabled && live.isPending}
              live={
                data && data.ownersMatch
                  ? {
                      state: data.repay.state,
                      remaining: data.repay.remaining,
                      expiry: data.repay.expiry,
                      rows: [
                        ["Budget left", amount(data.repay.remaining, DEBT)],
                        ["Expires", data.repay.expiry === 0n ? "No expiry set" : utc(data.repay.expiry)],
                        ["Repay trigger", data.repay.triggerBps === 0 ? "Off" : `loan-to-value at or above ${formatBps(data.repay.triggerBps)}`],
                      ],
                    }
                  : null
              }
            />
            <Grant
              kind="swap"
              title={`Swap only · v2 account, ${SWAP_IN.symbol} to ${SWAP_OUT.symbol}`}
              prepared={[
                ["Per swap", amount(campaign.swapGrant.perCallRaw, SWAP_IN)],
                ["Budget", amount(campaign.swapGrant.remainingRaw, SWAP_IN)],
                ["Expires", utc(campaign.swapGrant.expiry)],
              ]}
              preparedExpiry={campaign.swapGrant.expiry}
              receipt={campaign.swapGrant.receipt}
              account={campaign.swapGrant.account}
              loading={enabled && live.isPending}
              live={
                data && data.ownersMatch
                  ? {
                      state: data.swap.state,
                      remaining: data.swap.remaining,
                      expiry: data.swap.expiry,
                      rows: [
                        ["Per swap", amount(data.swap.maxPerCall, SWAP_IN)],
                        ["Budget left", amount(data.swap.remaining, SWAP_IN)],
                        ["Expires", data.swap.expiry === 0n ? "No expiry set" : utc(data.swap.expiry)],
                      ],
                    }
                  : null
              }
            />
          </ul>
          <p className="mt-3 text-xs text-faint" data-testid="judge-grants-note">
            {data ? (
              <>
                Live values were read at block <span className="num">{num(data.block)}</span> ({utc(data.blockTime)}, <Mono>{shortHash(data.blockHash)}</Mono>) from <Mono>{xLayerTestnet.rpcUrls.default.http[0]}</Mono>, and each expiry is compared with that block's time.{" "}
              </>
            ) : null}
            A grant ends by itself at its expiry or when its budget is spent, and the owner can revoke it at any time. After that the recorded receipts stay valid as history, and the operator can do nothing.
          </p>
        </div>

        {campaign.activity.status === "ok" ? (
          <Activity activity={campaign.activity.value} />
        ) : (
          <Notice tone="warning" icon={<IconAlert size={18} />} title="The campaign's activity snapshot is unavailable" data-testid="judge-activity-unavailable">
            {campaign.activity.reason}. No activity is shown in its place.
          </Notice>
        )}
      </div>
    </Card>
  );
}

function Grant({ kind, title, prepared, preparedExpiry, receipt, account, live, loading }: { kind: "repay" | "swap"; title: string; prepared: Array<[string, string]>; preparedExpiry: bigint; receipt: string | null; account: string; live: { state: JudgeGrantState; remaining: bigint; expiry: bigint; rows: Array<[string, string]> } | null; loading: boolean }) {
  const rows = (items: Array<[string, string]>): ReactNode =>
    items.map(([label, value]) => (
      <div key={label} className="flex items-baseline justify-between gap-3 py-1">
        <dt className="text-muted">{label}</dt>
        <dd className="num text-right">{value}</dd>
      </div>
    ));
  return (
    <li className="rounded-control border border-line p-4 text-sm" data-judge-grant={kind} data-state={live?.state ?? ""} data-remaining={live ? live.remaining.toString() : ""} data-expiry={live ? live.expiry.toString() : ""} data-prepared-expiry={preparedExpiry.toString()} data-account={account}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-medium">{title}</h4>
        {live ? <Badge tone={STATE_TONE[live.state]}>{JUDGE_GRANT_STATE_LABEL[live.state]}</Badge> : null}
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="eyebrow">As prepared</p>
          <dl className="mt-1.5">{rows(prepared)}</dl>
        </div>
        <div>
          <p className="eyebrow">On chain now</p>
          {live ? <dl className="mt-1.5">{rows(live.rows)}</dl> : loading ? <Skeleton className="mt-2 h-16" data-loading /> : <p className="mt-1.5 text-muted">Not read. The prepared values are not the current state.</p>}
        </div>
      </div>
      {receipt ? (
        <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-muted">
          Granted by the owner in <Tx hash={receipt} />
        </p>
      ) : null}
    </li>
  );
}

/** The campaign's own indexed history. A snapshot with a stated range: it is not a live feed and says where it ends. */
function Activity({ activity }: { activity: JudgeActivity }) {
  return (
    <div data-testid="judge-activity" data-from={activity.fromBlock.toString()} data-to={activity.toBlock.toString()} data-events={activity.events.length} data-gaps={activity.gaps.length}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Recorded activity of this campaign</h3>
        <Badge tone="outline" wrap>
          Historical snapshot · not a live feed
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted" data-testid="judge-activity-coverage">
        {activity.events.length} events in {activity.transactions} transactions, from testnet blocks <span className="num text-fg">{num(activity.fromBlock)}</span> to <span className="num text-fg">{num(activity.toBlock)}</span> (terminal block <Mono>{shortHash(activity.toBlockHash)}</Mono>)
        {activity.updatedAt ? `, refreshed ${activity.updatedAt.slice(0, 16).replace("T", " ")} UTC` : ""}. Source: <Mono>{activity.file}</Mono>.
      </p>
      <p className="mt-2 rounded-control border border-line bg-subtle p-3 text-[0.8125rem] text-muted" data-testid="judge-activity-gaps">
        {activity.gaps.length > 0 ? (
          <>
            Not covered by the snapshot:{" "}
            {activity.gaps.map((gap, index) => (
              <span key={gap.fromBlock.toString()} data-judge-gap={`${gap.fromBlock}-${gap.toBlock}`}>
                {index > 0 ? "; " : ""}blocks <span className="num">{num(gap.fromBlock)}</span> to <span className="num">{num(gap.toBlock)}</span> ({gap.reason === "confirmation-depth" ? `inside the confirmation depth${activity.confirmations !== null ? ` of ${activity.confirmations} blocks` : ""} when it was refreshed` : gap.reason.replace(/[^a-z0-9-]/gi, " ")})
              </span>
            ))}
            .{" "}
          </>
        ) : null}
        Nothing after block <span className="num">{num(activity.toBlock)}</span> is in this list: a repayment, swap or revocation made since then appears only after the snapshot is refreshed. The live grant values above do not depend on it.
      </p>
      <details className="mt-3 rounded-control border border-line" data-testid="judge-activity-list">
        <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium">Show the {activity.events.length} events</summary>
        <ol className="divide-y divide-line border-t border-line text-[0.8125rem]">
          {activity.events.map((event) => (
            <li key={`${event.transactionHash}-${event.logIndex}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 py-2" data-judge-event={event.eventName} data-hash={event.transactionHash}>
              <span className="min-w-0">
                <span className="font-medium">{event.eventName}</span> <span className="text-muted">· {event.contract}</span>
              </span>
              <span className="num flex flex-wrap items-baseline gap-x-3 text-muted">
                block {num(event.blockNumber)} · {utc(event.timestamp)} <Tx hash={event.transactionHash} />
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

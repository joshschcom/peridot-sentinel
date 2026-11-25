"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { tokenAmount } from "@/components/domain/market-bits";
import { Advanced, Badge, Button, Card, CardHeader, EmptyState, ExampleTag, Mono, Skeleton, type Tone, cx } from "@/components/ui/core";
import { IconArrowUpRight, IconBot, IconUser } from "@/components/ui/icons";
import { useActivity } from "@/hooks/use-data";
import { formatAmount, formatBps } from "@/lib/amount";
import { LOG_PAGE_BLOCKS, WRITE_CHAIN_ID, explorerTxUrl } from "@/lib/chains";
import { type ErrorCategory, mapContractError, rawErrorText } from "@/lib/errors";
import { EVIDENCE, FORK_LABEL, LOCAL_LABEL } from "@/lib/evidence";
import { formatTime, shortHash } from "@/lib/format";
import { services } from "@/services";
import { extendLogWindow } from "@/services/chain/client";
import type { ActivityEntry, ActivityEvidence } from "@/services/types";
import { KeeperPanel } from "./keeper-panel";
import { SentinelHeader } from "./sentinel-common";

type Filter = "all" | "allowed" | "rejected";

const EVIDENCE_LABEL: Record<ActivityEvidence, string> = {
  simulation: "Simulation · not sent",
  "mined-success": "Mined",
  "mined-revert": "Mined revert",
};

const REJECTION_BADGE: Partial<Record<ErrorCategory, { label: string; tone: Tone }>> = {
  "account-policy": { label: "Stopped by your policy", tone: "warning" },
  "market-policy": { label: "Blocked by market policy", tone: "danger" },
  "policy-unavailable": { label: "Policy unavailable", tone: "neutral" },
  protocol: { label: "Protocol limit", tone: "neutral" },
  operator: { label: "Operator not permitted", tone: "neutral" },
};

export function SentinelActivity() {
  const activity = useActivity();
  const [filter, setFilter] = useState<Filter>("all");
  const queryClient = useQueryClient();
  const entries = activity.data?.status === "ok" ? activity.data.value.entries : null;
  const coverage = activity.data?.status === "ok" ? activity.data.value.coverage : undefined;
  const scanFurther = () => {
    extendLogWindow();
    void queryClient.invalidateQueries();
  };
  const shown = (entries ?? []).filter((entry) => filter === "all" || (filter === "allowed" ? entry.result === "allowed" : entry.result !== "allowed"));
  const fixture = services.activity.source === "fixture";

  return (
    <div className="space-y-6">
      <SentinelHeader description="Everything your account and its operator attempted: what was allowed, what was stopped, by which rule, and how we know." />

      <div role="group" aria-label="Filter activity" className="flex gap-2">
        {(["all", "allowed", "rejected"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)} className={cx("h-9 rounded-full border px-4 text-sm font-medium capitalize", filter === option ? "border-fg bg-inverse text-on-inverse" : "border-line-strong text-muted hover:text-fg")}>
            {option}
          </button>
        ))}
      </div>

      {activity.isPending ? (
        <Skeleton className="h-96" data-loading />
      ) : entries === null ? (
        <EmptyState title="Activity unavailable">{activity.data?.status === "unavailable" ? activity.data.reason : "Activity could not be loaded."}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing here yet">Actions by you or your operator will appear here with their outcome{coverage && !coverage.complete ? " (in the scanned block range, see below)" : ""}.</EmptyState>
      ) : (
        <Card as="section" data-testid="chain-activity">
          {fixture ? null : <CardHeader eyebrow="On chain" title="Your wallet and Sentinel accounts" description="Events emitted by the contracts in mined transactions: PolicyAllowed and AutoRepayExecuted." />}
          <ul className="divide-y divide-line">
            {shown.map((entry) => (
              <Entry key={entry.id} entry={entry} fixture={fixture} />
            ))}
          </ul>
        </Card>
      )}
      {coverage && !coverage.complete ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line px-4 py-3 text-[0.8125rem]" data-testid="activity-coverage">
          <p className="min-w-0 flex-1 text-muted">
            On-chain events are read from block <span className="num text-fg">{coverage.fromBlock.toString()}</span> to <span className="num text-fg">{coverage.toBlock.toString()}</span>. Earlier history has not been scanned: the network's public RPC only answers log queries {LOG_PAGE_BLOCKS.toString()} blocks at a time.
          </p>
          <Button size="sm" variant="secondary" onClick={scanFurther} disabled={activity.isFetching}>
            Scan further back
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-faint">A reverted transaction leaves no events. For rejections, the evidence is the receipt status and the decoded revert reason, or a simulation that was never sent.</p>

      <KeeperPanel />

      <RecordedEvidence />
    </div>
  );
}

function Entry({ entry, fixture }: { entry: ActivityEntry; fixture: boolean }) {
  const error = entry.error ? mapContractError(entry.error) : null;
  const rejection = error ? REJECTION_BADGE[error.category] : undefined;
  const url = entry.txHash.status === "ok" ? explorerTxUrl(WRITE_CHAIN_ID, entry.txHash.value) : null;
  return (
    <li className="flex gap-3.5 p-4 sm:p-5" data-result={entry.result} data-category={error?.category}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised" title={entry.actor === "operator" ? "Operator (automation)" : "You (owner)"}>
        {entry.actor === "operator" ? <IconBot size={18} /> : <IconUser size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[0.9375rem] font-medium">
            {entry.title}
            {entry.amount ? <span className="num text-muted"> · {tokenAmount(entry.amount.value, entry.amount.token)}</span> : null}
          </h3>
          <time dateTime={entry.at} className="num text-xs text-faint">
            {formatTime(entry.at)}
          </time>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entry.result === "allowed" ? <Badge tone="success">Allowed</Badge> : <Badge tone={rejection?.tone ?? "neutral"}>{rejection?.label ?? "Failed"}</Badge>}
          <Badge tone="outline">{EVIDENCE_LABEL[entry.evidence]}</Badge>
          <Badge tone="outline">{entry.actor === "operator" ? "Operator" : "Owner"}</Badge>
          {fixture ? <ExampleTag /> : null}
        </div>
        {entry.detail ? <p className="mt-2 text-sm text-muted">{entry.detail}</p> : null}
        {error && entry.result !== "allowed" ? <p className="mt-1 text-sm">{error.title}.</p> : null}
        <div className="mt-2 text-xs text-faint">
          {entry.txHash.status === "ok" ? (
            url ? (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-fg underline underline-offset-4">
                {shortHash(entry.txHash.value)} <IconArrowUpRight size={12} />
              </a>
            ) : (
              <Mono>{shortHash(entry.txHash.value)}</Mono>
            )
          ) : (
            <span>No transaction hash: {entry.txHash.reason.toLowerCase()}.</span>
          )}
        </div>
        {error ? (
          <Advanced label="Raw error" className="mt-3">
            <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{rawErrorText(error.raw)}</pre>
          </Advanced>
        ) : null}
      </div>
    </li>
  );
}

/** Real receipts recorded by the contracts team on a local chain and on a mainnet fork. Never linked to a public explorer. */
function RecordedEvidence() {
  const local = EVIDENCE.localAutoRepay;
  const fork = EVIDENCE.forkSettlement;
  if (local.status !== "ok" && fork.status !== "ok") return null;
  return (
    <Card as="section">
      <CardHeader eyebrow="Not example data" title="Recorded receipts from development environments" description="Real contract executions, recorded in this repository. They did not happen on a public network, so there is no explorer link." />
      <ul className="divide-y divide-line">
        {local.status === "ok" ? (
          <Receipt
            badge={{ label: "Allowed", tone: "success" }}
            title={`Auto-repay · ${formatAmount(local.value.amountRaw, local.value.decimals)} test debt tokens`}
            detail={`AutoRepayExecuted: loan-to-value ${formatBps(local.value.ltvBeforeBps)} → ${formatBps(local.value.ltvAfterBps)} (${local.value.ltvBeforeBps} → ${local.value.ltvAfterBps} bps). Sent by the repay-only operator after a labelled mock price move.`}
            hash={local.value.hash}
            meta={`block ${local.value.block} · gas ${Number(local.value.gasUsed).toLocaleString("en-US")} · ${local.value.file}`}
            label={LOCAL_LABEL}
          />
        ) : null}
        {fork.status === "ok" ? (
          <>
            <Receipt
              badge={{ label: "Allowed", tone: "success" }}
              title="Sentinel borrow, both circuits allowed"
              detail={`Account circuit #${fork.value.evaluations[0]?.circuitId ?? "?"} and market circuit #${fork.value.evaluations[1]?.circuitId ?? "?"} both evaluated context ${fork.value.evaluations[0]?.context ?? "?"} and returned allow.`}
              hash={fork.value.borrow.hash}
              meta={`block ${fork.value.borrow.block} · gas ${Number(fork.value.borrow.gasUsed).toLocaleString("en-US")} · ${fork.value.file}`}
              label={FORK_LABEL}
            />
            <Receipt
              badge={{ label: "Stopped by account policy", tone: "warning" }}
              title="Sentinel borrow rejected by the account policy"
              detail={`Mined revert with AccountPolicyRejected (selector ${fork.value.accountDenial.selector}).`}
              hash={fork.value.accountDenial.hash}
              meta={`block ${fork.value.accountDenial.block} · gas ${Number(fork.value.accountDenial.gasUsed).toLocaleString("en-US")}`}
              label={FORK_LABEL}
            />
            <Receipt
              badge={{ label: "Blocked by market policy", tone: "danger" }}
              title="Direct pToken borrow rejected by the market policy"
              detail={`A bypass attempt that skips the Sentinel account. Mined revert with MarketPolicyRejected (selector ${fork.value.marketDenial.selector}).`}
              hash={fork.value.marketDenial.hash}
              meta={`block ${fork.value.marketDenial.block} · gas ${Number(fork.value.marketDenial.gasUsed).toLocaleString("en-US")}`}
              label={FORK_LABEL}
            />
          </>
        ) : null}
      </ul>
    </Card>
  );
}

function Receipt({ badge, title, detail, hash, meta, label }: { badge: { label: string; tone: Tone }; title: string; detail: string; hash: string; meta: string; label: string }) {
  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <h3 className="mt-2 text-[0.9375rem] font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted">{detail}</p>
      <p className="mt-2 text-xs font-medium text-warning">{label}</p>
      <p className="num mt-1 text-xs text-faint">
        <Mono className="text-xs">{hash}</Mono>
        <br />
        {meta}
      </p>
    </li>
  );
}

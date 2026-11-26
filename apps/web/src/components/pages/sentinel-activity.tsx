"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { tokenAmount } from "@/components/domain/market-bits";
import { Advanced, Badge, Button, Card, CardHeader, EmptyState, ExampleTag, Mono, Skeleton, type Tone, cx } from "@/components/ui/core";
import { IconArrowUpRight, IconBot, IconUser } from "@/components/ui/icons";
import { useActivity } from "@/hooks/use-data";
import { formatAmount, formatBps } from "@/lib/amount";
import { LogCoverageText } from "@/components/domain/log-coverage";
import { WRITE_CHAIN_ID, explorerTxUrl } from "@/lib/chains";
import { type ErrorCategory, mapContractError, rawErrorText } from "@/lib/errors";
import { EVIDENCE, FORK_LABEL, LOCAL_LABEL, TESTNET_LABEL } from "@/lib/evidence";
import { formatTime, shortHash } from "@/lib/format";
import { services } from "@/services";
import { extendLogWindow } from "@/services/chain/client";
import { verifyKeeperReceipts } from "@/services/chain/reads";
import type { ActivityEntry, ActivityEvidence } from "@/services/types";
import { KeeperPanel } from "./keeper-panel";
import { ActivitySnapshot, MinedRejections } from "./public-records";
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
      <SentinelHeader title="Activity" description="Everything your account and its operator attempted: what was allowed, what was stopped, by which rule, and how we know." />

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
        <EmptyState title="Nothing here yet">Actions by you or your operator will appear here with their outcome{coverage && !coverage.complete ? " (in the block ranges that were read, see below)" : ""}.</EmptyState>
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
            <LogCoverageText coverage={coverage} />
          </p>
          <Button size="sm" variant="secondary" onClick={scanFurther} disabled={activity.isFetching}>
            Scan more blocks
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-faint">A reverted transaction leaves no events. For rejections, the evidence is the receipt status and the decoded revert reason, or a simulation that was never sent.</p>

      <KeeperPanel />

      <ActivitySnapshot />
      <MinedRejections />
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
            <pre className="overflow-x-auto font-mono text-xs break-all whitespace-pre-wrap">{rawErrorText(error.raw)}</pre>
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
  const testnet = EVIDENCE.testnetAutoRepay;
  // On the testnet build the page re-reads this receipt from the public RPC instead of only quoting the record.
  const rereadable = testnet.status === "ok" && services.activity.source === "chain" && WRITE_CHAIN_ID === testnet.value.chainId;
  const reread = useQuery({
    queryKey: ["evidence", "testnet-auto-repay"],
    queryFn: async () => (testnet.status === "ok" ? ((await verifyKeeperReceipts(testnet.value.account as `0x${string}`, [testnet.value.hash as `0x${string}`]))[testnet.value.hash.toLowerCase()] ?? null) : null),
    enabled: rereadable,
    staleTime: 60_000,
  });
  if (local.status !== "ok" && fork.status !== "ok" && testnet.status !== "ok") return null;
  return (
    <Card as="section">
      <CardHeader eyebrow="Not example data" title="Recorded receipts" description="Real contract executions, recorded in this repository. Only the public testnet transaction has an explorer link; local and fork receipts did not happen on a public network." />
      <ul className="divide-y divide-line">
        {testnet.status === "ok" ? (
          <Receipt
            testid="testnet-auto-repay"
            badge={{ label: "Allowed", tone: "success" }}
            title={`Auto-repay on X Layer testnet · ${formatAmount(testnet.value.amountRaw, testnet.value.decimals)} test debt tokens`}
            detail={`AutoRepayExecuted: loan-to-value ${formatBps(testnet.value.ltvBeforeBps)} → ${formatBps(testnet.value.ltvAfterBps)} (${testnet.value.ltvBeforeBps} → ${testnet.value.ltvAfterBps} bps). Sent by a separate repay-only operator after a labelled mock price move, from the Sentinel account's own idle funds.`}
            hash={testnet.value.hash}
            url={explorerTxUrl(testnet.value.chainId, testnet.value.hash)}
            meta={`block ${testnet.value.block} · gas ${Number(testnet.value.gasUsed).toLocaleString("en-US")} · ${testnet.value.file}`}
            label={TESTNET_LABEL}
            live={
              !rereadable ? null : reread.isPending ? (
                <span className="text-faint">Reading the receipt from the testnet RPC…</span>
              ) : reread.data?.found ? (
                <span className={reread.data.status === "success" ? "text-success" : "text-danger"} data-testid="testnet-receipt-reread" data-status={reread.data.status}>
                  Re-read from the testnet RPC just now: {reread.data.status}, block {reread.data.blockNumber.toString()}
                  {reread.data.autoRepay ? `, AutoRepayExecuted ${formatAmount(reread.data.autoRepay.amount, testnet.value.decimals)}, loan-to-value ${formatBps(reread.data.autoRepay.ltvBeforeBps)} → ${formatBps(reread.data.autoRepay.ltvAfterBps)}` : ""}.
                </span>
              ) : (
                <span className="text-warning">The receipt could not be re-read from the RPC right now. The recorded values above are from the repository.</span>
              )
            }
          />
        ) : null}
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

function Receipt({ badge, title, detail, hash, meta, label, url, live, testid }: { badge: { label: string; tone: Tone }; title: string; detail: string; hash: string; meta: string; label: string; url?: string | null; live?: React.ReactNode; testid?: string }) {
  return (
    <li className="p-4 sm:p-5" data-testid={testid}>
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
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4" data-testid="explorer-link">
          View on the X Layer testnet explorer <IconArrowUpRight size={13} />
        </a>
      ) : null}
      {live ? <p className="mt-2 text-xs">{live}</p> : null}
    </li>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, ExampleTag, Notice, Skeleton, cx } from "@/components/ui/core";
import { IconAlert, IconLock } from "@/components/ui/icons";
import { useOperationPreview } from "@/hooks/use-data";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatAmount, formatBps, parseAmount } from "@/lib/amount";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { Op, type OpId } from "@/lib/policy";
import { RUNTIME } from "@/services";
import type { ActingPath, Leg, Market, OperationRequest, Position, SentinelAccount } from "@/services/types";
import { AmountInput } from "./amount-input";
import { CheckList, PreviewEvidence, RejectionCallout, friendlyFromPreview } from "./policy-checks";
import { TxFeedback, useSimulatedTx } from "./tx-feedback";

export type ActionTab = "supply" | "borrow" | "repay" | "withdraw";
const TABS: Array<{ id: ActionTab; label: string; op: OpId }> = [
  { id: "supply", label: "Supply", op: Op.SUPPLY },
  { id: "borrow", label: "Borrow", op: Op.BORROW },
  { id: "repay", label: "Repay", op: Op.REPAY },
  { id: "withdraw", label: "Withdraw", op: Op.REDEEM },
];

/** `path` is controlled by the page so the position card and the action panel always describe the same holder. */
export function ActionPanel({ market, account, direct, initialTab = "supply", path, onPathChange }: { market: Market; account: SentinelAccount | null; direct: Position | null; initialTab?: ActionTab; path: ActingPath; onPathChange: (path: ActingPath) => void }) {
  const [tab, setTab] = useState<ActionTab>(initialTab);
  const setPath = onPathChange;
  const [leg, setLeg] = useState<Leg>("collateral");
  const [text, setText] = useState("");
  const gate = useWriteGate("market");
  const tx = useSimulatedTx();
  const resetTx = tx.reset;

  const op = TABS.find((entry) => entry.id === tab)!.op;
  // Borrow and repay are always in the debt asset. Lending the debt asset is a wallet action; the Sentinel account supplies collateral only.
  const effectiveLeg: Leg = tab === "borrow" || tab === "repay" ? "debt" : path === "sentinel" ? "collateral" : leg;
  const token = effectiveLeg === "collateral" ? market.collateral.token : market.debt.token;
  const position = path === "sentinel" ? (account?.position ?? null) : direct;

  useEffect(() => {
    setText("");
    resetTx();
  }, [tab, path, effectiveLeg, resetTx]);

  const parsed = parseAmount(text, token.decimals);
  const amount = parsed.ok && parsed.value > 0n ? parsed.value : null;
  const request = useMemo<OperationRequest | null>(() => (amount !== null && position ? { marketId: market.id, path, op, leg: effectiveLeg, amount } : null), [amount, position, market.id, path, op, effectiveLeg]);
  const preview = useOperationPreview(request);
  const data = request && preview.data && preview.data.request.amount === request.amount && preview.data.request.op === request.op && preview.data.request.path === request.path ? preview.data : null;
  const rejection = data ? friendlyFromPreview(data) : null;

  const max = !position
    ? undefined
    : tab === "supply"
      ? effectiveLeg === "collateral" ? position.idleCollateral : position.idleDebtAsset
      : tab === "repay"
        ? position.idleDebtAsset < position.debt ? position.idleDebtAsset : position.debt
        : tab === "withdraw"
          ? effectiveLeg === "collateral" ? position.collateralSupplied : position.lent
          : undefined;
  const maxLabel = tab === "supply" ? "Available" : tab === "repay" ? "Repayable" : "Supplied";

  const actionLabel = `${TABS.find((entry) => entry.id === tab)!.label} ${token.symbol}`;
  const needsApproval = path === "direct" && (tab === "supply" || tab === "repay");
  const inactiveBlock = !market.active && tab === "borrow";

  const simulate = () => {
    if (!data) return;
    tx.run({
      approval: needsApproval ? `Approve ${token.symbol}` : undefined,
      action: `${actionLabel} from ${path === "sentinel" ? "your Sentinel account" : "your wallet"}`,
      simulatedFailure: rejection,
      successSummary: `${formatAmount(data.request.amount, token.decimals)} ${token.symbol} · loan-to-value ${data.ltvBeforeBps.status === "ok" ? formatBps(data.ltvBeforeBps.value) : "n/a"} → ${data.ltvAfterBps.status === "ok" ? formatBps(data.ltvAfterBps.value) : "n/a"}`,
    });
  };

  return (
    <div className="space-y-5" data-testid="action-panel">
      <div role="tablist" aria-label="Action" className="grid grid-cols-4 gap-1 rounded-full bg-raised p-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cx("h-9 rounded-full text-sm font-medium transition-colors", tab === entry.id ? "bg-bg text-fg shadow-none ring-1 ring-line" : "text-muted hover:text-fg")}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Act as</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PathOption active={path === "sentinel"} disabled={!account} onClick={() => setPath("sentinel")} title="Sentinel account" hint={account ? "Your policy applies" : "No account yet"} />
          <PathOption active={path === "direct"} onClick={() => setPath("direct")} title="Wallet" hint="Market policy only" />
        </div>
      </fieldset>

      {path === "direct" && (tab === "supply" || tab === "withdraw") ? (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(["collateral", "debt"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={leg === option}
              onClick={() => setLeg(option)}
              className={cx("h-10 rounded-control border px-3 font-medium", leg === option ? "border-fg" : "border-line text-muted hover:text-fg")}
            >
              {option === "collateral" ? `${market.collateral.token.symbol} collateral` : `Lend ${market.debt.token.symbol}`}
            </button>
          ))}
        </div>
      ) : null}

      {position ? (
        <AmountInput label="Amount" token={token} value={text} onChange={setText} max={max} maxLabel={maxLabel} />
      ) : (
        <Notice icon={<IconAlert size={18} />} title="Nothing to act on">
          {path === "sentinel" ? "You have no Sentinel account for this market yet." : "Position data is unavailable for this wallet."}
        </Notice>
      )}

      {inactiveBlock ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="Market is not active">
          The owner has not activated this market. Borrowing opens after activation; supplying is already possible.
        </Notice>
      ) : null}

      {request ? (
        data ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Before you sign</h3>
                {data.source === "fixture" ? <ExampleTag /> : null}
              </div>
              <p className="mt-0.5 text-xs text-faint">{data.method}</p>
            </div>
            <dl className="num divide-y divide-line rounded-control border border-line px-3.5 text-sm">
              <Row label="Loan-to-value (estimate)">
                {data.ltvBeforeBps.status === "ok" ? formatBps(data.ltvBeforeBps.value) : "n/a"} → <span className="font-semibold">{data.ltvAfterBps.status === "ok" ? formatBps(data.ltvAfterBps.value) : "undefined"}</span>
              </Row>
              <Row label="Approval">{needsApproval ? `Exact amount of ${token.symbol}, first` : path === "sentinel" ? "None: uses account funds" : "Not needed"}</Row>
              <Row label="Network fee">
                <span className="text-faint">{RUNTIME.modes.market.source === "fixture" ? "Unavailable in fixture mode" : "Estimated at signing"}</span>
              </Row>
            </dl>
            <CheckList checks={data.checks} />
            {rejection && tx.state.phase === "idle" ? <RejectionCallout error={rejection} marketId={market.id} simulated /> : null}
            <PreviewEvidence preview={data} />
          </div>
        ) : preview.isError ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="Preview unavailable">
            {preview.error instanceof Error ? preview.error.message : "The preview could not be computed."}
          </Notice>
        ) : (
          <Skeleton className="h-40" />
        )
      ) : null}

      <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} marketId={market.id} />

      <div className="space-y-2.5">
        <Button className="w-full" size="lg" disabled={!gate.allowed || !data || rejection !== null || inactiveBlock}>
          {!gate.allowed ? <IconLock size={17} /> : null}
          {actionLabel}
        </Button>
        {!gate.allowed ? (
          <p className="text-center text-[0.8125rem] text-muted" data-testid="write-gate-reason">
            {gate.message}
          </p>
        ) : null}
        {gate.allowed === false && gate.reason === "fixture" ? (
          <Button variant="secondary" className="w-full" disabled={!data || tx.state.phase === "running"} onClick={simulate} data-testid="simulate">
            {tx.state.phase === "done" ? "Run simulation again" : "Walk through as a simulation"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PathOption({ active, disabled, onClick, title, hint }: { active: boolean; disabled?: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} className={cx("rounded-control border px-3 py-2.5 text-left disabled:opacity-50", active ? "border-fg" : "border-line hover:border-line-strong")}>
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted">{hint}</span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

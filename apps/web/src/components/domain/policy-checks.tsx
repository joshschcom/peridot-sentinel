import Link from "next/link";
import type { ReactNode } from "react";
import { Advanced, Badge, Mono, cx } from "@/components/ui/core";
import { IconAlert, IconCheck, IconMarkets, IconMinus, IconShield, IconX } from "@/components/ui/icons";
import { type FriendlyError, mapContractError, rawErrorText } from "@/lib/errors";
import type { CheckResult, OperationPreview } from "@/services/types";

const CHECK_HINT: Record<CheckResult["id"], string> = {
  balance: "Funds",
  "account-policy": "Set by you",
  protocol: "Always enforced",
  "market-policy": "Set by the market owner",
};

/** The layers a transaction passes through, in on-chain order. Not a single made-up risk score. */
export function CheckList({ checks, compact = false }: { checks: CheckResult[]; compact?: boolean }) {
  return (
    <ol className="divide-y divide-line rounded-control border border-line">
      {checks.map((check) => (
        <li key={check.id} className="flex gap-3 px-3.5 py-3">
          <StatusDot status={check.status} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium">{check.title}</span>
              <span className="text-xs text-faint">{CHECK_HINT[check.id]}</span>
            </div>
            {compact ? null : <p className="num mt-0.5 text-[0.8125rem] text-muted">{check.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StatusDot({ status }: { status: CheckResult["status"] }) {
  const map = {
    pass: { className: "bg-success-soft text-success", icon: <IconCheck size={13} strokeWidth={2.4} />, label: "Passes" },
    fail: { className: "bg-danger-soft text-danger", icon: <IconX size={13} strokeWidth={2.4} />, label: "Fails" },
    "not-applicable": { className: "bg-raised text-faint", icon: <IconMinus size={13} strokeWidth={2.4} />, label: "Does not apply" },
  }[status];
  return (
    <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", map.className)}>
      {map.icon}
      <span className="sr-only">{map.label}</span>
    </span>
  );
}

/**
 * Rejection states. A MARKET policy rejection and a SENTINEL (account) policy rejection are
 * deliberately different in colour, icon, wording and next step, so they can never be confused:
 *   market   danger tone, market icon, "set by the market owner", link to the market policy
 *   sentinel warning tone, shield icon, "your own rule protected you", link to edit the policy
 * Evaluation failures and protocol limits are separate states again.
 */
export function RejectionCallout({ error, marketId, simulated }: { error: FriendlyError; marketId?: string; simulated: boolean }) {
  type Variant = { box: string; iconBox: string; icon: ReactNode; label: string; link?: { href: string; text: string } };
  const variants: Record<string, Variant> = {
    "market-policy": {
      box: "border-danger bg-danger-soft",
      iconBox: "bg-danger text-bg",
      icon: <IconMarkets size={18} />,
      label: "Market policy",
      link: marketId ? { href: `/markets/${marketId}#policy`, text: "View this market's policy" } : undefined,
    },
    "account-policy": {
      box: "border-warning bg-warning-soft",
      iconBox: "bg-warning text-bg",
      icon: <IconShield size={18} />,
      label: "Your Sentinel policy",
      link: { href: "/sentinel/policy", text: "Review your policy" },
    },
    "policy-unavailable": { box: "border-line-strong bg-subtle", iconBox: "bg-raised text-fg", icon: <IconAlert size={18} />, label: "Policy unavailable" },
    protocol: { box: "border-line-strong bg-subtle", iconBox: "bg-inverse text-on-inverse", icon: <IconAlert size={18} />, label: "Protocol limit" },
  };
  const variant: Variant = variants[error.category] ?? { box: "border-line-strong bg-subtle", iconBox: "bg-raised text-fg", icon: <IconAlert size={18} />, label: "Failed" };
  return (
    <div role="alert" data-rejection={error.category} className={cx("rounded-control border p-4", variant.box)}>
      <div className="flex items-start gap-3">
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-full", variant.iconBox)}>{variant.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow !text-fg">{variant.label}</span>
            {simulated ? <Badge tone="outline">Simulation · nothing sent</Badge> : <Badge tone="outline">Reverted on chain</Badge>}
          </div>
          <h3 className="mt-1 text-base font-semibold tracking-tight">{error.title}</h3>
          <p className="mt-1 text-sm text-muted">{error.message}</p>
          {error.hint ? <p className="mt-1 text-sm">{error.hint}</p> : null}
          {variant.link ? (
            <Link href={variant.link.href} className="mt-2 inline-block text-sm font-medium underline underline-offset-4">
              {variant.link.text}
            </Link>
          ) : null}
        </div>
      </div>
      <Advanced label="Raw error" className="mt-3 border-line-strong bg-bg">
        <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{rawErrorText(error.raw)}</pre>
      </Advanced>
    </div>
  );
}

/** Evidence for a preview: the exact circuit inputs and outputs, for the advanced view. */
export function PreviewEvidence({ preview }: { preview: OperationPreview }) {
  return (
    <Advanced label="Circuit evidence">
      <dl className="space-y-2">
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="text-muted">Method</dt>
          <dd>{preview.method}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="text-muted">Policy circuits apply</dt>
          <dd>{preview.applies ? "Yes" : "No (never gated)"}</dd>
        </div>
        {preview.context.status === "ok" ? (
          <>
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt className="text-muted">Context (3 bytes, LSB first)</dt>
              <dd>
                <Mono>{preview.context.value.inputs}</Mono>
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt className="text-muted">op · oracleFresh · postLtvBps · cashOk</dt>
              <dd className="num">
                {preview.context.value.op} · {String(preview.context.value.oracleFresh)} · {preview.context.value.postLtvBps} · {String(preview.context.value.cashOk)}
              </dd>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted">Context</dt>
            <dd className="text-faint">{preview.context.reason}</dd>
          </div>
        )}
        {preview.checks
          .filter((check) => check.evaluation)
          .map((check) => (
            <div key={check.id} className="flex flex-wrap justify-between gap-x-4">
              <dt className="text-muted">{check.title} output</dt>
              <dd>
                <Mono>{check.evaluation!.output}</Mono> {check.evaluation!.allow ? "allow" : "deny"}
              </dd>
            </div>
          ))}
      </dl>
    </Advanced>
  );
}

export function friendlyFromPreview(preview: OperationPreview): FriendlyError | null {
  if (preview.outcome.status !== "rejected") return null;
  if (preview.outcome.by === "balance") {
    return { category: "wallet", title: "Not enough funds", message: preview.checks.find((check) => check.id === "balance")?.detail ?? "The amount exceeds what is available.", raw: preview.outcome.error };
  }
  return mapContractError(preview.outcome.error);
}

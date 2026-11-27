"use client";
/** Shared pieces for strategy templates: the availability badge, the fact list, and how untrusted text is shown. */
import { useQuery } from "@tanstack/react-query";
import { Advanced, Badge, type Tone } from "@/components/ui/core";
import { useAccounts, useMarkets } from "@/hooks/use-data";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount, formatBps } from "@/lib/amount";
import { formatDay, shortAddress } from "@/lib/format";
import { type CheckedStrategy, STRATEGY_AVAILABILITY_LABEL, type Strategy, type StrategyAvailability, matchesDebtProtection, templateFacts } from "@/lib/strategy";
import { STRATEGY_CONTEXT } from "@/lib/strategy-context";
import { services } from "@/services";
import { V2_OWNER_TARGET, readOwnerV2 } from "@/services/chain/v2-owner";
import { RUNTIME } from "@/services/runtime";
import type { Address, LogCoverage } from "@/services/types";

const TONE: Record<StrategyAvailability, Tone> = { available: "success", demonstration: "warning", planned: "outline" };

/**
 * "Available on testnet" and "Planned" must never be mistaken for one another: available is a filled green pill with
 * a solid dot, planned is a dashed outline with a hollow dot (shape and border, not colour alone).
 */
export function StrategyBadge({ status, label }: { status: StrategyAvailability; label?: string }) {
  return (
    <Badge tone={TONE[status]} wrap className={status === "planned" ? "border-dashed" : undefined}>
      <span aria-hidden="true" className={status === "planned" ? "size-1.5 shrink-0 rounded-full border border-current" : "size-1.5 shrink-0 rounded-full bg-current"} />
      <span data-strategy-availability={status}>{label ?? STRATEGY_AVAILABILITY_LABEL[status]}</span>
    </Badge>
  );
}

/**
 * Free text of a template (name, description, objective, instructions). It may come from a file a stranger wrote, so
 * it is rendered as a plain text node, wrapped, never interpreted, never linked, and visibly attributed.
 */
export function TemplateText({ label, text, untrusted }: { label: string; text: string; untrusted: boolean }) {
  return (
    <div>
      <div className="text-[0.8125rem] text-muted">
        {label}
        {untrusted ? <span className="text-warning"> · imported text, shown exactly as written</span> : null}
      </div>
      <p className="mt-0.5 text-sm break-words whitespace-pre-wrap" data-template-text={label.toLowerCase()}>
        {text}
      </p>
    </div>
  );
}

export function TemplateFacts({ template }: { template: Strategy }) {
  const facts = templateFacts(template);
  return (
    <>
      <dl className="divide-y divide-line text-sm" data-testid="template-facts">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="shrink-0 text-muted">{fact.label}</dt>
            <dd className="num min-w-0 break-words sm:text-right">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <Advanced label="Pinned identities (addresses, circuit, raw units)" className="mt-3">
        <dl className="space-y-2 text-[0.8125rem]">
          {facts
            .filter((fact) => fact.detail)
            .map((fact) => (
              <div key={fact.label}>
                <dt className="text-muted">{fact.label}</dt>
                <dd className="font-mono break-all">{fact.detail}</dd>
              </div>
            ))}
          <div>
            <dt className="text-muted">Source commit of the contracts</dt>
            <dd className="font-mono break-all">{template.deployment.sourceCommit}</dd>
          </div>
        </dl>
      </Advanced>
    </>
  );
}

export function TemplateIdentity({ strategy }: { strategy: CheckedStrategy }) {
  return (
    <p className="text-xs text-faint">
      Content hash <span className="font-mono break-all" data-testid="template-hash">{strategy.hash}</span>. It identifies this exact template text. It is not a signature and authorises nothing.
    </p>
  );
}

/* ---------- strategies that are active on the connected wallet's accounts, derived from the chain ---------- */

export interface ActiveStrategy {
  id: string;
  /** "Debt protection" only when the authorisation has that shape; a grant carries no template identity on chain. */
  title: string;
  shapeNote: string;
  accountKind: "Sentinel account v1" | "Sentinel account v2";
  account: string | null;
  where: string;
  operator: string | null;
  operations: string;
  /** Budget still available to the operator, as text with its unit. This is the only "allocation" the chain states. */
  budgetLeft: string;
  budgetOf: string | null;
  budgetAsset: string;
  budgetLeftRaw: bigint;
  /**
   * The most the operator could move right now under this authorisation, when that is derivable from chain state:
   * the smallest of the budget left and the funds actually there (v1 repay: idle debt asset and outstanding debt;
   * v2 swap: the per-swap limit and the idle input token). Null when it cannot be derived.
   */
  usableNow: string | null;
  trigger: string | null;
  expires: string;
  status: "active" | "expired" | "spent" | "trigger-off";
  href: string;
  example: boolean;
}

export const ACTIVE_STATUS_LABEL: Record<ActiveStrategy["status"], string> = { active: "Active", expired: "Expired", spent: "Budget spent", "trigger-off": "Authorised, trigger off" };
export const ACTIVE_STATUS_TONE: Record<ActiveStrategy["status"], Tone> = { active: "success", expired: "warning", spent: "neutral", "trigger-off": "warning" };

const utcDay = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** v2 accounts are read on the build's own target chain (testnet, or the local chain with its own deployment). */
const V2_ON = V2_OWNER_TARGET !== null && RUNTIME.modes.account.source === "chain";

export function useActiveStrategies(): { loading: boolean; unavailable: string | null; strategies: ActiveStrategy[]; v1Partial: { coverage?: LogCoverage; failed: boolean } | null; v2: "off" | "loading" | "error" | "none" | "account"; hasAccount: boolean } {
  const accounts = useAccounts();
  const markets = useMarkets();
  const wallet = useWallet();
  const target = V2_OWNER_TARGET;
  const owner = wallet.status === "connected" && (!target || wallet.chainId === target.chainId) ? (wallet.address as Address) : null;
  // Same query key as the owner pages, so a grant signed there is reflected here without a second read.
  const v2Read = useQuery({ queryKey: ["v2-owner", target?.chainId, owner], queryFn: () => readOwnerV2(target!, owner!), enabled: V2_ON && owner !== null, staleTime: 15_000, retry: 1 });
  const v2 = { ...v2Read, data: v2Read.data?.base ?? null };
  const chain = services.account.source === "chain";
  const list = accounts.data?.status === "ok" ? accounts.data.value : [];
  const strategies: ActiveStrategy[] = [];
  let v1Partial: { coverage?: LogCoverage; failed: boolean } | null = null;
  for (const account of list) {
    const market = markets.data?.status === "ok" ? markets.data.value.find((entry) => entry.id === account.marketId) : undefined;
    const token = market?.debt.token;
    const address = account.address.status === "ok" ? account.address.value : null;
    if (chain && account.operatorDiscovery && (!account.operatorDiscovery.complete || account.operatorDiscovery.failed)) v1Partial = { coverage: account.operatorDiscovery.coverage, failed: account.operatorDiscovery.failed };
    for (const grant of account.operators) {
      if (grant.revoked) continue;
      const shaped = matchesDebtProtection(grant.opsMask, account.autoRepayTriggerBps);
      const repay = (grant.opsMask & 8) !== 0;
      const borrow = (grant.opsMask & 4) !== 0;
      const amount = (raw: bigint) => (token ? `${formatAmount(raw, token.decimals)} ${token.symbol}` : `${raw.toString()} raw units`);
      strategies.push({
        id: `v1:${account.marketId}:${grant.operator.status === "ok" ? grant.operator.value : grant.label}`,
        title: shaped ? "Debt protection" : repay && !borrow ? "Repay-only operator" : "Operator authorisation",
        shapeNote: shaped ? "Matches the Debt protection template by shape: a repay-only operator and a trigger. The chain does not record which template was used." : "Does not match a curated template. Shown as the authorisation the account holds.",
        accountKind: "Sentinel account v1",
        account: address,
        where: market ? `${market.collateral.token.symbol} / ${market.debt.token.symbol} lending, market #${market.index}` : "Peridot lending",
        operator: grant.operator.status === "ok" ? grant.operator.value : null,
        operations: [repay ? "Repay from idle funds" : null, borrow ? "Borrow into the account" : null].filter(Boolean).join(", ") || "Nothing",
        budgetLeft: amount(grant.remaining),
        budgetOf: grant.granted.status === "ok" ? amount(grant.granted.value) : null,
        budgetAsset: token?.symbol ?? "raw units",
        budgetLeftRaw: grant.remaining,
        usableNow: repay && !borrow && !grant.expired ? amount([grant.remaining, account.position.idleDebtAsset, account.position.debt].reduce((least, value) => (value < least ? value : least))) : null,
        trigger: account.autoRepayTriggerBps > 0 ? `Loan-to-value ≥ ${formatBps(account.autoRepayTriggerBps)}` : "Disabled",
        expires: formatDay(grant.expiresAt),
        status: grant.expired ? "expired" : grant.remaining === 0n ? "spent" : repay && account.autoRepayTriggerBps === 0 ? "trigger-off" : "active",
        href: `/strategies?market=${account.marketId}#rules`,
        example: !chain,
      });
    }
  }
  if (V2_ON && v2.data && target) {
    for (const grant of v2.data.swapGrants) {
      const token = grant.inputAsset;
      const shaped = token.symbol === "mWOKB";
      strategies.push({
        id: `v2:${v2.data.account}:${grant.operator}:${grant.inputAsset}`,
        title: shaped ? "Restricted agent swap" : "Swap grant",
        shapeNote: shaped ? "Matches the Restricted agent swap template by shape: one swap grant spending mWOKB on the pinned adapter. The chain does not record which template was used." : "Does not match a curated template. Shown as the grant the account holds.",
        accountKind: "Sentinel account v2",
        account: v2.data.account,
        where: "mWOKB / mUSDC, mock swap venue",
        operator: grant.operator,
        operations: `Swap ${token.symbol} (exact input), at most ${formatAmount(grant.maxPerCall, token.decimals)} per swap`,
        budgetLeft: `${formatAmount(grant.remaining, token.decimals)} ${token.symbol}`,
        budgetOf: null,
        budgetAsset: token.symbol,
        budgetLeftRaw: grant.remaining,
        usableNow: grant.expired ? null : `${formatAmount([grant.remaining, grant.maxPerCall, token.symbol === "mWOKB" ? v2.data.idleWokb : v2.data.idleUsdc].reduce((least, value) => (value < least ? value : least)), token.decimals)} ${token.symbol}`,
        trigger: null,
        expires: utcDay(grant.expiry),
        status: grant.expired ? "expired" : grant.remaining === 0n ? "spent" : "active",
        href: "/strategies#stop",
        example: false,
      });
    }
  }
  return {
    loading: accounts.isPending || (V2_ON && owner !== null && v2Read.isPending),
    unavailable: accounts.data?.status === "unavailable" ? accounts.data.reason : null,
    strategies,
    v1Partial,
    v2: !V2_ON || owner === null ? "off" : v2Read.isPending ? "loading" : v2Read.isError ? "error" : v2.data ? "account" : "none",
    hasAccount: list.length > 0 || Boolean(v2.data),
  };
}

export const operatorText = (operator: string | null) => (operator ? shortAddress(operator) : "Example operator");

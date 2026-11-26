"use client";
/** Shared pieces for strategy templates: the availability badge, the fact list, and how untrusted text is shown. */
import { useQuery } from "@tanstack/react-query";
import { Advanced, Badge, type Tone } from "@/components/ui/core";
import { useAccounts, useMarkets } from "@/hooks/use-data";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount, formatBps } from "@/lib/amount";
import { IS_PRIVATE_FORK, TARGET_KIND } from "@/lib/chains";
import { EXPANSION } from "@/lib/expansion";
import { formatDay, shortAddress } from "@/lib/format";
import { type AvailabilityContext, type CheckedStrategy, STRATEGY_AVAILABILITY_LABEL, type Strategy, type StrategyAvailability, matchesDebtProtection, templateFacts } from "@/lib/strategy";
import { RUNTIME, services } from "@/services";
import { readV2Account, v2AccountOf } from "@/services/chain/expansion";
import { FORCE_FIXTURE } from "@/services/runtime";
import type { Address, LogCoverage } from "@/services/types";

const TONE: Record<StrategyAvailability, Tone> = { available: "success", demonstration: "warning", planned: "outline" };

export function StrategyBadge({ status, label }: { status: StrategyAvailability; label?: string }) {
  return (
    <Badge tone={TONE[status]} wrap>
      <span data-strategy-availability={status}>{label ?? STRATEGY_AVAILABILITY_LABEL[status]}</span>
    </Badge>
  );
}

/** What this build can do with testnet strategy templates. One object, so every page derives the same labels. */
export const STRATEGY_CONTEXT: AvailabilityContext = {
  testnetLive: TARGET_KIND === "testnet" && !FORCE_FIXTURE && RUNTIME.modes.account.source === "chain",
  v1: TARGET_KIND === "testnet" && RUNTIME.manifest.state === "deployed" ? RUNTIME.manifest.manifest : null,
  // A private-fork build exists to accept wallet signing against testnet state without touching the public chain,
  // so the v2 write switch is treated as on there, and only there. On public testnet the manifest's flag decides.
  v2: EXPANSION.manifest.status === "ok" ? (IS_PRIVATE_FORK ? { ...EXPANSION.manifest.value, uiEnabled: true } : EXPANSION.manifest.value) : null,
};

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

/** v2 reads exist only against public testnet (src/services/chain/expansion.ts). */
const V2_ON = STRATEGY_CONTEXT.testnetLive && STRATEGY_CONTEXT.v2 !== null;

export function useActiveStrategies(): { loading: boolean; unavailable: string | null; strategies: ActiveStrategy[]; v1Partial: { coverage?: LogCoverage; failed: boolean } | null; v2: "off" | "loading" | "error" | "none" | "account"; hasAccount: boolean } {
  const accounts = useAccounts();
  const markets = useMarkets();
  const wallet = useWallet();
  const owner = wallet.status === "connected" ? (wallet.address as Address) : null;
  const manifest = STRATEGY_CONTEXT.v2;
  const v2 = useQuery({
    queryKey: ["v2-active-strategies", owner],
    queryFn: async () => {
      const account = await v2AccountOf(manifest!, owner!);
      return account ? readV2Account(manifest!, account) : null;
    },
    enabled: V2_ON && owner !== null,
    staleTime: 30_000,
    retry: 1,
  });
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
  if (V2_ON && v2.data && manifest) {
    for (const grant of v2.data.swapGrants) {
      const token = grant.inputAsset.toLowerCase() === manifest.tokens.wokb.address.toLowerCase() ? manifest.tokens.wokb : manifest.tokens.usdc;
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
    loading: accounts.isPending || (V2_ON && owner !== null && v2.isPending),
    unavailable: accounts.data?.status === "unavailable" ? accounts.data.reason : null,
    strategies,
    v1Partial,
    v2: !V2_ON || owner === null ? "off" : v2.isPending ? "loading" : v2.isError ? "error" : v2.data ? "account" : "none",
    hasAccount: list.length > 0 || Boolean(v2.data),
  };
}

export const operatorText = (operator: string | null) => (operator ? shortAddress(operator) : "Example operator");

"use client";
import Link from "next/link";
import { LtvMeter } from "@/components/domain/ltv-meter";
import { Amount, marketTitle, tokenAmount, usdOf } from "@/components/domain/market-bits";
import { PolicyRules } from "@/components/domain/policy-card";
import { Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, EmptyState, Notice, Skeleton, Stat, Value } from "@/components/ui/core";
import { IconArrowRight, IconBot, IconLock, IconShield } from "@/components/ui/icons";
import { useAccounts, useMarket } from "@/hooks/use-data";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatBps, formatUsd } from "@/lib/amount";
import { formatDay } from "@/lib/format";
import { all2, mapMaybe, ok } from "@/lib/maybe";
import { Op } from "@/lib/policy";
import type { SentinelAccount } from "@/services/types";
import { positionLtv } from "./market-detail";
import { SentinelHeader } from "./sentinel-common";

export function SentinelOverview() {
  const accounts = useAccounts();
  const gate = useWriteGate("account");
  const list = accounts.data?.status === "ok" ? accounts.data.value : null;

  return (
    <div className="space-y-6">
      <SentinelHeader description="A smart account that holds your position and only acts within the policy you set. You stay the owner; automation can repay, never withdraw." />
      {accounts.isPending ? (
        <div className="space-y-4" data-loading>
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : list === null ? (
        <EmptyState title="Account data unavailable">{accounts.data?.status === "unavailable" ? accounts.data.reason : "Your accounts could not be loaded."}</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState
          title="Create your Sentinel account"
          action={
            <Button disabled={!gate.allowed}>
              {!gate.allowed ? <IconLock size={16} /> : null} Create account
            </Button>
          }
        >
          One account per market. You attach a personal policy when you create it, fund it with a plain token transfer, and withdraw to your own wallet at any time. {!gate.allowed ? gate.message : ""}
        </EmptyState>
      ) : (
        list.map((account) => <AccountView key={account.marketId} account={account} />)
      )}
      <HowItWorks />
    </div>
  );
}

function AccountView({ account }: { account: SentinelAccount }) {
  const market = useMarket(account.marketId);
  const gate = useWriteGate("account");
  const m = market.data?.status === "ok" ? market.data.value : null;
  if (market.isPending) return <Skeleton className="h-96" data-loading />;
  if (!m) return <EmptyState title="Market data unavailable">The market for this account could not be loaded.</EmptyState>;

  const p = account.position;
  const ltv = positionLtv(m, p);
  const collateralUsd = usdOf(ok(p.collateralSupplied + p.idleCollateral), m.collateral.token, m.collateral.price);
  const debtAssetUsd = usdOf(ok(p.idleDebtAsset), m.debt.token, m.debt.price);
  const debtUsd = usdOf(ok(p.debt), m.debt.token, m.debt.price);
  const net = mapMaybe(all2(all2(collateralUsd, debtAssetUsd), debtUsd), ([[c, i], d]) => c + i - d);
  const operator = account.operators.find((grant) => !grant.revoked) ?? null;
  const marketHref = `/markets/${m.id}`;

  return (
    <div className="space-y-6">
      <Card as="section" className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <IconShield size={17} className="text-fg" />
            <span className="font-medium text-fg">Sentinel account</span>
            <span aria-hidden="true">·</span>
            <Link href={marketHref} className="rounded underline-offset-4 hover:text-fg hover:underline">
              {marketTitle(m)}, market #{m.index}
            </Link>
          </div>
          <Badge tone="outline">Owner-controlled</Badge>
        </div>

        <div className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="text-sm text-muted">Net value</div>
            <div className="num mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
              <Value of={net}>{(v) => formatUsd(v)}</Value>
            </div>
            <div className="num mt-2 text-sm text-muted">Valued at the market's mock test prices. Test tokens have no real value.</div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Stat label="Collateral" value={<Amount value={p.collateralSupplied} token={m.collateral.token} />} sub={p.collateralEntered ? "Enabled as collateral" : "Not enabled"} />
            <Stat label="Debt" value={<Amount value={p.debt} token={m.debt.token} />} sub="Includes accrued interest" />
            <Stat label="Idle funds" value={<Amount value={p.idleDebtAsset} token={m.debt.token} />} sub={tokenAmount(p.idleCollateral, m.collateral.token)} />
            <Stat label="Loan-to-value" value={<Value of={ltv}>{(v) => formatBps(v)}</Value>} sub="Estimate" />
          </div>
        </div>

        <LtvMeter
          className="mt-7"
          value={ltv}
          markers={[
            ...(account.autoRepayTriggerBps > 0 ? [{ bps: account.autoRepayTriggerBps, label: "Auto-repay trigger" }] : []),
            { bps: account.policy.spec.params.maxLtvBps, label: "Your cap" },
            { bps: m.policy.spec.params.maxLtvBps, label: "Market policy cap" },
            { bps: m.limits.liquidationLtvBps, label: "Liquidation", tone: "danger" as const },
          ]}
        />

        <div className="mt-7 flex flex-wrap gap-2">
          <ButtonLink href={marketHref}>
            Supply or borrow <IconArrowRight size={16} />
          </ButtonLink>
          <ButtonLink href={marketHref} variant="secondary">
            Repay
          </ButtonLink>
          <Button variant="secondary" disabled={!gate.allowed} title={gate.allowed ? undefined : gate.message}>
            {!gate.allowed ? <IconLock size={15} /> : null} Withdraw to owner
          </Button>
        </div>
        {!gate.allowed ? <p className="mt-3 text-[0.8125rem] text-muted">{gate.message}</p> : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section">
          <CardHeader
            eyebrow="Set by you"
            title="Your policy"
            description="Checked inside the contract before the market is asked."
            action={
              <Link href="/sentinel/policy" className="text-sm font-medium underline underline-offset-4">
                Edit
              </Link>
            }
          />
          <div className="p-5 sm:p-6">
            <PolicyRules record={account.policy} />
          </div>
        </Card>

        <Card as="section">
          <CardHeader
            eyebrow="Automation"
            title="Auto-repay"
            description="A keeper may repay debt from this account's idle funds when your trigger is reached."
            action={operator ? <Badge tone="success">Authorised</Badge> : <Badge>Off</Badge>}
          />
          <dl className="divide-y divide-line px-5 sm:px-6">
            <DefinitionRow label="Trigger">{account.autoRepayTriggerBps > 0 ? `Loan-to-value ≥ ${formatBps(account.autoRepayTriggerBps)}` : "Disabled"}</DefinitionRow>
            {operator ? (
              <>
                <DefinitionRow label="Operator">{operator.label}</DefinitionRow>
                <DefinitionRow label="May">
                  {[(operator.opsMask & (1 << Op.REPAY)) !== 0 ? "Repay" : null, (operator.opsMask & (1 << Op.BORROW)) !== 0 ? "Borrow" : null].filter(Boolean).join(", ") || "Nothing"}
                </DefinitionRow>
                <DefinitionRow label="Budget left">
                  {tokenAmount(operator.budget - operator.spent, m.debt.token)} of {tokenAmount(operator.budget, m.debt.token, 0)}
                </DefinitionRow>
                <DefinitionRow label="Expires">{formatDay(operator.expiresAt)}</DefinitionRow>
              </>
            ) : null}
          </dl>
          <div className="p-5 sm:p-6">
            <Notice icon={<IconBot size={18} />} title="An operator can never withdraw">
              Withdrawals always pay the owner, and only the owner can change the policy or permissions. Automation is not a guarantee: prices, liquidity and network conditions can prevent a repayment in time.
            </Notice>
            <Link href="/sentinel/policy#automation" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
              Manage or revoke
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["Create", "One account per market, with your personal policy attached from the first block."],
    ["Fund", "Send test tokens to the account with a plain transfer. No special deposit call."],
    ["Supply and borrow", "The account holds the collateral and the debt. Borrowed funds settle into the account."],
    ["Stay in control", "Withdrawals always pay the owner. Repayment is never blocked by any policy."],
  ] as const;
  return (
    <Card as="section" className="p-5 sm:p-7">
      <h2 className="text-base font-semibold tracking-tight">How a Sentinel account works</h2>
      <ol className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([title, body], index) => (
          <li key={title}>
            <div className="num font-mono text-xs text-faint">0{index + 1}</div>
            <div className="mt-2 text-sm font-medium">{title}</div>
            <p className="mt-1 text-[0.8125rem] text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

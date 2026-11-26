"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AmountInput } from "@/components/domain/amount-input";
import { Sheet } from "@/components/ui/sheet";
import { LtvMeter } from "@/components/domain/ltv-meter";
import { Amount, marketTitle, tokenAmount, usdOf } from "@/components/domain/market-bits";
import { PolicyRules } from "@/components/domain/policy-card";
import { Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, EmptyState, Notice, Skeleton, Stat, Value } from "@/components/ui/core";
import { IconArrowRight, IconBot, IconLock, IconShield } from "@/components/ui/icons";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useAccounts, useMarket, useMarkets } from "@/hooks/use-data";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { services } from "@/services";
import { createAccountPlan, withdrawPlan } from "@/services/chain/plans";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatBps, formatUsd, parseAmount } from "@/lib/amount";
import { formatDay, shortAddress } from "@/lib/format";
import { all2, mapMaybe, ok } from "@/lib/maybe";
import { Op } from "@/lib/policy";
import type { Market, SentinelAccount } from "@/services/types";
import { positionLtv } from "./market-detail";
import { Portfolio } from "./portfolio";
import { SentinelHeader } from "./sentinel-common";

export function SentinelOverview() {
  const accounts = useAccounts();
  const gate = useWriteGate("account");
  const list = accounts.data?.status === "ok" ? accounts.data.value : null;

  return (
    <div className="space-y-6">
      <SentinelHeader title="Overview" description="A smart account that holds your position and only acts within the policy you set. You stay the owner; automation can repay, never withdraw." />
      {accounts.isPending ? (
        <div className="space-y-4" data-loading>
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : list === null ? (
        <EmptyState title="Account data unavailable">{accounts.data?.status === "unavailable" ? accounts.data.reason : "Your accounts could not be loaded."}</EmptyState>
      ) : services.account.source === "chain" ? (
        <>
          <Portfolio accounts={list} />
          {list.map((account) => (
            <AccountView key={account.marketId} account={account} />
          ))}
          <CreateAccounts existing={list.map((account) => account.marketId)} />
        </>
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
        <>
          <Portfolio accounts={list} />
          {list.map((account) => (
            <AccountView key={account.marketId} account={account} />
          ))}
        </>
      )}
      <HowItWorks />
    </div>
  );
}

function AccountView({ account }: { account: SentinelAccount }) {
  const market = useMarket(account.marketId);
  const gate = useWriteGate("account");
  const [withdrawing, setWithdrawing] = useState(false);
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
  const policyHref = `/sentinel/policy?market=${m.id}`;
  const automateHref = `/automate?market=${m.id}`;
  const chain = services.account.source === "chain";

  return (
    <div className="space-y-6" data-testid="sentinel-account" data-market={m.id} data-account={account.address.status === "ok" ? account.address.value : undefined}>
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
            ...(account.policy.identified ? [{ bps: account.policy.spec.params.maxLtvBps, label: "Your cap" }] : []),
            ...(m.policy.identified ? [{ bps: m.policy.spec.params.maxLtvBps, label: "Market policy cap" }] : []),
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
          <Button variant="secondary" disabled={!gate.allowed || !chain} title={gate.allowed ? undefined : gate.message} onClick={() => setWithdrawing(true)} data-testid="withdraw-open">
            {!gate.allowed ? <IconLock size={15} /> : null} Withdraw to owner
          </Button>
        </div>
        {chain ? <WithdrawSheet account={account} market={m} open={withdrawing} onClose={() => setWithdrawing(false)} /> : null}
        {!gate.allowed ? <p className="mt-3 text-[0.8125rem] text-muted">{gate.message}</p> : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section">
          <CardHeader
            eyebrow="Set by you"
            title="Your policy"
            description="Checked inside the contract before the market is asked."
            action={
              <Link href={policyHref} className="text-sm font-medium underline underline-offset-4">
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
            action={operator ? operator.expired ? <Badge tone="warning">Expired</Badge> : <Badge tone="success">Authorised</Badge> : <Badge>Off</Badge>}
          />
          <dl className="divide-y divide-line px-5 sm:px-6">
            <DefinitionRow label="Trigger">{account.autoRepayTriggerBps > 0 ? `Loan-to-value ≥ ${formatBps(account.autoRepayTriggerBps)}` : "Disabled"}</DefinitionRow>
            {operator ? (
              <>
                <DefinitionRow label="Operator">{operator.operator.status === "ok" ? <span className="font-mono text-[0.8125rem]">{shortAddress(operator.operator.value)}</span> : operator.label}</DefinitionRow>
                <DefinitionRow label="May">
                  {[(operator.opsMask & (1 << Op.REPAY)) !== 0 ? "Repay" : null, (operator.opsMask & (1 << Op.BORROW)) !== 0 ? "Borrow" : null].filter(Boolean).join(", ") || "Nothing"}
                </DefinitionRow>
                <DefinitionRow label="Budget left">
                  {tokenAmount(operator.remaining, m.debt.token)}
                  {operator.granted.status === "ok" ? ` of ${tokenAmount(operator.granted.value, m.debt.token, 0)}` : ""}
                </DefinitionRow>
                <DefinitionRow label="Expires">
                  {formatDay(operator.expiresAt)}
                  {operator.expired ? " (expired)" : ""}
                </DefinitionRow>
              </>
            ) : null}
          </dl>
          <div className="p-5 sm:p-6">
            <Notice icon={<IconBot size={18} />} title="An operator can never withdraw">
              Withdrawals always pay the owner, and only the owner can change the policy or permissions. Automation is not a guarantee: prices, liquidity and network conditions can prevent a repayment in time.
            </Notice>
            <Link href={automateHref} className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
              Manage, check or revoke
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Owner-only withdrawal of IDLE funds: `withdraw(asset, amount)` on the account always pays the immutable owner.
 * It is not a redeem. Supplied collateral stays in the market until it is withdrawn there first.
 */
function WithdrawSheet({ account, market, open, onClose }: { account: SentinelAccount; market: Market; open: boolean; onClose: () => void }) {
  const gate = useWriteGate("account");
  const tx = useChainTx();
  const [asset, setAsset] = useState<"debt" | "collateral">("debt");
  const [text, setText] = useState("");
  const reset = tx.reset;
  useEffect(() => {
    if (!open) {
      setText("");
      reset();
    }
  }, [open, reset]);
  const token = asset === "debt" ? market.debt.token : market.collateral.token;
  const idle = asset === "debt" ? account.position.idleDebtAsset : account.position.idleCollateral;
  const parsed = parseAmount(text, token.decimals);
  const amount = parsed.ok && parsed.value > 0n ? parsed.value : null;
  const tooMuch = amount !== null && amount > idle;
  const ready = gate.allowed && amount !== null && !tooMuch && account.address.status === "ok" && token.address.status === "ok" && tx.state.phase !== "running";
  const submit = async () => {
    if (!ready || account.address.status !== "ok" || token.address.status !== "ok" || amount === null) return;
    const result = await tx.run(withdrawPlan(account.address.value, token.address.value, amount, token.symbol), `${tokenAmount(amount, token)} sent from your Sentinel account to your wallet.`);
    if (result.ok) setText("");
  };
  return (
    <Sheet open={open} onClose={onClose} title="Withdraw to owner">
      <div className="space-y-5" data-testid="withdraw-sheet">
        <p className="text-sm text-muted">
          Sends idle funds from this account to its owner: your wallet{account.owner.status === "ok" ? <> (<span className="font-mono text-[0.8125rem]">{shortAddress(account.owner.value)}</span>)</> : null}. No other destination exists, and only the owner can call it.
        </p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(["debt", "collateral"] as const).map((option) => {
            const t = option === "debt" ? market.debt.token : market.collateral.token;
            return (
              <button key={option} type="button" aria-pressed={asset === option} onClick={() => { setAsset(option); setText(""); }} className={`min-h-11 rounded-control border px-3 py-2 text-left font-medium ${asset === option ? "border-fg" : "border-line text-muted hover:text-fg"}`} data-testid={`withdraw-asset-${option}`}>
                {t.symbol}
                <span className="num block text-xs font-normal text-muted">Idle: {tokenAmount(option === "debt" ? account.position.idleDebtAsset : account.position.idleCollateral, t)}</span>
              </button>
            );
          })}
        </div>
        <AmountInput label="Amount" token={token} value={text} onChange={setText} max={idle} maxLabel="Idle in account" />
        {tooMuch ? <p className="text-sm text-danger">Only {tokenAmount(idle, token)} is idle in the account.</p> : null}
        {account.position.debt > 0n && asset === "debt" ? (
          <Notice tone="warning" title="You still have debt">
            Idle {market.debt.token.symbol} is what you, or an authorised operator, can repay with. Withdrawing it leaves less for a repayment.
          </Notice>
        ) : null}
        <p className="text-[0.8125rem] text-muted">Supplied collateral is not idle. To take it out, withdraw it on the market page first; it then becomes idle in this account.</p>
        <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} marketId={market.id} />
        <Button className="w-full" size="lg" disabled={!ready} onClick={submit} data-testid="withdraw-submit">
          {!gate.allowed ? <IconLock size={17} /> : null} Withdraw {token.symbol} to my wallet
        </Button>
        {!gate.allowed ? <p className="text-center text-[0.8125rem] text-muted">{gate.message}</p> : null}
      </div>
    </Sheet>
  );
}

/** Chain mode: one Sentinel account per market, created from the owner's wallet with the published account policy. */
function CreateAccounts({ existing }: { existing: string[] }) {
  const markets = useMarkets();
  const gate = useWriteGate("account");
  const tx = useChainTx();
  const open = markets.data?.status === "ok" ? markets.data.value.filter((market) => !existing.includes(market.id)) : [];
  if (open.length === 0 && tx.state.phase === "idle") return null;
  return (
    <Card as="section">
      <CardHeader title="Create a Sentinel account" description="One account per market. The published account policy is attached at creation; you fund the account with a plain token transfer and can withdraw to your own wallet at any time." />
      <ul className="divide-y divide-line">
        {open.map((market) => (
          <li key={market.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <div className="text-sm">
              <span className="font-medium">{marketTitle(market)}</span> <span className="text-muted">· market #{market.index}{market.active ? "" : " · inactive"}</span>
            </div>
            <Button size="sm" disabled={!gate.allowed || tx.state.phase === "running" || market.controller.status !== "ok"} onClick={() => market.controller.status === "ok" && tx.run(createAccountPlan(market.controller.value), `Sentinel account created for market #${market.index}.`)} data-testid={`create-account-${market.id}`}>
              {!gate.allowed ? <IconLock size={15} /> : null} Create account
            </Button>
          </li>
        ))}
      </ul>
      <div className="space-y-3 p-5 sm:p-6">
        {!gate.allowed ? <p className="text-[0.8125rem] text-muted">{gate.message}</p> : null}
        <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
      </div>
    </Card>
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

"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AmountInput } from "@/components/domain/amount-input";
import { Sheet } from "@/components/ui/sheet";
import { LtvMeter } from "@/components/domain/ltv-meter";
import { Amount, marketTitle, tokenAmount, usdOf } from "@/components/domain/market-bits";
import { PolicyRules } from "@/components/domain/policy-card";
import { LogCoverageText } from "@/components/domain/log-coverage";
import { ACTIVE_STATUS_LABEL, useActiveStrategies } from "@/components/domain/strategy-bits";
import { Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, EmptyState, ExampleTag, Notice, Skeleton, Stat, Value, cx } from "@/components/ui/core";
import { IconArrowRight, IconBot, IconCheck, IconLock, IconShield } from "@/components/ui/icons";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useAccounts, useActivity, useMarket, useMarkets } from "@/hooks/use-data";
import { FAUCET_URL, WRITE_CHAIN_ID } from "@/lib/chains";
import { services } from "@/services";
import { createAccountPlan, withdrawPlan } from "@/services/chain/plans";
import { useWallet, useWriteGate } from "@/hooks/use-wallet";
import { formatBps, formatUsd, parseAmount } from "@/lib/amount";
import { formatDay, formatTime, shortAddress } from "@/lib/format";
import { type Maybe, all2, mapMaybe, ok, unavailable } from "@/lib/maybe";
import { Op } from "@/lib/policy";
import type { Market, SentinelAccount } from "@/services/types";
import { positionLtv } from "./market-detail";
import { Portfolio } from "./portfolio";
import { SentinelHeader } from "./sentinel-common";
import { EmergencyStop } from "./strategies";
import { ActiveStrategies } from "./strategy-active";
import { V2EmergencyStop } from "./v2-stop";

/**
 * Portfolio: the primary dashboard (DECISIONS D23). Everything on it is read from the chain for the connected wallet
 * (or is labelled example data): positions, the strategies acting on them, what those may still do, and the stop.
 * Nothing is estimated: a value that cannot be derived says "Unavailable", and there is no performance figure.
 */
export function PortfolioHome() {
  const accounts = useAccounts();
  const wallet = useWallet();
  const list = accounts.data?.status === "ok" ? accounts.data.value : null;
  const chain = services.account.source === "chain";
  const active = useActiveStrategies();
  const connected = wallet.status === "connected";
  const stoppable = (list ?? []).filter((account) => account.autoRepayTriggerBps > 0 || account.operators.some((grant) => !grant.revoked));

  return (
    <div className="space-y-6" data-testid="portfolio-home">
      <SentinelHeader
        eyebrow="Personal"
        title="Portfolio"
        description="Your positions, the strategies acting on them, and what those strategies are still allowed to do. You own the accounts; software only acts inside the grants you signed."
        actions={
          <>
            <ButtonLink href="/discover" variant="secondary" data-testid="portfolio-discover">
              Discover strategies
            </ButtonLink>
            <ButtonLink href="/strategies#create" data-testid="portfolio-create">
              Create strategy
            </ButtonLink>
          </>
        }
      />
      {accounts.isPending ? (
        <div className="space-y-4" data-loading>
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : chain && !connected ? (
        <>
          <Onboarding connected={false} accounts={0} strategies={0} supplied={false} />
          <p className="text-sm text-muted" data-testid="portfolio-disconnected">Connect a wallet to see your positions, strategies and budgets. Nothing is shown in their place: this page has no example numbers when it reads a real deployment.</p>
        </>
      ) : list === null ? (
        <EmptyState title="Account data unavailable">{accounts.data?.status === "unavailable" ? accounts.data.reason : "Your accounts could not be loaded."}</EmptyState>
      ) : (
        <>
          {(chain && !connected) || list.length === 0 || (!active.loading && active.strategies.length === 0) ? <Onboarding connected={connected || !chain} accounts={list.length} strategies={active.loading ? null : active.strategies.length} supplied={list.some((account) => account.position.collateralSupplied > 0n || account.position.debt > 0n)} /> : null}
          <Summary accounts={list} />
          <ActiveStrategies compact />
          <Budgets />
          <Portfolio accounts={list} />
          <RecentOperations />
          <section id="stop" className="scroll-mt-28 space-y-3" data-testid="portfolio-stop">
            <h2 className="text-lg font-semibold tracking-tight">Emergency revocation</h2>
            {chain && stoppable.length === 0 ? <p className="text-sm text-muted" data-testid="portfolio-stop-empty">{list.length === 0 ? "You have no Sentinel account, so nothing can act for you." : "Nothing to stop on your v1 accounts: no operator was found and no trigger is set."} A stop is always one page away on <Link href="/strategies#stop" className="text-fg underline underline-offset-4">Strategies</Link>.</p> : null}
            {chain ? stoppable.map((account) => <EmergencyStop key={account.marketId} account={account} />) : <p className="text-sm text-muted">Example data: the emergency stop sends real transactions and is available once the app reads a deployment. See <Link href="/strategies#stop" className="text-fg underline underline-offset-4">Strategies</Link>.</p>}
            <V2EmergencyStop />
          </section>
          <section id="accounts" className="scroll-mt-28 space-y-6">
            <h2 className="text-lg font-semibold tracking-tight">Your accounts</h2>
            {list.length === 0 && !chain ? <p className="text-sm text-muted">No example account.</p> : null}
            {list.map((account) => (
              <AccountView key={account.marketId} account={account} />
            ))}
            {chain ? <CreateAccounts existing={list.map((account) => account.marketId)} /> : null}
          </section>
        </>
      )}
      <HowItWorks />
    </div>
  );
}

/** First steps, each marked done only from state the app has actually read. */
function Onboarding({ connected, accounts, strategies, supplied }: { connected: boolean; accounts: number; strategies: number | null; supplied: boolean }) {
  const gate = useWriteGate("account");
  const steps: Array<{ title: string; body: React.ReactNode; done: boolean; action?: React.ReactNode }> = [
    {
      title: "Connect a wallet on X Layer testnet",
      body: (
        <>
          Use the Connect wallet button at the top. Transactions need a little test OKB for fees{FAUCET_URL ? <> (<a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-fg underline underline-offset-4">faucet</a>)</> : null}. Test tokens have no value.
        </>
      ),
      done: connected,
    },
    { title: "Create a Sentinel account", body: "A smart account you own, one per lending market. It holds your position and enforces your personal policy on every risk-increasing action.", done: accounts > 0, action: <ButtonLink href="#accounts" size="sm" variant="secondary">Create an account</ButtonLink> },
    { title: "Fund it and open a position", body: "Supply collateral or lend through Earn, or borrow through Borrow. The account holds the position; withdrawals always pay you.", done: supplied, action: <ButtonLink href="/markets?view=earn" size="sm" variant="secondary">Open Earn</ButtonLink> },
    { title: "Put a strategy on it", body: "Adopt a template, such as debt protection, by signing a bounded, expiring grant for an operator you choose. Or start from Discover.", done: (strategies ?? 0) > 0, action: <ButtonLink href="/strategies#create" size="sm">Create a strategy</ButtonLink> },
  ];
  const next = steps.findIndex((step) => !step.done);
  return (
    <Card as="section" className="p-5 sm:p-7" data-testid="portfolio-onboarding" data-next={next}>
      <p className="eyebrow">Getting started</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">{next <= 0 ? "Put your portfolio on autopilot, on your terms" : "Finish setting up"}</h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className={cx("flex flex-col rounded-control border p-4", index === next ? "border-line-strong" : "border-line")} data-step={index} data-done={String(step.done)}>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-xs", step.done ? "bg-success-soft text-success" : "bg-raised text-muted")}>{step.done ? <IconCheck size={13} strokeWidth={2.6} /> : index + 1}</span>
              {step.title}
            </div>
            <p className="mt-2 flex-1 text-[0.8125rem] text-muted">{step.body}</p>
            {step.action && index === next ? <div className="mt-3">{step.action}</div> : null}
          </li>
        ))}
      </ol>
      {gate.allowed || gate.reason === "disconnected" ? null : <p className="mt-4 text-[0.8125rem] text-muted">{gate.message}</p>}
    </Card>
  );
}

/** Headline figures. The value covers v1 Sentinel accounts only, at the markets' mock prices; it says so. */
function Summary({ accounts }: { accounts: SentinelAccount[] }) {
  const markets = useMarkets();
  const active = useActiveStrategies();
  const chain = services.account.source === "chain";
  const list = markets.data?.status === "ok" ? markets.data.value : null;
  let net: Maybe<bigint> = accounts.length === 0 ? unavailable("No Sentinel account") : list ? ok(0n) : unavailable("Market prices are not loaded");
  for (const account of accounts) {
    const m = list?.find((entry) => entry.id === account.marketId);
    if (!m) {
      net = unavailable("A market of one account could not be read");
      break;
    }
    const p = account.position;
    const value = mapMaybe(all2(all2(usdOf(ok(p.collateralSupplied + p.idleCollateral), m.collateral.token, m.collateral.price), usdOf(ok(p.idleDebtAsset + p.lent), m.debt.token, m.debt.price)), usdOf(ok(p.debt), m.debt.token, m.debt.price)), ([[c, i], d]) => c + i - d);
    net = mapMaybe(all2(net, value), ([sum, v]) => sum + v);
  }
  const running = active.strategies.filter((entry) => entry.status === "active");
  const operators = new Set(active.strategies.map((entry) => entry.operator ?? entry.id)).size;
  return (
    <Card as="section" className="p-5 sm:p-7" data-testid="portfolio-summary" data-accounts={accounts.length} data-strategies={active.loading ? "" : active.strategies.length} data-active={active.loading ? "" : running.length}>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            Portfolio value {chain ? null : <ExampleTag />}
          </div>
          <div className="num mt-1 text-4xl font-semibold tracking-tight sm:text-5xl" data-testid="portfolio-value">
            {accounts.length === 0 ? <span className="text-faint">—</span> : <Value of={net}>{(v) => formatUsd(v)}</Value>}
          </div>
          <p className="mt-2 max-w-md text-[0.8125rem] text-muted">
            {accounts.length === 0 ? "No Sentinel account yet." : "Net of your v1 Sentinel accounts: collateral, lent and idle funds minus debt, at each market's mock test price."} Test tokens have no real value. A v2 account's tokens are listed under Positions and are not part of this figure.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="Sentinel accounts" value={accounts.length} sub={accounts.length === 1 ? "One lending market" : "One per lending market"} />
          <Stat label="Active strategies" value={active.loading ? "…" : running.length} sub={active.loading ? undefined : active.strategies.length > running.length ? `${active.strategies.length - running.length} expired, spent or without a trigger` : "Derived from on-chain grants"} />
          <Stat label="Automation" value={active.loading ? "…" : operators === 0 ? "Off" : `${operators} operator${operators === 1 ? "" : "s"}`} sub={operators === 0 ? "Nothing can act for you" : "Can act inside its grant only"} />
          <Stat label="Can withdraw" value="Only you" sub="No grant includes withdrawal" />
        </div>
      </div>
    </Card>
  );
}

/**
 * Capital a strategy may still move. These are the contracts' own numbers: the budget left on each grant, and the
 * most that could move right now given the funds actually in the account. It is an upper bound, not a forecast.
 */
function Budgets() {
  const active = useActiveStrategies();
  const rows = active.strategies;
  if (active.loading || rows.length === 0) return null;
  return (
    <Card as="section" data-testid="portfolio-budgets">
      <CardHeader eyebrow="Authorisations" title="What your strategies may still move" description="Per grant, straight from the account contracts. A budget only goes down as it is used; it is a ceiling, not an allocation that is invested somewhere." action={rows.some((entry) => entry.example) ? <ExampleTag /> : null} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">Strategy</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Budget left</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Usable right now</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">Ends</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {rows.map((entry) => (
              <tr key={entry.id} data-budget-row={entry.id}>
                <td className="px-5 py-3 sm:px-6">
                  <span className="font-medium">{entry.title}</span> <span className="text-muted">· {entry.accountKind.replace("Sentinel account ", "")}</span>
                </td>
                <td className="px-3 py-3 text-right">
                  {entry.budgetLeft}
                  {entry.budgetOf ? <span className="text-muted"> of {entry.budgetOf}</span> : null}
                </td>
                <td className="px-3 py-3 text-right">{entry.status !== "active" ? <span className="text-faint">{ACTIVE_STATUS_LABEL[entry.status]}</span> : (entry.usableNow ?? <span className="text-faint">Not derivable</span>)}</td>
                <td className="px-5 py-3 text-right sm:px-6">{entry.expires}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-faint sm:px-6">"Usable right now" is the smallest of the budget left and the funds in the account the grant can spend (for a repayment: idle funds and outstanding debt, and only once the trigger is met; for a swap: the per-swap limit and the idle input token). "Budget left of" shows the original budget only when the grant's event is in the blocks this app has read.</p>
    </Card>
  );
}

function RecentOperations() {
  const activity = useActivity();
  const feed = activity.data?.status === "ok" ? activity.data.value : null;
  const fixture = services.activity.source === "fixture";
  const entries = (feed?.entries ?? []).slice(0, 5);
  return (
    <Card as="section" data-testid="portfolio-recent" data-count={activity.isPending ? "" : entries.length}>
      <CardHeader
        eyebrow="Activity"
        title="Recent operations"
        description="The latest actions by you or an operator on your accounts, with their outcome."
        action={
          <Link href="/activity" className="text-sm font-medium underline underline-offset-4">
            All activity
          </Link>
        }
      />
      {activity.isPending ? (
        <Skeleton className="m-5 h-20" />
      ) : feed === null ? (
        <p className="p-5 text-sm text-muted sm:p-6">{activity.data?.status === "unavailable" ? activity.data.reason : "Activity could not be loaded."}</p>
      ) : entries.length === 0 ? (
        <p className="p-5 text-sm text-muted sm:p-6">No operation{feed.coverage && !feed.coverage.complete ? " was found in the blocks that were read" : " yet"}.</p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm sm:px-6" data-recent={entry.id}>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge tone={entry.result === "allowed" ? "success" : "warning"}>{entry.result === "allowed" ? "Allowed" : entry.result === "rejected" ? "Rejected" : "Failed"}</Badge>
                <Badge tone="outline">{entry.actor === "operator" ? "Operator" : "You"}</Badge>
                <span className="min-w-0">{entry.title}</span>
                {fixture ? <ExampleTag /> : null}
              </span>
              <span className="num text-[0.8125rem] text-muted">
                {entry.amount ? `${tokenAmount(entry.amount.value, entry.amount.token)} · ` : ""}
                {formatTime(entry.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {feed?.coverage && !feed.coverage.complete ? (
        <p className="border-t border-line px-5 py-3 text-xs text-faint sm:px-6">
          <LogCoverageText coverage={feed.coverage} />
        </p>
      ) : null}
    </Card>
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
  const automateHref = `/strategies?market=${m.id}`;
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

"use client";
import { useEffect, useMemo, useState } from "react";
import { marketTitle } from "@/components/domain/market-bits";
import { PolicyIdentity, PolicyRules } from "@/components/domain/policy-card";
import { Advanced, Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, EmptyState, ExampleTag, Mono, Notice, Skeleton, cx } from "@/components/ui/core";
import { IconAlert, IconInfo, IconLock } from "@/components/ui/icons";
import { useAccounts, useMarket, useMarkets } from "@/hooks/use-data";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatBps } from "@/lib/amount";
import { services } from "@/services";
import { ACCOUNT_SELECTABLE_OPS, LOCAL_PREVIEW_LABEL, OP_LABEL, Op, type OpId, accountPolicySpec, compileSpec, evaluateLocally } from "@/lib/policy";
import type { PolicyRecord, SentinelAccount } from "@/services/types";
import { SentinelHeader } from "./sentinel-common";

export function SentinelPolicy() {
  const accounts = useAccounts();
  const markets = useMarkets();
  const list = accounts.data?.status === "ok" ? accounts.data.value : [];
  // One account per market. `?market=<id>` selects it; read after mount so the page can still be prerendered.
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(new URLSearchParams(window.location.search).get("market"));
  }, []);
  const account = list.find((entry) => selected !== null && entry.marketId.toLowerCase() === selected.toLowerCase()) ?? list[0] ?? null;
  const choose = (marketId: string) => {
    setSelected(marketId);
    window.history.replaceState(null, "", `?market=${marketId}${window.location.hash}`);
  };
  const label = (entry: SentinelAccount) => {
    const market = markets.data?.status === "ok" ? markets.data.value.find((m) => m.id === entry.marketId) : undefined;
    return market ? `${marketTitle(market)}, market #${market.index}${market.policy.identified ? ` (market cap ${formatBps(market.policy.spec.params.maxLtvBps)})` : ""}` : entry.marketId;
  };
  return (
    <div className="space-y-6">
      <SentinelHeader title="Policy" description="Your personal rules, compiled into a circuit and enforced by the account contract. Only you can change them." />
      {accounts.isPending ? (
        <Skeleton className="h-96" data-loading />
      ) : account ? (
        <>
          {list.length > 1 ? (
            <label className="block text-sm">
              <span className="font-medium">Account</span>
              <select id="account-select" value={account.marketId} onChange={(event) => choose(event.target.value)} className="mt-2 h-11 w-full max-w-xl rounded-control border border-line-strong bg-bg px-3">
                {list.map((entry) => (
                  <option key={entry.marketId} value={entry.marketId}>
                    {label(entry)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Editor key={account.marketId} account={account} />
        </>
      ) : accounts.data?.status === "unavailable" ? (
        <EmptyState title="Account data unavailable">{accounts.data.reason}</EmptyState>
      ) : (
        <EmptyState title="No Sentinel account yet">Create an account from the overview first. A policy is attached when the account is created.</EmptyState>
      )}
    </div>
  );
}

function Editor({ account }: { account: SentinelAccount }) {
  const market = useMarket(account.marketId);
  const m = market.data?.status === "ok" ? market.data.value : null;
  const gate = useWriteGate("policy");
  const chain = services.policy.source === "chain";
  const current = account.policy.spec.params;
  const [capBps, setCapBps] = useState(current.maxLtvBps);
  const [ops, setOps] = useState<OpId[]>([...current.allowedOps] as OpId[]);
  const [tryOp, setTryOp] = useState<OpId>(Op.BORROW);
  const [tryLtv, setTryLtv] = useState(current.maxLtvBps + 300);
  const [fresh, setFresh] = useState(true);

  const draft = useMemo<PolicyRecord>(() => {
    const spec = accountPolicySpec(capBps, ops, account.policy.spec.label);
    return { identified: true, spec, compiled: compileSpec(spec), registration: { status: "unavailable", reason: "A changed policy is a new circuit. It must be fabricated and registered before it can be attached. On this deployment only the registry's registrar can register account policies." } };
  }, [capBps, ops, account.policy.spec.label]);
  const changed = capBps !== current.maxLtvBps || [...ops].sort().join() !== [...current.allowedOps].sort().join();
  const shown = changed ? draft : account.policy;
  const marketCap = m?.policy.spec.params.maxLtvBps ?? null;
  const trial = shown.compiled.status === "ok" ? evaluateLocally(shown.compiled.value, { op: tryOp, oracleFresh: fresh, postLtvBps: tryLtv, cashOk: true }) : null;

  const toggle = (op: OpId) => setOps((list) => (list.includes(op) ? list.filter((entry) => entry !== op) : [...list, op]));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <Card as="section">
          <CardHeader eyebrow="Step 1" title="Set your limits" description={m ? `Applies to your account on ${marketTitle(m)}, market #${m.index}.` : undefined} action={changed ? <Badge tone="warning">Unsaved draft</Badge> : <Badge tone="success">Current</Badge>} />
          <div className="space-y-7 p-5 sm:p-6">
            <div>
              <div className="flex items-baseline justify-between gap-4">
                <label htmlFor="cap" className="text-sm font-medium">
                  Maximum loan-to-value
                </label>
                <output htmlFor="cap" className="num text-3xl font-semibold tracking-tight">
                  {formatBps(capBps)}
                </output>
              </div>
              <input id="cap" type="range" min={0} max={10000} step={50} value={capBps} onChange={(event) => setCapBps(Number.parseInt(event.target.value, 10))} className="mt-4 h-11 w-full" />
              <div className="num flex justify-between text-xs text-faint">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
              {marketCap !== null && capBps > marketCap ? (
                <Notice className="mt-4" tone="warning" icon={<IconAlert size={18} />} title="Looser than the market">
                  This market's policy caps loan-to-value at {formatBps(marketCap)}. Above that the market rule decides, so your cap would never be the binding limit.
                </Notice>
              ) : marketCap !== null ? (
                <p className="mt-3 text-[0.8125rem] text-muted">
                  The market allows up to <span className="num text-fg">{formatBps(marketCap)}</span>. Your cap is the stricter rule and is checked first.
                </p>
              ) : null}
            </div>

            <fieldset>
              <legend className="text-sm font-medium">Actions this account may take</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {ACCOUNT_SELECTABLE_OPS.map((op) => (
                  <label key={op} className={cx("flex min-h-12 items-center gap-3 rounded-control border px-3.5 text-sm", ops.includes(op) ? "border-line-strong" : "border-line text-muted")}>
                    <input type="checkbox" className="size-4" checked={ops.includes(op)} onChange={() => toggle(op)} />
                    {OP_LABEL[op]}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[0.8125rem] text-muted">Repaying debt and enabling collateral are always allowed. No policy can block them.</p>
            </fieldset>
          </div>
        </Card>

        <Card as="section">
          <CardHeader eyebrow="Step 2" title="Try it before you authorise" description="Runs the compiled circuit in your browser. This is not an on-chain evaluation." action={<Badge tone="outline">{LOCAL_PREVIEW_LABEL}</Badge>} />
          <div className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="font-medium">Action</span>
                <select value={tryOp} onChange={(event) => setTryOp(Number(event.target.value) as OpId)} className="mt-2 h-11 w-full rounded-control border border-line-strong bg-bg px-3">
                  {ACCOUNT_SELECTABLE_OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Loan-to-value after</span>
                <span className="mt-2 flex h-11 items-center rounded-control border border-line-strong bg-bg px-3 focus-within:border-fg">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(tryLtv)}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 5);
                      setTryLtv(Math.min(digits === "" ? 0 : Number.parseInt(digits, 10), 10000));
                    }}
                    className="num w-full min-w-0 bg-transparent outline-none"
                    aria-describedby="bps-hint"
                  />
                  <span id="bps-hint" className="shrink-0 text-xs text-muted">
                    bps = {formatBps(tryLtv)}
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-3 self-end text-sm sm:h-11">
                <input type="checkbox" className="size-4" checked={fresh} onChange={(event) => setFresh(event.target.checked)} />
                Price feed is fresh
              </label>
            </div>
            {trial === null ? (
              <Notice tone="danger" icon={<IconAlert size={18} />} title="Policy does not compile">
                {shown.compiled.status === "unavailable" ? shown.compiled.reason : null}
              </Notice>
            ) : trial.status === "ok" ? (
              <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-control border p-4", trial.value.allow ? "border-success bg-success-soft" : "border-warning bg-warning-soft")} data-testid="trial-result">
                <div>
                  <div className="text-base font-semibold">{trial.value.allow ? "Allowed" : "Denied by your policy"}</div>
                  <div className="text-[0.8125rem] text-muted">
                    {OP_LABEL[tryOp]} at {formatBps(tryLtv)} loan-to-value, cap {formatBps(shown.spec.params.maxLtvBps)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted">
                  inputs <Mono>{trial.value.inputs}</Mono>
                  <br />
                  output <Mono>{trial.value.output}</Mono>
                </div>
              </div>
            ) : (
              <Notice icon={<IconInfo size={18} />} title="Cannot be evaluated">
                {trial.reason}
              </Notice>
            )}
          </div>
        </Card>

        <Card as="section" id="automation" className="scroll-mt-28">
          <CardHeader eyebrow="Automation" title="Operators and auto-repay" description="Who may act for this account, with what budget and until when. Managed in Automate, revocable at any time." action={chain ? null : <ExampleTag />} />
          <div className="space-y-4 p-5 sm:p-6" data-testid="automation-summary">
            <dl className="divide-y divide-line">
              <DefinitionRow label="Auto-repay trigger">{account.autoRepayTriggerBps > 0 ? `≥ ${formatBps(account.autoRepayTriggerBps)} loan-to-value` : "Disabled"}</DefinitionRow>
              <DefinitionRow label="Authorised operators">{account.operators.filter((entry) => !entry.revoked).length}</DefinitionRow>
            </dl>
            <ButtonLink href={`/automate?market=${account.marketId}`} variant="secondary" data-testid="open-automate">
              Manage in Automate
            </ButtonLink>
          </div>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card className="lg:sticky lg:top-28">
          <CardHeader eyebrow="Step 3" title={changed ? "Review draft policy" : "Active policy"} />
          <div className="space-y-5 p-5 sm:p-6">
            <PolicyRules record={shown} />
            <PolicyIdentity record={shown} open />
            <div className="space-y-2.5 border-t border-line pt-5">
              {/* Honest lock: setPolicy only accepts a registered ACCOUNT policy, and registering one is registrar-only here. */}
              <Button className="w-full" size="lg" disabled data-testid="authorise-policy">
                <IconLock size={17} />
                Authorise policy
              </Button>
              <p className="text-center text-[0.8125rem] text-muted" data-testid="write-gate-reason">
                {!gate.allowed
                  ? gate.message
                  : changed
                    ? "This draft cannot be attached from the app: an account policy must first be registered, and on this deployment only the registry's registrar can do that. The compiled circuit and its hashes above are what would be registered."
                    : "This is the policy your account enforces now. A different limit is a different circuit, which the registrar has to register first."}
              </p>
              {changed ? (
                <Button variant="ghost" className="w-full" onClick={() => { setCapBps(current.maxLtvBps); setOps([...current.allowedOps] as OpId[]); }}>
                  Discard draft
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

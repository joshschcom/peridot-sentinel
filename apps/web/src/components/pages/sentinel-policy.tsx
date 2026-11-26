"use client";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { AmountInput } from "@/components/domain/amount-input";
import { marketTitle, tokenAmount } from "@/components/domain/market-bits";
import { PolicyIdentity, PolicyRules } from "@/components/domain/policy-card";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Advanced, Badge, Button, Card, CardHeader, DefinitionRow, EmptyState, ExampleTag, Mono, Notice, Skeleton, cx } from "@/components/ui/core";
import { IconAlert, IconInfo, IconLock } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useAccounts, useMarket, useMarkets } from "@/hooks/use-data";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatBps, parseAmount } from "@/lib/amount";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { mapContractError, rawErrorText } from "@/lib/errors";
import { formatDay, shortAddress } from "@/lib/format";
import { rememberOperator } from "@/lib/local-memory";
import { services } from "@/services";
import { revokeOperatorPlan, setOperatorPlan, setTriggerPlan } from "@/services/chain/plans";
import { type OperatorProbe, probeOperator } from "@/services/chain/reads";
import { ACCOUNT_SELECTABLE_OPS, LOCAL_PREVIEW_LABEL, OP_LABEL, Op, type OpId, accountPolicySpec, compileSpec, evaluateLocally } from "@/lib/policy";
import type { Address, Market, PolicyRecord, SentinelAccount } from "@/services/types";
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
      <SentinelHeader description="Your personal rules, compiled into a circuit and enforced by the account contract. Only you can change them." />
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
          <CardHeader eyebrow="Automation" title="Auto-repay and operator" description="Let a keeper repay debt from the account's idle funds. Revocable at any time." action={chain ? null : <ExampleTag />} />
          {m ? <Automation account={account} market={m} /> : <Skeleton className="m-5 h-40" />}
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

const GRANT_DAYS = [1, 7, 30] as const;

function Automation({ account, market }: { account: SentinelAccount; market: Market }) {
  const gate = useWriteGate("account");
  const chain = services.account.source === "chain";
  const tx = useChainTx();
  const debtToken = market.debt.token;
  const address = account.address.status === "ok" ? account.address.value : null;
  const grants = account.operators.filter((entry) => !entry.revoked);
  const grant = grants[0] ?? null;
  const grantAddress = grant?.operator.status === "ok" ? grant.operator.value : "";
  const [trigger, setTrigger] = useState(String(account.autoRepayTriggerBps));
  const [operator, setOperator] = useState<string>(grantAddress);
  const [budget, setBudget] = useState("");
  const [days, setDays] = useState<(typeof GRANT_DAYS)[number]>(7);
  const [mayBorrow, setMayBorrow] = useState(grant ? (grant.opsMask & (1 << Op.BORROW)) !== 0 : false);
  const [mayRepay, setMayRepay] = useState(grant ? (grant.opsMask & (1 << Op.REPAY)) !== 0 : true);
  const [probes, setProbes] = useState<{ operator: string; results: OperatorProbe[] } | { error: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const mask = (mayBorrow ? 1 << Op.BORROW : 0) | (mayRepay ? 1 << Op.REPAY : 0);

  const triggerBps = /^\d{1,5}$/.test(trigger) && Number(trigger) <= 10_000 ? Number(trigger) : null;
  const parsedBudget = parseAmount(budget, debtToken.decimals);
  const operatorValid = isAddress(operator);
  const isOwner = operatorValid && account.owner.status === "ok" && operator.toLowerCase() === account.owner.value.toLowerCase();
  const busy = tx.state.phase === "running";
  const canWrite = chain && gate.allowed && address !== null && !busy;
  const grantReady = canWrite && operatorValid && !isOwner && mask !== 0 && parsedBudget.ok && parsedBudget.value > 0n;

  const authorise = async () => {
    if (!grantReady || !address || !parsedBudget.ok) return;
    // Remembered before sending so the refresh after confirmation already reads this operator. Harmless if the
    // transaction fails: the chain read then shows no grant and the candidate is not listed.
    rememberOperator(WRITE_CHAIN_ID, address, operator);
    await tx.run(setOperatorPlan(address, operator as Address, mask, parsedBudget.value, days), `Operator ${shortAddress(operator)} authorised: ${mayRepay ? "repay" : ""}${mayRepay && mayBorrow ? " and " : ""}${mayBorrow ? "borrow" : ""}, up to ${tokenAmount(parsedBudget.value, debtToken)} in total, for ${days} day${days === 1 ? "" : "s"}.`);
  };
  const check = async (target: string) => {
    if (!address || !isAddress(target)) return;
    setProbing(true);
    try {
      setProbes({ operator: target, results: await probeOperator(market, address, target as Address) });
    } catch (error) {
      setProbes({ error: error instanceof Error ? error.message.split("\n")[0]! : "The checks could not be run" });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="space-y-7 p-5 sm:p-6" data-testid="automation">
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Auto-repay trigger</h3>
        <p className="text-[0.8125rem] text-muted">
          An authorised operator may repay once the account's loan-to-value reaches this level. Now: <span className="num text-fg">{account.autoRepayTriggerBps > 0 ? `≥ ${formatBps(account.autoRepayTriggerBps)}` : "disabled (0)"}</span>.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 text-sm sm:max-w-56">
            <span className="sr-only">Trigger in basis points</span>
            <span className="flex h-11 items-center rounded-control border border-line-strong bg-bg px-3 focus-within:border-fg">
              <input id="trigger-bps" type="text" inputMode="numeric" value={trigger} onChange={(event) => setTrigger(event.target.value.replace(/\D/g, "").slice(0, 5))} className="num w-full min-w-0 bg-transparent outline-none" disabled={!chain} />
              <span className="shrink-0 text-xs text-muted">bps{triggerBps !== null ? ` = ${formatBps(triggerBps)}` : ""}</span>
            </span>
          </label>
          <Button variant="secondary" disabled={!canWrite || triggerBps === null || triggerBps === account.autoRepayTriggerBps} onClick={() => address && triggerBps !== null && tx.run(setTriggerPlan(address, triggerBps), triggerBps === 0 ? "Auto-repay disabled." : `Auto-repay trigger set to ${formatBps(triggerBps)} loan-to-value.`)} data-testid="trigger-submit">
            {!gate.allowed ? <IconLock size={16} /> : null} {triggerBps === 0 ? "Disable auto-repay" : "Set trigger"}
          </Button>
        </div>
        {triggerBps === null ? <p className="text-sm text-danger">Enter a whole number from 0 to 10000. Zero disables auto-repay.</p> : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Authorised operators</h3>
        {grants.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-operator">No operator is authorised on this account.</p>
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {grants.map((entry) => {
              const who = entry.operator.status === "ok" ? entry.operator.value : null;
              return (
                <li key={who ?? entry.label} className="space-y-2 px-3.5 py-3" data-operator={who ?? undefined} data-mask={entry.opsMask}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{who ? <Mono>{shortAddress(who)}</Mono> : entry.label}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {(entry.opsMask & (1 << Op.REPAY)) !== 0 ? <Badge tone="outline">Repay</Badge> : null}
                      {(entry.opsMask & (1 << Op.BORROW)) !== 0 ? <Badge tone="outline">Borrow</Badge> : null}
                      {entry.expired ? <Badge tone="warning">Expired</Badge> : null}
                    </span>
                  </div>
                  <p className="num text-[0.8125rem] text-muted">
                    Budget left {tokenAmount(entry.remaining, debtToken)}
                    {entry.granted.status === "ok" ? ` of ${tokenAmount(entry.granted.value, debtToken, 0)}` : ""} · expires {formatDay(entry.expiresAt)}
                  </p>
                  {chain && who ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={probing} onClick={() => check(who)} data-testid="operator-check">
                        Check what it can do
                      </Button>
                      <Button size="sm" variant="danger" disabled={!canWrite} onClick={() => address && tx.run(revokeOperatorPlan(address, who), `Operator ${shortAddress(who)} revoked. It can no longer act for this account.`)} data-testid="operator-revoke">
                        Revoke
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {probes ? <ProbeResults probes={probes} /> : null}
      </div>

      <fieldset className="space-y-3" disabled={!chain}>
        <legend className="text-sm font-medium">{grant ? "Replace or add an authorisation" : "Authorise an operator"}</legend>
        <label className="block text-sm">
          <span className="text-muted">Operator address</span>
          <input id="operator-address" type="text" spellCheck={false} autoComplete="off" value={operator} onChange={(event) => setOperator(event.target.value.trim())} placeholder="0x…" className="mt-1.5 h-11 w-full min-w-0 rounded-control border border-line-strong bg-bg px-3 font-mono text-[0.8125rem] outline-none focus:border-fg" />
        </label>
        {operator !== "" && !operatorValid ? <p className="text-sm text-danger">This is not a valid address.</p> : null}
        {isOwner ? <p className="text-sm text-danger">The owner cannot be its own operator.</p> : null}
        <label className="flex min-h-12 items-center gap-3 rounded-control border border-line px-3.5 text-sm">
          <input type="checkbox" className="size-4" checked={mayRepay} onChange={(event) => setMayRepay(event.target.checked)} />
          <span className="flex-1">Auto-repay from idle funds</span>
          <span className="num font-mono text-xs text-faint">mask 8</span>
        </label>
        <label className="flex min-h-12 items-center gap-3 rounded-control border border-line px-3.5 text-sm">
          <input type="checkbox" className="size-4" checked={mayBorrow} onChange={(event) => setMayBorrow(event.target.checked)} />
          <span className="flex-1">Borrow into the account (still subject to both policies)</span>
          <span className="num font-mono text-xs text-faint">mask 4</span>
        </label>
        <p className="text-[0.8125rem] text-muted">
          Resulting permission mask: <span className="num font-mono text-fg">{mask}</span>. Borrowed funds settle into the account, never to the operator. There is no permission that lets an operator withdraw.
        </p>
        <AmountInput label="Cumulative budget" token={debtToken} value={budget} onChange={setBudget} />
        <label className="block text-sm">
          <span className="text-muted">Valid for</span>
          <select id="grant-days" value={days} onChange={(event) => setDays(Number(event.target.value) as (typeof GRANT_DAYS)[number])} className="mt-1.5 h-11 w-full rounded-control border border-line-strong bg-bg px-3">
            {GRANT_DAYS.map((option) => (
              <option key={option} value={option}>
                {option} day{option === 1 ? "" : "s"} from the latest block
              </option>
            ))}
          </select>
        </label>
        <p className="text-[0.8125rem] text-muted">A new authorisation for the same operator replaces its previous one, budget included.</p>
      </fieldset>

      <div className="space-y-3">
        <Button disabled={!grantReady} onClick={authorise} data-testid="operator-submit">
          {!gate.allowed ? <IconLock size={16} /> : null} {grant && operator.toLowerCase() === grantAddress.toLowerCase() ? "Update authorisation" : "Authorise operator"}
        </Button>
        {!gate.allowed ? <p className="text-[0.8125rem] text-muted">{gate.message}</p> : null}
        <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} marketId={market.id} />
      </div>
    </div>
  );
}

/** Results of eth_call simulations made with the operator as the sender. Nothing was signed or sent. */
function ProbeResults({ probes }: { probes: { operator: string; results: OperatorProbe[] } | { error: string } }) {
  if ("error" in probes) {
    return (
      <Notice tone="danger" icon={<IconAlert size={18} />} title="Checks unavailable">
        {probes.error}
      </Notice>
    );
  }
  return (
    <div className="rounded-control border border-line" data-testid="operator-probes" data-operator={probes.operator}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-sm font-medium">
          What <Mono>{shortAddress(probes.operator)}</Mono> can do right now
        </span>
        <Badge wrap tone="outline">Simulation as the operator · nothing sent</Badge>
      </div>
      <ul className="divide-y divide-line">
        {probes.results.map((probe) => {
          const friendly = probe.error ? mapContractError(probe.error) : null;
          const blocked = probe.outcome === "reverts";
          const expected = probe.id === "auto-repay" ? true : blocked;
          return (
            <li key={probe.id} className="px-3.5 py-3" data-operator-check={probe.id} data-outcome={probe.outcome} data-error={probe.error?.name ?? ""}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{probe.title}</span>
                <Badge tone={!expected ? "danger" : blocked ? (probe.id === "auto-repay" ? "neutral" : "success") : "success"}>{blocked ? (probe.id === "auto-repay" ? "Not now" : "Cannot") : probe.id === "auto-repay" ? "Can" : "CAN (unexpected)"}</Badge>
              </div>
              <p className="mt-1 text-[0.8125rem] text-muted">
                <span className="font-mono text-xs">{probe.call}</span>: {probe.note} {friendly && friendly.category !== "unknown" ? friendly.title + "." : ""}
              </p>
              {probe.error ? (
                <Advanced label="Raw error" className="mt-2">
                  <pre className="overflow-x-auto font-mono text-xs break-all whitespace-pre-wrap">{rawErrorText(probe.error)}</pre>
                </Advanced>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-3.5 py-2.5 text-xs text-faint">Each line is an eth_call of the account contract with the operator as the sender. The operator's key is not involved and no transaction exists.</p>
    </div>
  );
}

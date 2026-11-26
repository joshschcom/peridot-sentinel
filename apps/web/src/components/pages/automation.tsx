"use client";
/**
 * Operator authorisation and the auto-repay trigger for one Sentinel account: the rule-based automation that is
 * live today. Every control here maps to a field the account contract stores (operator, permission mask,
 * cumulative budget, expiry, trigger). Nothing on this panel is kept off chain.
 */
import { useState } from "react";
import { isAddress } from "viem";
import { AmountInput } from "@/components/domain/amount-input";
import { tokenAmount } from "@/components/domain/market-bits";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Advanced, Badge, Button, Mono, Notice } from "@/components/ui/core";
import { IconAlert, IconLock } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatBps, parseAmount } from "@/lib/amount";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { mapContractError, rawErrorText } from "@/lib/errors";
import { formatDay, shortAddress } from "@/lib/format";
import { rememberOperator } from "@/lib/local-memory";
import { Op } from "@/lib/policy";
import { services } from "@/services";
import { revokeOperatorPlan, setOperatorPlan, setTriggerPlan } from "@/services/chain/plans";
import { type OperatorProbe, probeOperator } from "@/services/chain/reads";
import type { Address, Market, SentinelAccount } from "@/services/types";

const GRANT_DAYS = [1, 7, 30] as const;

export function Automation({ account, market }: { account: SentinelAccount; market: Market }) {
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
          <p className="text-sm text-muted" data-testid="no-operator">
            {chain && account.operatorDiscovery && (!account.operatorDiscovery.complete || account.operatorDiscovery.failed) ? "No operator was found in the blocks this app has read. An authorisation made in unread blocks would not be listed." : "No operator is authorised on this account."}
          </p>
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

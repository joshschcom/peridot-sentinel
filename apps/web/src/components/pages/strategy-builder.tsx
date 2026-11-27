"use client";
/**
 * Create, import, export and adopt a strategy (DECISIONS D23).
 *
 *   choose    one of the SDK's curated templates, or a template the user imported (untrusted);
 *   adjust    only the fields the schema leaves open; every change goes back through the SDK's validator;
 *   review    the SDK reads the chain and returns the exact, unsigned owner transactions;
 *   sign      one transaction at a time, by the connected owner, and only what was reviewed.
 * Choosing or importing a template grants nothing. There is no field here for a key, and none is ever needed:
 * the operator is an address the owner types, and it never signs anything in this app.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { StrategyBadge, TemplateFacts, TemplateIdentity, TemplateText } from "@/components/domain/strategy-bits";
import { STRATEGY_CONTEXT } from "@/lib/strategy-context";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Advanced, Button, Card, CardHeader, Mono, Notice, Skeleton, cx } from "@/components/ui/core";
import { IconAlert, IconLock, IconShield } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useDeploymentCheck, useWallet, useWriteGate } from "@/hooks/use-wallet";
import { formatAmount, toDecimalString } from "@/lib/amount";
import { IS_PRIVATE_FORK, WRITE_CHAIN, WRITE_CHAIN_ID } from "@/lib/chains";
import { CURATED, type CheckedStrategy, IMPORT_LIMIT, IMPORT_RULES, type StrategyEdits, budgetAsset, editStrategy, exportFileName, parseStrategy, rawFromText, refusalHints, templateAvailability } from "@/lib/strategy";
import { METHOD_ARGS, METHOD_TEXT, type OwnerTransaction, type PlanKind, type StrategyPlan, argumentText, ownerTransactionStep, reviewStrategy } from "@/services/chain/strategy";
import { V2_OWNER_TARGET, verifyOwnerTarget } from "@/services/chain/v2-owner";
import type { Address } from "@/services/types";

/** To the second: the expiry a user reviews is the exact value in the calldata, not a rounded one. */
const utc = (seconds: bigint | string) => `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
const INPUT = "mt-1.5 h-11 w-full min-w-0 rounded-control border border-line-strong bg-bg px-3 text-[0.9375rem] outline-none focus:border-fg";
const LIFETIMES = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86_400, label: "1 day" },
  { seconds: 259_200, label: "3 days" },
  { seconds: 604_800, label: "7 days" },
];

type Choice = "debt-protection-v1" | "restricted-swap-v2" | "imported";

export function StrategyBuilder() {
  const [imported, setImported] = useState<CheckedStrategy | null>(null);
  const [choice, setChoice] = useState<Choice>("debt-protection-v1");
  useEffect(() => {
    // `?template=` comes from Discover. Read after mount so the page can still be prerendered. Only a known profile
    // name is accepted; anything else is ignored.
    const wanted = new URLSearchParams(window.location.search).get("template");
    if (wanted === "debt-protection-v1" || wanted === "restricted-swap-v2") setChoice(wanted);
  }, []);
  const base = choice === "imported" ? imported : (CURATED.find((entry) => entry.template.profile === choice) ?? null);

  return (
    <div className="space-y-6" data-testid="strategy-builder" data-choice={choice}>
      <Card as="section" id="create" className="scroll-mt-28">
        <CardHeader eyebrow="Create" title="Create a strategy from a template" description="A template describes what an operator may do on your account: one operation, one asset, a budget and a lifetime. Adopting it means you, the owner, sign the grant yourself. Until you do, nothing has any authority." />
        <div className="space-y-5 p-5 sm:p-6">
          <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-2">
            {CURATED.map((entry) => {
              const availability = templateAvailability(entry.template, STRATEGY_CONTEXT);
              const selected = choice === entry.template.profile;
              return (
                <button key={entry.hash} type="button" role="radio" aria-checked={selected} onClick={() => setChoice(entry.template.profile)} className={cx("rounded-control border p-4 text-left", selected ? "border-fg" : "border-line hover:border-line-strong")} data-testid={`template-option-${entry.template.profile}`}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{entry.template.name}</span>
                    <StrategyBadge status={availability.status} />
                  </span>
                  <span className="mt-1.5 block text-sm text-muted">{entry.template.description}</span>
                </button>
              );
            })}
            {imported ? (
              <button type="button" role="radio" aria-checked={choice === "imported"} onClick={() => setChoice("imported")} className={cx("rounded-control border p-4 text-left sm:col-span-2", choice === "imported" ? "border-fg" : "border-line hover:border-line-strong")} data-testid="template-option-imported">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Imported template</span>
                  <span className="text-xs text-warning">Untrusted content · passed validation · grants nothing</span>
                </span>
                <span className="mt-1.5 block font-mono text-xs break-all text-muted">{imported.hash}</span>
              </button>
            ) : null}
          </div>
          {base ? <Adopt key={`${choice}:${base.hash}`} base={base} untrusted={choice === "imported"} /> : <p className="text-sm text-muted">The curated templates are not available in this build.</p>}
        </div>
      </Card>
      <ImportCard onImported={(strategy) => { setImported(strategy); setChoice("imported"); }} current={imported} />
    </div>
  );
}

/* ---------- parameters, review, signing ---------- */

function Adopt({ base, untrusted }: { base: CheckedStrategy; untrusted: boolean }) {
  const template = base.template;
  const asset = budgetAsset(template);
  const debt = template.profile === "debt-protection-v1";
  const [trigger, setTrigger] = useState(debt ? String(template.risk.triggerLtvBps / 100) : "");
  const [perCall, setPerCall] = useState(debt ? "" : toDecimalString(BigInt(template.budget.perCallRaw), asset.decimals));
  const [budget, setBudget] = useState(toDecimalString(BigInt(template.budget.cumulativeRaw), asset.decimals));
  const [lifetime, setLifetime] = useState(template.expirySeconds);

  // Form text to the fields the schema leaves open. An unreadable number is the form's to report; whether the
  // value is acceptable is decided by the SDK alone (editStrategy re-validates the whole template).
  const triggerBps = /^\d{1,3}(\.\d{1,2})?$/.test(trigger) ? Math.round(Number(trigger) * 100) : null;
  const budgetRaw = rawFromText(budget, asset.decimals);
  const perCallRaw = debt ? null : rawFromText(perCall, asset.decimals);
  const unreadable = (debt && triggerBps === null) || budgetRaw === null || (!debt && perCallRaw === null);
  const checked = useMemo(() => {
    if (unreadable) return null;
    const edits: StrategyEdits = { expirySeconds: lifetime, cumulativeRaw: budgetRaw ?? undefined, ...(debt ? { triggerLtvBps: triggerBps ?? undefined } : { perCallRaw: perCallRaw ?? undefined }) };
    return editStrategy(template, edits);
  }, [template, unreadable, lifetime, budgetRaw, perCallRaw, triggerBps, debt]);
  const strategy = checked?.ok ? checked.strategy : null;
  const availability = templateAvailability(template, STRATEGY_CONTEXT);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-control border border-line p-4">
        <TemplateText label="Name" text={template.name} untrusted={untrusted} />
        <TemplateText label="Objective" text={template.objective} untrusted={untrusted} />
        <TemplateText label="Instructions for the agent" text={template.agentInstructions} untrusted={untrusted} />
        <p className="text-xs text-faint">Instructions are a note for whoever runs the operator. This app does not act on them, does not send them anywhere and no contract reads them. What binds the operator is the grant you sign.</p>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2" data-testid="strategy-params">
        <legend className="sr-only">Parameters</legend>
        {debt ? (
          <label className="block text-sm">
            <span className="font-medium">Repay when loan-to-value reaches (%)</span>
            <input inputMode="decimal" value={trigger} onChange={(event) => setTrigger(event.target.value.trim())} className={INPUT} data-testid="strategy-param-trigger" />
            <span className="mt-1 block text-xs text-faint">Account-wide: it applies to every repay operator of this account.</span>
          </label>
        ) : (
          <label className="block text-sm">
            <span className="font-medium">Most per swap ({asset.symbol})</span>
            <input inputMode="decimal" value={perCall} onChange={(event) => setPerCall(event.target.value.trim())} className={INPUT} data-testid="strategy-param-percall" />
            <span className="mt-1 block text-xs text-faint">Demo cap: 1 {asset.symbol} per swap.</span>
          </label>
        )}
        <label className="block text-sm">
          <span className="font-medium">Total budget ({asset.symbol})</span>
          <input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value.trim())} className={INPUT} data-testid="strategy-param-budget" />
          <span className="mt-1 block text-xs text-faint">Demo cap: 2 {asset.symbol} in total. The operator can never use more than this.</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Grant lifetime</span>
          <select value={lifetime} onChange={(event) => setLifetime(Number(event.target.value))} className={INPUT} data-testid="strategy-param-expiry">
            {[...LIFETIMES, ...(LIFETIMES.some((entry) => entry.seconds === lifetime) ? [] : [{ seconds: lifetime, label: `${lifetime.toLocaleString("en-US")} seconds` }])].map((entry) => (
              <option key={entry.seconds} value={entry.seconds}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-faint">Counted from the block you sign in. Seven days at most.</span>
        </label>
      </fieldset>

      {unreadable ? (
        <p className="text-sm text-danger" data-testid="strategy-param-error">Enter plain numbers: a percentage with at most two decimals, and amounts with at most {asset.decimals} decimals.</p>
      ) : checked && !checked.ok ? (
        <div className="text-sm" data-testid="strategy-param-error">
          <p className="text-danger">The validator refused these values: {checked.error}.</p>
          <p className="mt-1 text-muted">Keep the trigger between 0.01% and 100%, the amounts within the demo caps, and the per-swap amount at or below the total.</p>
        </div>
      ) : null}

      {strategy ? (
        <>
          <div data-testid="strategy-summary" data-hash={strategy.hash}>
            <h3 className="text-sm font-medium">What this strategy allows</h3>
            <div className="mt-2">
              <TemplateFacts template={strategy.template} />
            </div>
            <div className="mt-3">
              <TemplateIdentity strategy={strategy} />
            </div>
          </div>
          <Review strategy={strategy} availability={availability} />
          <ExportPanel strategy={strategy} />
        </>
      ) : null}
    </div>
  );
}

type ReviewState = { phase: "idle" } | { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; plan: StrategyPlan; kind: PlanKind };

function Review({ strategy, availability }: { strategy: CheckedStrategy; availability: ReturnType<typeof templateAvailability> }) {
  const wallet = useWallet();
  const gate = useWriteGate("account");
  // A review is offered only AFTER this browser has verified the deployment the template acts on: the lending
  // deployment for every template, and additionally the Sentinel v2 deployment (every recorded code hash and the
  // factory's bindings) for a v2 template. While that is pending, or if it fails or the RPC does not answer, there
  // is no form, no plan and nothing to sign.
  const deployment = useDeploymentCheck();
  const needsV2 = strategy.template.profile === "restricted-swap-v2";
  const v2Target = V2_OWNER_TARGET;
  const v2Check = useQuery({ queryKey: ["v2-owner-verify", v2Target?.chainId], queryFn: () => verifyOwnerTarget(v2Target!), enabled: needsV2 && v2Target !== null, staleTime: 60_000, retry: 1 });
  const verification: { state: "pending" } | { state: "ok" } | { state: "failed"; reason: string } = deployment.isPending
    ? { state: "pending" }
    : !deployment.data
      ? { state: "failed", reason: "the RPC did not answer the deployment check" }
      : !deployment.data.ok
        ? { state: "failed", reason: deployment.data.reason }
        : !needsV2
          ? { state: "ok" }
          : !v2Target
            ? { state: "failed", reason: "this build has no usable Sentinel v2 manifest" }
            : v2Check.isPending
              ? { state: "pending" }
              : !v2Check.data
                ? { state: "failed", reason: "the RPC did not answer the Sentinel v2 deployment check" }
                : !v2Check.data.ok
                  ? { state: "failed", reason: `Sentinel v2: ${v2Check.data.problems[0] ?? "the deployment is not the one the manifest describes"}` }
                  : { state: "ok" };
  const tx = useChainTx();
  const owner = wallet.status === "connected" ? (wallet.address as Address) : null;
  const [operator, setOperator] = useState("");
  const [kind, setKind] = useState<PlanKind>("adopt");
  const [review, setReview] = useState<ReviewState>({ phase: "idle" });
  const [acknowledged, setAcknowledged] = useState(false);
  const [signed, setSigned] = useState<Array<{ method: OwnerTransaction["method"]; hash: string }>>([]);
  const [finished, setFinished] = useState<PlanKind | null>(null);
  const operatorValid = isAddress(operator);
  const reset = tx.reset;
  // Any change to what would be reviewed discards the review: a plan is only ever shown for the inputs on screen.
  useEffect(() => {
    setReview({ phase: "idle" });
    setAcknowledged(false);
    setSigned([]);
    setFinished(null);
    reset();
  }, [strategy.hash, operator, kind, owner, reset]);

  const build = async (acknowledge?: `0x${string}`) => {
    if (!owner || !operatorValid) return null;
    setReview({ phase: "loading" });
    try {
      const plan = await reviewStrategy(kind, strategy.template, { owner, operator: operator as Address, acknowledge });
      setReview({ phase: "ready", plan, kind });
      return plan;
    } catch (error) {
      setReview({ phase: "error", message: error instanceof Error ? error.message.split("\n")[0]! : "The plan could not be built" });
      return null;
    }
  };
  const plan = review.phase === "ready" ? review.plan : null;
  const next = plan?.transactions[0] ?? null;
  const needsAck = plan !== null && plan.reviewId !== null && plan.transactions.length === 0 && finished === null;
  const busy = tx.state.phase === "running" || review.phase === "loading";
  const canSign = availability.canSign && gate.allowed;

  const sign = async () => {
    if (!plan || !next) return;
    const last = plan.transactions.length === 1;
    const run = await tx.run([ownerTransactionStep(next, signed.length, signed.length + plan.transactions.length)], last ? "Mined. Reading the account again to confirm…" : "Mined. Building the review for the next transaction…");
    if (!run.ok || !run.hashes[0]) return;
    setSigned((previous) => [...previous, { method: next.method, hash: run.hashes[0]! }]);
    setAcknowledged(false);
    if (last) setFinished(kind);
    // Always read again: the expiry of the next call derives from a new block, and state has changed.
    await build();
  };

  if (!availability.canReview || verification.state === "failed") {
    return (
      <Notice tone="warning" icon={<IconAlert size={18} />} title={availability.canReview ? "Adoption is not offered: the deployment could not be verified" : "Adoption is not offered in this build"} data-testid="strategy-review-unavailable" data-why={availability.canReview ? "unverified" : "availability"}>
        {availability.canReview && verification.state === "failed" ? `The contracts on ${WRITE_CHAIN.name} could not be verified as the deployment this app expects (${verification.reason}). No plan is built from a chain this app cannot verify, and nothing can be signed.` : availability.reason}
      </Notice>
    );
  }
  if (verification.state === "pending") {
    return (
      <div className="space-y-2 rounded-control border border-line p-4" data-testid="strategy-review-verifying">
        <p className="text-sm text-muted">Verifying the deployment on {WRITE_CHAIN.name} before a review is offered…</p>
        <Skeleton className="h-10" data-loading />
      </div>
    );
  }
  const grantNow = plan ? plan.currentGrant : null;
  const asset = budgetAsset(strategy.template);
  const confirmed = finished !== null && plan !== null && grantNow !== null ? (finished === "revoke" ? grantNow.expiry === "0" && grantNow.remainingRaw === "0" : grantNow.remainingRaw === strategy.template.budget.cumulativeRaw && grantNow.expiry !== "0") : null;

  return (
    <div className="space-y-4 rounded-control border border-line-strong p-4 sm:p-5" id="review" data-testid="strategy-review" data-kind={kind}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold tracking-tight">Review the owner transactions</h3>
        <div role="radiogroup" aria-label="Plan" className="inline-flex rounded-full border border-line p-0.5 text-sm">
          {(["adopt", "revoke"] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => setKind(option)} className={cx("h-8 rounded-full px-3.5 font-medium", kind === option ? "bg-inverse text-on-inverse" : "text-muted hover:text-fg")} data-testid={`strategy-kind-${option}`}>
              {option === "adopt" ? "Adopt" : "Revoke"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted">
        {kind === "adopt"
          ? "The plan is built by reading your account on chain at one block. It lists every transaction you would sign, with its exact data. Nothing is sent by building it."
          : strategy.template.profile === "debt-protection-v1"
            ? "Revoking removes every permission of this one operator. The account-wide trigger stays as it is; the emergency stop below also clears it."
            : "Revoking removes this operator's grant for this one swap route. Its other grants, if any, stay. The emergency stop is the account-wide revokeAllOperators()."}
      </p>
      <label className="block text-sm">
        <span className="font-medium">Operator address</span>
        <input type="text" spellCheck={false} autoComplete="off" value={operator} onChange={(event) => setOperator(event.target.value.trim())} placeholder="0x…" className={cx(INPUT, "font-mono text-[0.8125rem]")} data-testid="strategy-operator" />
        <span className="mt-1 block text-xs text-faint">A public address: the separate key your keeper or MCP server signs with. Never paste a private key anywhere on this site. On testnet no Peridot service acts for you: adopting authorises this operator and runs nothing by itself.</span>
      </label>
      {operator !== "" && !operatorValid ? <p className="text-sm text-danger">This is not a valid address.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={!owner || !operatorValid || busy} onClick={() => void build()} data-testid="strategy-review-submit">
          {review.phase === "loading" ? "Reading the chain…" : plan ? "Read again" : "Build the review"}
        </Button>
        {!owner ? <span className="text-[0.8125rem] text-muted">Connect the owner wallet first: the plan is built for its own account.</span> : null}
      </div>
      {review.phase === "error" ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="No plan could be built" data-testid="strategy-plan-error">
          {review.message}. Nothing was sent.
          {/Create your own account/.test(review.message) ? (
            <span className="mt-2 block" data-testid="strategy-plan-needs-account">
              This wallet has no {needsV2 ? "Sentinel v2 account" : "Sentinel account for this lending market"} yet.{" "}
              <Link href={needsV2 ? "/trade" : "/portfolio#accounts"} className="font-medium underline underline-offset-4">
                {needsV2 ? "Create your v2 account on Trade" : "Create your account on Portfolio"}
              </Link>
              , then come back and build the review again.
            </span>
          ) : null}
        </Notice>
      ) : null}

      {plan && review.phase === "ready" ? (
        <div className="space-y-4" data-testid="strategy-plan" data-kind={review.kind} data-block={plan.blockNumber.toString()} data-account={plan.account} data-review-id={plan.reviewId ?? ""} data-tx-count={plan.transactions.length} data-grant-remaining={plan.currentGrant.remainingRaw} data-grant-expiry={plan.currentGrant.expiry} data-trigger={plan.currentTrigger ?? ""}>
          <dl className="divide-y divide-line text-sm">
            <Row label="Network">{IS_PRIVATE_FORK ? "Private fork of X Layer testnet (1952). Not the public chain." : "X Layer testnet (1952)"}</Row>
            <Row label="Your account">
              <span data-testid="plan-account"><Mono className="break-all">{plan.account}</Mono></span>
            </Row>
            <Row label="Owner (you)">
              <span data-testid="plan-owner"><Mono className="break-all">{plan.owner}</Mono></span>
            </Row>
            <Row label="Operator you chose">
              <span data-testid="plan-operator"><Mono className="break-all">{plan.operator}</Mono></span>
            </Row>
            <Row label="Read at block">
              {plan.blockNumber.toLocaleString("en-US")} <Mono className="text-faint">{plan.blockHash.slice(0, 18)}…</Mono>
            </Row>
            <Row label="This operator's grant now">
              {plan.currentGrant.expiry === "0" ? (
                "None"
              ) : (
                <>
                  {plan.currentGrant.mask !== null ? `mask ${plan.currentGrant.mask}, ` : ""}
                  {plan.currentGrant.perCallRaw !== null ? `${formatAmount(BigInt(plan.currentGrant.perCallRaw), asset.decimals)} ${asset.symbol} per swap, ` : ""}
                  {formatAmount(BigInt(plan.currentGrant.remainingRaw), asset.decimals)} {asset.symbol} left, expires {utc(plan.currentGrant.expiry)}
                </>
              )}
            </Row>
            {plan.currentTrigger !== null ? <Row label="Account-wide trigger now">{plan.currentTrigger === 0 ? "Disabled" : `${plan.currentTrigger / 100}%`}</Row> : null}
            {plan.expiry !== null && finished === null ? (
              <Row label="New grant would expire">
                <span data-testid="plan-expiry">{utc(plan.expiry)}</span>
              </Row>
            ) : null}
          </dl>

          {finished !== null ? (
            <p className={cx("text-sm", confirmed ? "text-success" : "text-warning")} data-testid="strategy-confirmed" data-confirmed={String(confirmed)} data-finished={finished}>
              {confirmed
                ? finished === "adopt"
                  ? `Confirmed by a fresh read at block ${plan.blockNumber.toLocaleString("en-US")}: the operator holds the grant shown above.`
                  : `Confirmed by a fresh read at block ${plan.blockNumber.toLocaleString("en-US")}: this operator's grant is gone.`
                : "The transaction was mined, but the latest read does not show the expected grant yet. A public RPC can lag: read again in a moment before relying on this."}
            </p>
          ) : (
            <>
              {plan.warnings.length > 0 ? (
                <Notice tone="warning" icon={<IconAlert size={18} />} title="Read this before you continue">
                  <ul className="list-disc space-y-1 pl-4" data-testid="strategy-warnings">
                    {plan.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              {needsAck ? (
                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 text-sm">
                    <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 size-4 shrink-0" data-testid="strategy-ack" />
                    <span>I have read the warnings above for this account, this operator and the state at block {plan.blockNumber.toLocaleString("en-US")}.</span>
                  </label>
                  <Button variant="secondary" disabled={!acknowledged || busy} onClick={() => void build(plan.reviewId ?? undefined)} data-testid="strategy-ack-submit">
                    Show the transactions
                  </Button>
                  <p className="text-xs text-faint">Accepting only produces the unsigned transactions for review. If the grant or the trigger has changed in the meantime, a new review is required.</p>
                </div>
              ) : null}
              {plan.transactions.length > 0 ? (
                <ol className="space-y-3" data-testid="strategy-transactions">
                  {plan.transactions.map((transaction, index) => (
                    <PlannedTransaction key={transaction.data} transaction={transaction} index={signed.length + index} total={signed.length + plan.transactions.length} asset={asset} />
                  ))}
                </ol>
              ) : null}
              {next ? (
                <div className="space-y-2">
                  <Button size="lg" disabled={!canSign || busy} onClick={() => void sign()} data-testid="strategy-sign">
                    {!canSign ? <IconLock size={16} /> : null} Sign transaction {signed.length + 1} of {signed.length + plan.transactions.length}
                  </Button>
                  {!availability.canSign ? (
                    <p className="text-[0.8125rem] text-muted" data-testid="strategy-sign-locked">{availability.reason}</p>
                  ) : !gate.allowed ? (
                    <p className="text-[0.8125rem] text-muted">{gate.message}</p>
                  ) : (
                    <p className="text-[0.8125rem] text-muted">Each transaction is signed separately and confirmed before the next. If you stop after the first one, it stays in force.</p>
                  )}
                </div>
              ) : null}
            </>
          )}
          {signed.length > 0 ? (
            <ul className="space-y-1 text-[0.8125rem]" data-testid="strategy-signed">
              {signed.map((entry) => (
                <li key={entry.hash} data-signed={entry.method} data-hash={entry.hash}>
                  <span className="text-success">Mined</span> {entry.method} <Mono className="text-faint">{entry.hash}</Mono>
                </li>
              ))}
            </ul>
          ) : null}
          <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="num min-w-0 break-words sm:text-right">{children}</dd>
    </div>
  );
}

/** One argument in the units a person reads. The exact value stays next to it; this is derived from it, not from the template. */
function argumentMeaning(name: string, value: unknown, asset: { symbol: string; decimals: number }): string | null {
  if (name === "cumulative" && typeof value === "bigint") return `${toDecimalString(value, asset.decimals)} ${asset.symbol} in total`;
  if (name === "perCall" && typeof value === "bigint") return `${toDecimalString(value, asset.decimals)} ${asset.symbol} per swap`;
  if (name === "expiry" && typeof value === "bigint") return `expires ${utc(value)}`;
  if (name === "triggerBps" && typeof value === "number") return `${value / 100}% loan-to-value, account-wide`;
  if (name === "mask") return value === 8 ? "repay only" : null;
  if (name === "op") return value === 5 ? "swap, exact input" : null;
  if (name === "operator") return "the operator you chose";
  if (name === "adapter") return "the pinned swap adapter";
  if (name === "input") return `${asset.symbol}, the token the operator may spend`;
  return null;
}

function PlannedTransaction({ transaction, index, total, asset }: { transaction: OwnerTransaction; index: number; total: number; asset: { symbol: string; decimals: number } }) {
  const names = METHOD_ARGS[transaction.method];
  return (
    <li className="rounded-control border border-line p-3.5 text-sm" data-testid="strategy-tx" data-method={transaction.method} data-to={transaction.to} data-from={transaction.from} data-data={transaction.data} data-value={transaction.value.toString()}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-medium">{index + 1}</span>
        <span className="font-medium" data-tx-title>{METHOD_TEXT[transaction.method]}</span>
        {total > 1 ? <span className="text-xs text-faint">of {total}</span> : null}
      </div>
      <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Call</dt>
          <dd className="font-mono break-all">
            {transaction.method}({names.join(", ")})
          </dd>
        </div>
        {transaction.args.map((value, position) => {
          const meaning = argumentMeaning(names[position]!, value, asset);
          return (
            <div key={names[position]} className="flex flex-wrap gap-x-2" data-arg={names[position]}>
              <dt className="text-muted">{names[position]}</dt>
              <dd className="min-w-0">
                <span className="font-mono break-all" data-arg-raw>{argumentText(value)}</span>
                {meaning ? <span className="text-muted" data-arg-meaning> · {meaning}</span> : null}
              </dd>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">From (you) → to (your account)</dt>
          <dd className="font-mono break-all">
            <span data-tx-from>{transaction.from}</span> → <span data-tx-to>{transaction.to}</span>
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Value</dt>
          <dd className="font-mono">0</dd>
        </div>
      </dl>
      <Advanced label="Exact calldata" className="mt-3">
        <code className="font-mono text-xs break-all" data-testid="strategy-tx-calldata">{transaction.data}</code>
      </Advanced>
    </li>
  );
}

/* ---------- export ---------- */

function ExportPanel({ strategy }: { strategy: CheckedStrategy }) {
  const [copied, setCopied] = useState<"json" | "hash" | null>(null);
  const copy = async (what: "json" | "hash") => {
    try {
      await navigator.clipboard.writeText(what === "json" ? strategy.canonical : strategy.hash);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([strategy.canonical], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName(strategy);
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <details className="group rounded-control border border-line" id="export" data-testid="strategy-export">
      <summary className="flex min-h-11 items-center justify-between gap-3 px-3.5 text-sm font-medium text-muted hover:text-fg">Export this strategy as JSON</summary>
      <div className="space-y-3 border-t border-line p-3.5 text-sm">
        <p className="text-muted">The canonical text of the template with the values above, and its hash. It contains no key, no account, no operator and no grant: whoever imports it still has to review and sign their own.</p>
        <pre className="max-h-64 overflow-auto rounded-control bg-subtle p-3 font-mono text-xs break-all whitespace-pre-wrap" data-testid="strategy-export-json">{strategy.canonical}</pre>
        <p className="font-mono text-xs break-all" data-testid="strategy-export-hash">{strategy.hash}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void copy("json")}>{copied === "json" ? "Copied" : "Copy JSON"}</Button>
          <Button size="sm" variant="secondary" onClick={() => void copy("hash")}>{copied === "hash" ? "Copied" : "Copy hash"}</Button>
          <Button size="sm" variant="secondary" onClick={download} data-testid="strategy-export-download" title={exportFileName(strategy)}>Download file</Button>
        </div>
        <p className="font-mono text-xs break-all text-faint">{exportFileName(strategy)}</p>
      </div>
    </details>
  );
}

/* ---------- import ---------- */

function ImportCard({ onImported, current }: { onImported: (strategy: CheckedStrategy) => void; current: CheckedStrategy | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const check = (source: string) => {
    const outcome = parseStrategy(source);
    if (outcome.ok) {
      setError(null);
      setHints([]);
      onImported(outcome.strategy);
    } else {
      setError(outcome.error);
      // Display only, and only after the validator's refusal: it never changes the outcome.
      setHints(refusalHints(source));
    }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    // The size is checked before the file is read. Valid templates are plain ASCII, so bytes and characters agree.
    if (file.size > IMPORT_LIMIT) {
      setError(`The file is ${file.size.toLocaleString("en-US")} bytes. A strategy template is at most ${IMPORT_LIMIT.toLocaleString("en-US")} characters, so it was not read`);
      setHints([]);
      return;
    }
    const content = await file.text();
    setText(content);
    check(content);
  };
  return (
    <Card as="section" id="import" className="scroll-mt-28" data-testid="strategy-import">
      <CardHeader eyebrow="Import" title="Import a strategy" description="Paste a template or choose a file. It is checked in your browser against the deployed contracts' profiles and nothing is uploaded. An imported template is untrusted text: it is displayed, never executed, and it cannot grant anything." />
      <div className="space-y-4 p-5 sm:p-6">
        <label className="block text-sm">
          <span className="font-medium">Template JSON</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} spellCheck={false} autoComplete="off" maxLength={IMPORT_LIMIT * 2} placeholder='{"schema":"peridot.strategy/v1", …}' className="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-bg p-3 font-mono text-xs outline-none focus:border-fg" data-testid="strategy-import-text" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={text.trim() === ""} onClick={() => check(text)} data-testid="strategy-import-submit">
            Check and load
          </Button>
          <label className="text-sm">
            <span className="sr-only">Template file</span>
            <input type="file" accept=".json,application/json" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} className="text-sm text-muted file:mr-3 file:h-9 file:rounded-full file:border file:border-solid file:border-line-strong file:bg-transparent file:px-3.5 file:text-sm file:font-medium file:text-fg" data-testid="strategy-import-file" />
          </label>
        </div>
        {error ? (
          <div className="rounded-control border border-danger bg-danger-soft p-3.5 text-sm" data-testid="strategy-import-error">
            <p className="font-medium">Not loaded: {error}.</p>
            {current ? <p className="mt-1 text-muted" data-testid="strategy-import-kept">The template you loaded earlier is unchanged and still selected.</p> : null}
            {hints.length > 0 ? (
              <>
                <p className="mt-2 font-medium">What looks wrong</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4" data-testid="strategy-import-hints">
                  {hints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-faint">A hint from this page, found by comparing the text with the supported template. The validator itself gives one answer for every refusal.</p>
              </>
            ) : null}
            <details className="mt-2 text-muted">
              <summary className="min-h-8 font-medium">Every rule a template must meet</summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {IMPORT_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
        {current ? (
          <Notice icon={<IconShield size={18} />} title="Loaded for review. No authority was granted." data-testid="strategy-imported" data-hash={current.hash}>
            The template passed validation and is selected above as "Imported template". Its text is shown exactly as written. Review the transactions before you sign anything; the hash below lets you compare it with what the author published.
            <span className="mt-1 block font-mono text-xs break-all">{current.hash}</span>
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Mono, Notice, cx } from "@/components/ui/core";
import { IconArrowUpRight, IconCheck, IconSpinner, IconX } from "@/components/ui/icons";
import { explorerTxUrl } from "@/lib/chains";
import type { FriendlyError } from "@/lib/errors";
import { shortHash } from "@/lib/format";
import type { Maybe } from "@/lib/maybe";
import { RejectionCallout } from "./policy-checks";

export type TxStepKind = "approve" | "sign" | "pending";
export type TxStepStatus = "upcoming" | "active" | "done" | "failed" | "skipped";
export interface TxStep {
  kind: TxStepKind;
  title: string;
  description: string;
  status: TxStepStatus;
}
export type TxResult =
  | { status: "success"; summary: string; hash: Maybe<`0x${string}`> }
  | { status: "failed"; error: FriendlyError; hash: Maybe<`0x${string}`> };

export interface TxState {
  phase: "idle" | "running" | "done";
  steps: TxStep[];
  result: TxResult | null;
  /** True when no wallet request was made and nothing was broadcast. */
  simulated: boolean;
}

export interface TxPlan {
  /** Token approval needed before the main call, e.g. "Approve tWETH". */
  approval?: string;
  action: string;
  /** Outcome a simulation should end in (from the operation preview). */
  simulatedFailure?: FriendlyError | null;
  successSummary: string;
}

function initialSteps(plan: TxPlan): TxStep[] {
  const steps: TxStep[] = [];
  if (plan.approval) steps.push({ kind: "approve", title: plan.approval, description: "Allow the exact amount, nothing more.", status: "upcoming" });
  steps.push({ kind: "sign", title: "Confirm in wallet", description: `${plan.action}. Check the details in your wallet before signing.`, status: "upcoming" });
  steps.push({ kind: "pending", title: "Waiting for confirmation", description: "Submitted to the network.", status: "upcoming" });
  return steps;
}

/**
 * Fixture-mode driver for the transaction feedback UI: walks through approve -> sign -> pending -> result
 * on timers, without any wallet or network call. The chain driver (wagmi writeContract + receipt) will
 * produce the same TxState, so the component below does not change.
 */
export function useSimulatedTx() {
  const [state, setState] = useState<TxState>({ phase: "idle", steps: [], result: null, simulated: true });
  const timers = useRef<number[]>([]);
  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const reset = useCallback(() => {
    clear();
    setState({ phase: "idle", steps: [], result: null, simulated: true });
  }, []);

  const run = useCallback((plan: TxPlan) => {
    clear();
    const steps = initialSteps(plan);
    // A policy or protocol rejection is detected by simulation before signing: later steps never start.
    const failAt = plan.simulatedFailure ? steps.findIndex((step) => step.kind === "sign") : -1;
    const frame = (activeIndex: number, result: TxResult | null): TxState => ({
      phase: result ? "done" : "running",
      simulated: true,
      result,
      steps: steps.map((step, index) => {
        if (result?.status === "failed" && index === failAt) return { ...step, status: "failed" };
        if (result?.status === "failed" && index > failAt) return { ...step, status: "skipped" };
        if (index < activeIndex || (result && result.status === "success")) return { ...step, status: "done" };
        return { ...step, status: index === activeIndex ? "active" : "upcoming" };
      }),
    });
    setState(frame(0, null));
    const stepMs = 850;
    const last = failAt >= 0 ? failAt : steps.length - 1;
    for (let index = 1; index <= last; index++) {
      timers.current.push(window.setTimeout(() => setState(frame(index, null)), stepMs * index));
    }
    timers.current.push(
      window.setTimeout(
        () => {
          const hash = { status: "unavailable", reason: "Simulation: no transaction exists" } as const;
          setState(frame(last, plan.simulatedFailure ? { status: "failed", error: plan.simulatedFailure, hash } : { status: "success", summary: plan.successSummary, hash }));
        },
        stepMs * (last + 1),
      ),
    );
  }, []);

  return { state, run, reset };
}

export function TxFeedback({ state, chainId, marketId }: { state: TxState; chainId: number; marketId?: string }) {
  if (state.phase === "idle") return null;
  const { result } = state;
  const url = result && result.hash.status === "ok" ? explorerTxUrl(chainId, result.hash.value) : null;
  return (
    <div className="space-y-3" aria-live="polite" data-testid="tx-feedback">
      {state.simulated ? (
        <Notice tone="warning" title="Simulation">
          No wallet request was made and nothing was sent to a network.
        </Notice>
      ) : null}
      <ol className="space-y-0">
        {state.steps.map((step, index) => (
          <li key={`${index}-${step.title}`} className="relative flex gap-3 pb-4 last:pb-0">
            {index < state.steps.length - 1 ? <span className="absolute top-7 bottom-0 left-3 w-px bg-line" aria-hidden="true" /> : null}
            <StepIcon status={step.status} index={index} />
            <div className={cx("min-w-0 pt-0.5", (step.status === "upcoming" || step.status === "skipped") && "text-faint")}>
              <div className="text-sm font-medium">
                {step.title}
                {step.status === "skipped" ? <span className="font-normal"> · not reached</span> : null}
              </div>
              {step.status === "active" ? <p className="text-[0.8125rem] text-muted">{step.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {result?.status === "success" ? (
        <div className="rounded-control border border-success bg-success-soft p-4" data-testid="tx-success">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-success text-bg">
              <IconCheck size={14} strokeWidth={2.6} />
            </span>
            <h3 className="text-base font-semibold tracking-tight">{state.simulated ? "Would succeed" : "Confirmed"}</h3>
            {state.simulated ? <Badge tone="outline">Simulation · nothing sent</Badge> : null}
          </div>
          <p className="mt-1.5 text-sm text-muted">{result.summary}</p>
          <TxHashLine hash={result.hash} url={url} />
        </div>
      ) : null}
      {result?.status === "failed" ? (
        <>
          <RejectionCallout error={result.error} marketId={marketId} simulated={state.simulated} />
          {!state.simulated ? <TxHashLine hash={result.hash} url={url} /> : null}
        </>
      ) : null}
    </div>
  );
}

function TxHashLine({ hash, url }: { hash: Maybe<`0x${string}`>; url: string | null }) {
  if (hash.status !== "ok") return <p className="mt-2 text-xs text-faint">No transaction hash: {hash.reason.toLowerCase()}.</p>;
  return (
    <p className="mt-2 text-sm">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-4">
          View on explorer <IconArrowUpRight size={14} />
        </a>
      ) : (
        <Mono>{shortHash(hash.value)}</Mono>
      )}
    </p>
  );
}

function StepIcon({ status, index }: { status: TxStepStatus; index: number }) {
  const base = "relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold";
  if (status === "done") return <span className={cx(base, "bg-fg text-bg")}><IconCheck size={13} strokeWidth={2.6} /></span>;
  if (status === "failed") return <span className={cx(base, "bg-danger text-bg")}><IconX size={13} strokeWidth={2.6} /></span>;
  if (status === "active") return <span className={cx(base, "border border-fg bg-bg text-fg")}><IconSpinner size={13} strokeWidth={2.2} /></span>;
  return <span className={cx(base, "num border border-line-strong bg-bg text-faint")}>{index + 1}</span>;
}

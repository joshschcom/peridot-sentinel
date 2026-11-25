"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AmountInput } from "@/components/domain/amount-input";
import { TokenGlyph } from "@/components/domain/market-bits";
import { PolicyIdentity, PolicyRules } from "@/components/domain/policy-card";
import { TxFeedback, useSimulatedTx } from "@/components/domain/tx-feedback";
import { Badge, Button, Card, EmptyState, ExampleTag, Mono, Notice, PageHeader, Skeleton, cx } from "@/components/ui/core";
import { IconAlert, IconArrowRight, IconCheck, IconChevronRight, IconInfo, IconLock } from "@/components/ui/icons";
import { useMarkets } from "@/hooks/use-data";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatAmount, formatBps, parseAmount } from "@/lib/amount";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { EVIDENCE } from "@/lib/evidence";
import { ok as okValue, unavailable } from "@/lib/maybe";
import { DEV_PROCESSOR_LABEL, LOCAL_PREVIEW_LABEL, Op, STUDIO_MARKET_ROOT, checkTemplateRoots, compileSpec, evaluateLocally, marketPolicySpec, studioTemplate } from "@/lib/policy";
import { RUNTIME } from "@/services";
import type { PolicyRecord, TokenInfo } from "@/services/types";

const STEPS = ["Assets", "Risk", "Circuit", "Review"] as const;

const PRESETS = [
  { id: "conservative", name: "Conservative", note: "Wide safety margin", borrow: 5000, liquidation: 6500, cap: 4000 },
  { id: "standard", name: "Standard", note: "Balanced defaults", borrow: 7000, liquidation: 8000, cap: 6500 },
  { id: "custom", name: "Custom", note: "Set every value", borrow: 6000, liquidation: 7500, cap: 5500 },
] as const;

export function StudioCreate() {
  const markets = useMarkets();
  const gate = useWriteGate("market");
  const tx = useSimulatedTx();
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("standard");
  const [borrow, setBorrow] = useState(7000);
  const [liquidation, setLiquidation] = useState(8000);
  const [cap, setCap] = useState(6500);
  const [reserve, setReserve] = useState(true);
  const [caps, setCaps] = useState({ collateral: "1000", debt: "1000000", borrowCap: "400000", minCash: "25000" });

  // The test-profile factory offers one approved pair; its tokens are taken from an existing market.
  const reference = markets.data?.status === "ok" ? (markets.data.value[0] ?? null) : null;
  const policy = useMemo<PolicyRecord>(() => {
    const spec = marketPolicySpec(cap, reserve);
    return { spec, compiled: compileSpec(spec), registration: { status: "unavailable", reason: "Not registered yet. You register it from your wallet in step 2 of the transaction plan." } };
  }, [cap, reserve]);
  const template = useMemo(() => studioTemplate(cap, reserve), [cap, reserve]);
  // Creation is gated on SDK root == manifest root == on-chain MARKET_TEMPLATE_ROOT() (INTERFACES v1.2).
  const manifest = RUNTIME.manifest.state === "deployed" ? RUNTIME.manifest.manifest : null;
  const manifestRoot = manifest?.capabilities.studioMarketTemplateRoot ? okValue(manifest.capabilities.studioMarketTemplateRoot) : unavailable<string>(manifest ? "this deployment predates Studio templates" : "no deployment");
  const rootCheck = checkTemplateRoots(manifestRoot, unavailable("on-chain reads are not enabled in this build"));
  const processorMode = manifest?.tapeout.mode ?? null;

  if (markets.isPending) return <Skeleton className="h-96" data-loading />;
  if (!reference) return <EmptyState title="Asset data unavailable">The factory's approved asset pair could not be loaded.</EmptyState>;
  const collateral = reference.collateral.token;
  const debt = reference.debt.token;

  const parsedCaps = {
    collateral: parseAmount(caps.collateral, collateral.decimals),
    debt: parseAmount(caps.debt, debt.decimals),
    borrowCap: parseAmount(caps.borrowCap, debt.decimals),
    minCash: parseAmount(caps.minCash, debt.decimals),
  };
  const capsValid = Object.values(parsedCaps).every((result) => result.ok && result.value > 0n);
  const capsCoherent = parsedCaps.debt.ok && parsedCaps.borrowCap.ok && parsedCaps.minCash.ok && parsedCaps.borrowCap.value <= parsedCaps.debt.value && parsedCaps.minCash.value < parsedCaps.debt.value;
  const riskValid = borrow > 0 && borrow < liquidation && liquidation <= 10000;
  const stepValid = [capsValid && capsCoherent, riskValid, policy.compiled.status === "ok", true][step];
  const raw = (result: (typeof parsedCaps)["debt"]) => (result.ok ? result.value.toString() : "invalid");

  const choosePreset = (id: (typeof PRESETS)[number]["id"]) => {
    setPreset(id);
    const chosen = PRESETS.find((entry) => entry.id === id)!;
    if (id !== "custom") {
      setBorrow(chosen.borrow);
      setLiquidation(chosen.liquidation);
      setCap(chosen.cap);
    }
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
        <Link href="/studio" className="rounded hover:text-fg">
          Studio
        </Link>
        <IconChevronRight size={14} />
        <span className="text-fg">Create a market</span>
      </nav>
      <PageHeader title="Create a market" description="Four steps. Nothing is sent until the final review, and a new market always starts inactive." />

      <ol className="grid grid-cols-4 gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button type="button" onClick={() => index < step && setStep(index)} disabled={index > step} aria-current={index === step ? "step" : undefined} className="w-full rounded-md text-left disabled:cursor-default">
              <span className={cx("block h-1 rounded-full", index <= step ? "bg-fg" : "bg-raised")} />
              <span className={cx("mt-2 flex items-center gap-1.5 text-xs font-medium sm:text-sm", index === step ? "text-fg" : "text-faint")}>
                <span className="num">{index + 1}</span>
                <span className="truncate">{label}</span>
                {index < step ? <IconCheck size={13} strokeWidth={2.4} /> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Card as="section" className="min-w-0 p-5 sm:p-7">
          {step === 0 ? (
            <div className="space-y-7">
              <StepTitle title="Assets and caps" body="Choose what can be supplied as collateral and what can be borrowed, then cap the market's size." />
              <div>
                <div className="text-sm font-medium">Asset pair</div>
                <div className="mt-2 rounded-control border border-fg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex shrink-0">
                      <TokenGlyph token={collateral} />
                      <TokenGlyph token={debt} className="-ml-2.5" />
                    </span>
                    <Badge tone="warning">Test tokens</Badge>
                  </div>
                  <div className="mt-3 font-medium">
                    {collateral.symbol} collateral · borrow {debt.symbol}
                  </div>
                  <div className="text-[0.8125rem] text-muted">
                    {collateral.name} ({collateral.decimals} decimals) · {debt.name} ({debt.decimals} decimals)
                  </div>
                </div>
                <p className="mt-2 text-[0.8125rem] text-muted">The test-profile factory creates markets for one approved pair. Arbitrary token pairs are not accepted, by design.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <AmountInput label="Collateral supply cap" token={collateral} value={caps.collateral} onChange={(value) => setCaps({ ...caps, collateral: value })} />
                <AmountInput label="Lending supply cap" token={debt} value={caps.debt} onChange={(value) => setCaps({ ...caps, debt: value })} />
                <AmountInput label="Borrow cap" token={debt} value={caps.borrowCap} onChange={(value) => setCaps({ ...caps, borrowCap: value })} />
                <AmountInput label="Cash reserve" token={debt} value={caps.minCash} onChange={(value) => setCaps({ ...caps, minCash: value })} />
              </div>
              {capsValid && !capsCoherent ? (
                <Notice tone="danger" icon={<IconAlert size={18} />} title="Caps do not fit together">
                  The borrow cap cannot exceed the lending supply cap, and the cash reserve must be below it.
                </Notice>
              ) : (
                <p className="text-[0.8125rem] text-muted">The cash reserve is liquidity that new borrows may not touch. It never blocks repayment or liquidation.</p>
              )}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-7">
              <StepTitle title="Risk template" body="Protocol limits are enforced by the market contract itself. The policy cap on top is enforced by your circuit." />
              <div role="radiogroup" aria-label="Risk preset" className="grid gap-2 sm:grid-cols-3">
                {PRESETS.map((entry) => (
                  <button key={entry.id} type="button" role="radio" aria-checked={preset === entry.id} onClick={() => choosePreset(entry.id)} className={cx("rounded-control border p-4 text-left", preset === entry.id ? "border-fg" : "border-line hover:border-line-strong")}>
                    <span className="block text-sm font-medium">{entry.name}</span>
                    <span className="block text-xs text-muted">{entry.note}</span>
                    {entry.id !== "custom" ? (
                      <span className="num mt-3 block text-xs text-faint">
                        {entry.cap / 100}% · {entry.borrow / 100}% · {entry.liquidation / 100}%
                      </span>
                    ) : (
                      <span className="mt-3 block text-xs text-faint">Your values</span>
                    )}
                  </button>
                ))}
              </div>
              <Slider id="cap" label="Policy cap (circuit)" hint="Your market's own rule. Denies risk increases above this loan-to-value." value={cap} onChange={(value) => { setCap(value); setPreset("custom"); }} />
              <Slider id="borrow" label="Borrowing limit (protocol)" hint="No position may borrow beyond this, whatever any policy says." value={borrow} onChange={(value) => { setBorrow(value); setPreset("custom"); }} />
              <Slider id="liq" label="Liquidation threshold (protocol)" hint="Above this, anyone may liquidate the position." value={liquidation} onChange={(value) => { setLiquidation(value); setPreset("custom"); }} />
              <label className="flex min-h-12 items-center gap-3 rounded-control border border-line px-3.5 text-sm">
                <input type="checkbox" className="size-4" checked={reserve} onChange={(event) => setReserve(event.target.checked)} />
                Circuit also denies borrows that would breach the cash reserve
              </label>
              {!riskValid ? (
                <Notice tone="danger" icon={<IconAlert size={18} />} title="Limits are not valid">
                  The borrowing limit must be above 0% and below the liquidation threshold.
                </Notice>
              ) : cap > borrow ? (
                <Notice tone="warning" icon={<IconInfo size={18} />} title="The policy cap is above the borrowing limit">
                  The protocol limit of {formatBps(borrow)} will always decide first, so this circuit would never be the binding rule.
                </Notice>
              ) : (
                <Notice icon={<IconInfo size={18} />} title="A higher limit is not a safer market">
                  These limits are immutable after creation. Leave room between the borrowing limit and liquidation for price moves and interest.
                </Notice>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              <StepTitle title="Circuit preview" body="Your policy, compiled to a stateless NAND circuit in your browser. The hashes below are what the registry will check." />
              <PolicyRules record={policy} />
              <div className="rounded-control border border-line p-4">
                <PolicyIdentity record={policy} open />
              </div>
              {policy.compiled.status === "ok" ? <VectorTable policy={policy} cap={cap} /> : null}
              <div className="rounded-control border border-line p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">Template commitment</h3>
                  <Badge tone={rootCheck.status === "match" ? "success" : rootCheck.status === "mismatch" ? "danger" : "neutral"}>{rootCheck.status === "match" ? "Roots match" : rootCheck.status === "mismatch" ? "Template root mismatch" : "Not verifiable yet"}</Badge>
                </div>
                <p className="mt-1.5 text-muted">
                  Every threshold and reserve option is committed under one Merkle root. Your wallet registers this policy by presenting a {template.status === "ok" ? `${template.value.proof.length}-element` : ""} proof, so no curator or signer service is involved.
                </p>
                <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
                  <div>
                    <dt className="inline text-muted">Compiler root: </dt>
                    <dd className="inline"><Mono className="text-xs">{STUDIO_MARKET_ROOT}</Mono></dd>
                  </div>
                  <div>
                    <dt className="inline text-muted">Deployment: </dt>
                    <dd className="inline text-faint">{rootCheck.status === "match" ? "equal in manifest and on chain" : rootCheck.detail}</dd>
                  </div>
                </dl>
              </div>
              <Notice tone="warning" icon={<IconAlert size={18} />} title="The circuit must exist on the processor first">
                {processorMode === "development-reference" ? `${DEV_PROCESSOR_LABEL}. Adding the circuit is a plain transaction with no fee.` : "On a TapeOut processor, fabricating a circuit burns components and costs a fee that is not refundable."}
                {EVIDENCE.forkPolicies.status === "ok" && EVIDENCE.forkPolicies.value.fabricationFeeWei !== null ? (
                  <> On a mainnet fork rehearsal, fabricating one policy circuit cost {formatAmount(EVIDENCE.forkPolicies.value.fabricationFeeWei, 18, { maxFractionDigits: 6 })} OKB plus gas. Testnet fees are not established yet.</>
                ) : null}{" "}
                A policy that is already registered is reused and costs nothing.
              </Notice>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <StepTitle title="Review and create" body="Up to three wallet transactions, in this order. The market is created inactive." />
              <ol className="space-y-2 text-sm">
                {[
                  ["Put the circuit on the processor", "Skipped when this exact policy is already registered."],
                  ["Register the policy", "registerMarketTemplate with your threshold, hashes and Merkle proof. Permissionless."],
                  ["Create the market", "createMarket with the policy ID from step 2. Your wallet becomes the owner."],
                ].map(([title, body], index) => (
                  <li key={title} className="flex gap-3 rounded-control border border-line p-3.5">
                    <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-inverse text-xs font-semibold text-on-inverse">{index + 1}</span>
                    <span>
                      <span className="font-medium">{title}.</span> <span className="text-muted">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="overflow-hidden rounded-control border border-line">
                <div className="border-b border-line bg-subtle px-4 py-2.5 font-mono text-xs break-all">MarketFactory.createMarket(bytes32,uint16,uint16,uint128,uint128,uint128,uint128)</div>
                <dl className="divide-y divide-line px-4 text-sm">
                  <Arg name="policyId" value={<span className="text-faint">Resolved after step 2</span>} />
                  <Arg name="borrowLtvBps" value={borrow} note={formatBps(borrow)} />
                  <Arg name="liquidationLtvBps" value={liquidation} note={formatBps(liquidation)} />
                  <Arg name="collateralSupplyCap" value={raw(parsedCaps.collateral)} note={`${caps.collateral} ${collateral.symbol}`} />
                  <Arg name="debtSupplyCap" value={raw(parsedCaps.debt)} note={`${caps.debt} ${debt.symbol}`} />
                  <Arg name="borrowCap" value={raw(parsedCaps.borrowCap)} note={`${caps.borrowCap} ${debt.symbol}`} />
                  <Arg name="minCash" value={raw(parsedCaps.minCash)} note={`${caps.minCash} ${debt.symbol}`} />
                </dl>
              </div>
              <div>
                <h3 className="text-sm font-medium">Before anyone can borrow</h3>
                <ol className="mt-3 space-y-2.5 text-sm">
                  {[
                    ["Create", "The market is created inactive. You are its owner."],
                    ["Seed liquidity", `Supply ${debt.symbol} to the lending side so there is something to borrow.`],
                    ["Check the feed", "Both assets need a fresh, positive price."],
                    ["Activate", "You confirm activation. Only then does borrowing open."],
                  ].map(([title, body], index) => (
                    <li key={title} className="flex gap-3">
                      <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold">{index + 1}</span>
                      <span>
                        <span className="font-medium">{title}.</span> <span className="text-muted">{body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <Notice tone="warning" icon={<IconAlert size={18} />} title="Cannot be undone">
                Limits and caps are immutable once the market exists. Gas and any fabrication fee are not refundable. You can replace the policy later with another registered policy: immediately on testnet, timelocked in production.
              </Notice>
              <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <Button variant="ghost" onClick={() => { tx.reset(); setStep(Math.max(0, step - 1)); }} disabled={step === 0}>
              Back
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!stepValid} data-testid="wizard-next">
                Continue <IconArrowRight size={16} />
              </Button>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {gate.allowed === false && gate.reason === "fixture" ? (
                  <Button variant="secondary" disabled={tx.state.phase === "running"} onClick={() => tx.run({ action: "Create market", successSummary: "The market would be created inactive, owned by your wallet. Next: seed liquidity, then activate." })}>
                    Walk through as a simulation
                  </Button>
                ) : null}
                <Button disabled={!gate.allowed || rootCheck.status !== "match" || template.status !== "ok"}>
                  {!gate.allowed || rootCheck.status !== "match" ? <IconLock size={16} /> : null} Create market
                </Button>
              </div>
            )}
          </div>
          {step === 3 && !gate.allowed ? <p className="mt-3 text-right text-[0.8125rem] text-muted">{gate.message}</p> : null}
          {step === 3 && gate.allowed && rootCheck.status !== "match" ? <p className="mt-3 text-right text-[0.8125rem] text-danger">{rootCheck.detail}</p> : null}
        </Card>

        <aside>
          <Card className="p-5 lg:sticky lg:top-28">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Summary</h2>
              <ExampleTag label="Draft" />
            </div>
            <dl className="num mt-3 divide-y divide-line text-sm">
              <SummaryRow label="Pair">{collateral.symbol} / {debt.symbol}</SummaryRow>
              <SummaryRow label="Policy cap">{formatBps(cap)}</SummaryRow>
              <SummaryRow label="Borrowing limit">{formatBps(borrow)}</SummaryRow>
              <SummaryRow label="Liquidation">{formatBps(liquidation)}</SummaryRow>
              <SummaryRow label="Borrow cap">{parsedCaps.borrowCap.ok ? formatAmount(parsedCaps.borrowCap.value, debt.decimals) : "—"} {debt.symbol}</SummaryRow>
              <SummaryRow label="Circuit">{policy.compiled.status === "ok" ? `${policy.compiled.value.gateCount} NAND gates` : "Does not compile"}</SummaryRow>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StepTitle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-[0.9375rem] text-muted">{body}</p>
    </div>
  );
}

function Slider({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="num text-xl font-semibold tracking-tight">
          {formatBps(value)}
        </output>
      </div>
      <input id={id} type="range" min={0} max={10000} step={50} value={value} onChange={(event) => onChange(Number.parseInt(event.target.value, 10))} className="mt-2 h-11 w-full" />
      <p className="text-[0.8125rem] text-muted">{hint}</p>
    </div>
  );
}

function VectorTable({ policy, cap }: { policy: PolicyRecord; cap: number }) {
  if (policy.compiled.status !== "ok") return null;
  const compiled = policy.compiled.value;
  const rows = [
    { label: "Borrow just below the cap", ctx: { op: Op.BORROW, oracleFresh: true, postLtvBps: Math.max(cap - 1, 0), cashOk: true } },
    { label: "Borrow exactly at the cap", ctx: { op: Op.BORROW, oracleFresh: true, postLtvBps: cap, cashOk: true } },
    { label: "Borrow just above the cap", ctx: { op: Op.BORROW, oracleFresh: true, postLtvBps: Math.min(cap + 1, 10000), cashOk: true } },
    { label: "Stale price feed", ctx: { op: Op.BORROW, oracleFresh: false, postLtvBps: Math.max(cap - 1, 0), cashOk: true } },
    { label: "Borrow that breaches the reserve", ctx: { op: Op.BORROW, oracleFresh: true, postLtvBps: Math.max(cap - 1, 0), cashOk: false } },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Sample evaluations</h3>
        <Badge tone="outline">{LOCAL_PREVIEW_LABEL}</Badge>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-control border border-line">
        {rows.map((row) => {
          const result = evaluateLocally(compiled, row.ctx);
          return (
            <li key={row.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5 text-sm">
              <span className="min-w-0">
                {row.label} <span className="num text-xs text-faint">· {formatBps(row.ctx.postLtvBps)}</span>
              </span>
              <span className="flex items-center gap-2.5">
                {result.status === "ok" ? (
                  <>
                    <Mono className="text-xs text-faint">{result.value.inputs}</Mono>
                    <Badge tone={result.value.allow ? "success" : "danger"}>{result.value.allow ? "Allow" : "Deny"}</Badge>
                  </>
                ) : (
                  <span className="text-xs text-faint">{result.reason}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Arg({ name, value, note }: { name: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <dt className="font-mono text-[0.8125rem] text-muted">{name}</dt>
      <dd className="num min-w-0 text-right">
        <span className="font-mono text-[0.8125rem] break-all">{value}</span>
        {note ? <span className="ml-2 text-xs text-faint">{note}</span> : null}
      </dd>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export type { TokenInfo };

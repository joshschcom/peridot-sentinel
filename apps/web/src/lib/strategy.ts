/**
 * Strategy templates (`peridot.strategy/v1`, DECISIONS D23). A thin, pure layer over the contracts team's SDK
 * (packages/strategy-sdk, imported by source path): this file never validates a template itself.
 *
 * Rules this module encodes:
 *   - Every template the app shows, edits, exports or plans with has passed `importStrategy`. Edited parameters are
 *     serialised and sent back through it; only the `canonical` text and `hash` it returns are ever used.
 *   - A template is data. It holds no key, grant, account or operator, and importing one grants nothing: the owner
 *     signs their own transactions after reviewing them (src/services/chain/strategy.ts).
 *   - Imported text is untrusted. It is only ever rendered as plain text by React (never as HTML, a link target, a
 *     prompt or a command), and never copied into the Connect page's copyable blocks.
 *   - The SDK reads its own pinned manifests. `bindingProblems` therefore compares a template's addresses with the
 *     manifests THIS build validated, so a build with a rejected or foreign deployment offers no adoption.
 *   - Labels ("Available on testnet", "Demonstration", "Planned") are derived from what this build lets a user do.
 */
import { curatedStrategies, importStrategy, type Strategy } from "../../../../packages/strategy-sdk/index.ts";
import { formatAmount, formatBps, parseAmount } from "./amount.ts";
import type { ExpansionManifest } from "./expansion.ts";
import type { DeploymentManifest } from "./manifest.ts";

export type { Strategy };
export type StrategyProfile = Strategy["profile"];
export interface CheckedStrategy {
  template: Strategy;
  /** Canonical JSON from the SDK: sorted keys, no whitespace. This exact text is what `hash` commits to. */
  canonical: string;
  /** keccak256 of the canonical UTF-8 bytes. Identifies content; it is not a signature and grants nothing. */
  hash: `0x${string}`;
}

/** The SDK's import cap, in characters. Stated to the user; the SDK is what enforces it. */
export const IMPORT_LIMIT = 8192;

/** The two templates shipped with the SDK, re-validated by it at load. A template that fails is simply absent. */
export const CURATED: CheckedStrategy[] = (() => {
  try {
    return curatedStrategies();
  } catch {
    return [];
  }
})();

export type ParseOutcome = { ok: true; strategy: CheckedStrategy } | { ok: false; error: string };

/** What the validator refuses, from packages/strategy-sdk/README.md. Shown with every refusal; not a second validator. */
export const IMPORT_RULES = [
  `At most ${IMPORT_LIMIT.toLocaleString("en-US")} characters of JSON with exactly the fields of a known profile, no duplicates and nothing extra.`,
  "The network, contracts, operations, assets and policy circuit must be the ones deployed on X Layer testnet (1952).",
  "Name, description, objective and instructions are short plain English: no addresses, links, long codes or anything shaped like a key or seed phrase.",
  "Budgets are positive whole raw-unit amounts within the demo caps: 2 mUSD in total for debt protection; 1 mWOKB per swap and 2 mWOKB in total for the swap route.",
  "Expiry is a duration of 1 second to 7 days, counted from the block in which the owner signs.",
] as const;

export function parseStrategy(text: string): ParseOutcome {
  try {
    return { ok: true, strategy: importStrategy(text) };
  } catch (error) {
    // The SDK answers every refusal with one generic sentence, on purpose. It is passed on unchanged.
    return { ok: false, error: error instanceof Error ? error.message : "The strategy could not be read" };
  }
}

/** Fields a user may change. Everything else in a template is pinned to the deployment by the SDK's schema. */
export interface StrategyEdits {
  name?: string;
  description?: string;
  objective?: string;
  agentInstructions?: string;
  expirySeconds?: number;
  /** debt-protection-v1 */
  triggerLtvBps?: number;
  /** restricted-swap-v2 */
  perCallRaw?: bigint;
  cumulativeRaw?: bigint;
}

/** Applies edits to a COPY and sends the result back through the SDK. A refused edit returns the SDK's own error. */
export function editStrategy(base: Strategy, edits: StrategyEdits): ParseOutcome {
  const draft = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { risk: Record<string, unknown>; budget: Record<string, unknown> };
  for (const key of ["name", "description", "objective", "agentInstructions", "expirySeconds"] as const) if (edits[key] !== undefined) draft[key] = edits[key];
  if (base.profile === "debt-protection-v1") {
    if (edits.triggerLtvBps !== undefined) draft.risk.triggerLtvBps = edits.triggerLtvBps;
    if (edits.cumulativeRaw !== undefined) draft.budget.cumulativeRaw = edits.cumulativeRaw.toString();
  } else {
    if (edits.perCallRaw !== undefined) draft.budget.perCallRaw = edits.perCallRaw.toString();
    if (edits.cumulativeRaw !== undefined) draft.budget.cumulativeRaw = edits.cumulativeRaw.toString();
  }
  return parseStrategy(JSON.stringify(draft));
}

/** Form text to raw units. An unreadable amount is reported by the form; the range is the SDK's to judge. */
export function rawFromText(text: string, decimals: number): bigint | null {
  const parsed = parseAmount(text, decimals);
  return parsed.ok && parsed.value > 0n ? parsed.value : null;
}

export const budgetAsset = (template: Strategy) => template.allowedAssets[0];

export interface TemplateFact {
  label: string;
  value: string;
  /** Raw detail for the advanced view (addresses, hashes, raw units). */
  detail?: string;
}

const duration = (seconds: number): string => {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  return `${seconds.toLocaleString("en-US")} seconds`;
};
export const formatDuration = duration;

const OPERATION_TEXT: Record<string, string> = {
  AUTO_REPAY: "Repay debt from the account's own idle funds (autoRepay)",
  SWAP_EXACT_IN: "Swap an exact input on one fixed route (swapExactIn)",
};
const MODE_TEXT: Record<string, string> = { "rule-based": "Rule-based", "external-agent": "Bring your own agent" };
export const modeLabel = (template: Strategy): string => MODE_TEXT[template.executionMode] ?? template.executionMode;

/** What a template says, as rows. Every value comes from the validated template; nothing is added or estimated. */
export function templateFacts(template: Strategy): TemplateFact[] {
  const asset = budgetAsset(template);
  const amount = (raw: string) => `${formatAmount(BigInt(raw), asset.decimals, { maxFractionDigits: 6 })} ${asset.symbol}`;
  const facts: TemplateFact[] = [
    { label: "Network", value: "X Layer testnet (1952)", detail: `chainId ${template.chainId}, schema ${template.schema}` },
    { label: "Execution mode", value: modeLabel(template) },
    { label: "Account type", value: template.deployment.accountVersion === "v1" ? "Sentinel account v1 (one lending market)" : "Sentinel account v2 (typed adapters)", detail: `factory ${template.deployment.factory}` },
    { label: "Operation", value: template.allowedOperations.map((operation) => OPERATION_TEXT[operation] ?? operation).join(", "), detail: `adapter ${template.deployment.adapter} at ${template.deployment.target}` },
    { label: "Assets", value: template.allowedAssets.map((entry) => entry.symbol).join(" → "), detail: template.allowedAssets.map((entry) => `${entry.symbol} ${entry.address} (${entry.decimals} decimals)`).join("; ") },
  ];
  if (template.profile === "debt-protection-v1") {
    facts.push({ label: "Trigger", value: `Loan-to-value at or above ${formatBps(template.risk.triggerLtvBps)}`, detail: `${template.risk.triggerLtvBps} bps, account-wide` });
    facts.push({ label: "Budget", value: `${amount(template.budget.cumulativeRaw)} in total`, detail: `${template.budget.cumulativeRaw} raw units` });
  } else {
    facts.push({ label: "Price protection", value: `At most ${formatBps(template.risk.maxSlippageBps)} below the price source, fixed by the deployed circuit`, detail: `${template.risk.maxSlippageBps} bps` });
    facts.push({ label: "Budget", value: `${amount(template.budget.perCallRaw)} per swap, ${amount(template.budget.cumulativeRaw)} in total`, detail: `${template.budget.perCallRaw} / ${template.budget.cumulativeRaw} raw units` });
  }
  facts.push({ label: "Grant lifetime", value: `${duration(template.expirySeconds)} from the block you sign in`, detail: `${template.expirySeconds} seconds` });
  facts.push({
    label: "Policy circuit",
    value: `${template.policy.kind} circuit ${template.policy.circuitId} on the development reference processor (not TapeOut)`,
    detail: `processor ${template.policy.processor}, netlist ${template.policy.netlistHash}, mode ${template.policy.mode}`,
  });
  return facts;
}

/* ---------- binding to the manifests this build validated ---------- */

const same = (a: string | null | undefined, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Does the template point at the deployment this build has validated? An empty list means yes. The SDK pins its own
 * copy of the manifests; this check is what ties adoption to the app's deployment verification.
 */
export function bindingProblems(template: Strategy, v1: DeploymentManifest | null, v2: ExpansionManifest | null): string[] {
  const problems: string[] = [];
  if (template.profile === "debt-protection-v1") {
    if (!v1 || v1.chainId !== 1952 || v1.status !== "deployed") return ["This build has no validated X Layer testnet deployment"];
    const account = v1.tapeout.circuits.find((circuit) => circuit.kind === "ACCOUNT");
    if (!same(v1.contracts.SentinelAccountFactory, template.deployment.factory)) problems.push("The template's account factory is not this build's SentinelAccountFactory");
    if (!same(String(v1.markets[0]?.controller ?? ""), template.deployment.target)) problems.push("The template's lending market is not this build's first market");
    if (!same(v1.contracts.MockDebt, template.allowedAssets[0].address)) problems.push("The template's debt asset is not this build's mUSD");
    if (!same(v1.contracts.PolicyRegistry, template.policy.enforcer) || !same(v1.tapeout.processor, template.policy.processor)) problems.push("The template's policy registry or processor is not this build's");
    if (!account || !same(account.policyId, template.policy.policyId) || !same(account.netlistHash, template.policy.netlistHash) || account.circuitId !== template.policy.circuitId) problems.push("The template's account policy circuit is not the one in this build's manifest");
  } else {
    if (!v2) return ["This build has no validated Sentinel v2 deployment for X Layer testnet"];
    if (!same(v2.contracts.factory, template.deployment.factory)) problems.push("The template's account factory is not this build's v2 factory");
    if (!same(v2.contracts.swap, template.deployment.target)) problems.push("The template's swap adapter is not this build's");
    if (!same(v2.tokens.wokb.address, template.allowedAssets[0].address) || !same(v2.tokens.usdc.address, template.allowedAssets[1].address)) problems.push("The template's token pair is not this build's mock pair");
    if (!same(v2.contracts.execution, template.policy.enforcer) || !same(v2.contracts.cpu, template.policy.processor)) problems.push("The template's execution policy or processor is not this build's");
    if (v2.swap.policyMaxLossBps !== template.risk.maxSlippageBps) problems.push("The template's price limit differs from this build's manifest");
  }
  return problems;
}

/* ---------- availability, derived ---------- */

export type StrategyAvailability = "available" | "demonstration" | "planned";
export const STRATEGY_AVAILABILITY_LABEL: Record<StrategyAvailability, string> = { available: "Available on testnet", demonstration: "Demonstration", planned: "Planned" };

export interface AvailabilityContext {
  /** This build targets X Layer testnet and reads the chain (not the local chain, not pinned to example data). */
  testnetLive: boolean;
  v1: DeploymentManifest | null;
  v2: ExpansionManifest | null;
}

export interface TemplateAvailability {
  status: StrategyAvailability;
  /** The plan (the exact owner transactions) can be built and reviewed in this build. */
  canReview: boolean;
  /** This build lets the owner sign the plan. */
  canSign: boolean;
  /** Why signing or reviewing is not offered. Null when both are. */
  reason: string | null;
}

/**
 * "Available on testnet": the owner can review AND sign the adoption in this build.
 * "Demonstration": the template is genuine and its plan can be reviewed, but this build does not send the transaction
 * (for v2 the contracts team's `uiEnabled` switch is off), or this build is not reading the testnet at all.
 */
export function templateAvailability(template: Strategy, context: AvailabilityContext): TemplateAvailability {
  const problems = bindingProblems(template, context.v1, context.v2);
  if (!context.testnetLive) return { status: "demonstration", canReview: false, canSign: false, reason: "Strategy templates are bound to X Layer testnet (1952). This build is not reading that network, so adoption is not offered here." };
  if (problems.length > 0) return { status: "demonstration", canReview: false, canSign: false, reason: `${problems[0]}. Adoption is not offered.` };
  if (template.profile === "restricted-swap-v2" && !context.v2?.uiEnabled) return { status: "demonstration", canReview: true, canSign: false, reason: "Sentinel v2 writes are switched off for this app on testnet (the deployment's uiEnabled flag is false). You can review the exact transaction; signing it here is not offered." };
  return { status: "available", canReview: true, canSign: true, reason: null };
}

/* ---------- export ---------- */

/** A file name for an exported template. Built from the profile and the hash only, never from imported text. */
export const exportFileName = (strategy: CheckedStrategy): string => `${strategy.template.profile}-${strategy.hash.slice(2, 10)}.strategy.json`;

/**
 * Does a v1 operator authorisation have the shape the debt-protection profile creates (repay-only mask and a
 * trigger)? A grant carries no template identity on chain, so this is a match by shape and is worded that way.
 */
export const V1_REPAY_ONLY_MASK = 8;
export function matchesDebtProtection(opsMask: number, triggerBps: number): boolean {
  return opsMask === V1_REPAY_ONLY_MASK && triggerBps > 0;
}

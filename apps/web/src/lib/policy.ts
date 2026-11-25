/**
 * Policy helpers. Types, canonical hashing, compilation and context encoding come from
 * @peridot/circuit-sdk (owned by Astra). This file only adds labels and a thin, typed
 * wrapper for the UI. Local evaluation runs the compiled NAND netlist through the SDK's
 * reference evaluator and must always be labelled "Local preview (reference evaluator)".
 */
import { Op, STUDIO_MARKET_ROOT, STUDIO_MAX_LTV_BPS, compilePolicy, encodeContext, evaluateNetlist, hashPolicySpec, studioMarketTemplate, validatePolicySpec } from "@peridot/circuit-sdk";
import type { CompiledPolicy, Hex, PolicySpec } from "@peridot/circuit-sdk";
import { type Maybe, ok, unavailable } from "./maybe.ts";

export { Op, STUDIO_MARKET_ROOT };
export type { CompiledPolicy, Hex, PolicySpec };
export type OpId = (typeof Op)[keyof typeof Op];
export type PolicyKind = PolicySpec["kind"];
export type MarketPolicySpec = Extract<PolicySpec, { kind: "MARKET" }>;
export type AccountPolicySpec = Extract<PolicySpec, { kind: "ACCOUNT" }>;

export const LOCAL_PREVIEW_LABEL = "Local preview (reference evaluator)";
export const DEV_PROCESSOR_LABEL = "Development reference processor — not TapeOut";

export const OP_LABEL: Record<OpId, string> = {
  [Op.SUPPLY]: "Supply",
  [Op.REDEEM]: "Withdraw",
  [Op.BORROW]: "Borrow",
  [Op.REPAY]: "Repay",
  [Op.ENTER_COLLATERAL]: "Enable as collateral",
  [Op.EXIT_COLLATERAL]: "Remove collateral",
  [Op.MARGIN_OPEN]: "Open margin (reserved)",
  [Op.MARGIN_CLOSE]: "Close margin (reserved)",
  [Op.REBALANCE]: "Rebalance (reserved)",
  [Op.TRANSFER]: "Transfer position",
};
export const OP_NAME: Record<OpId, string> = Object.fromEntries(Object.entries(Op).map(([name, id]) => [id, name])) as Record<OpId, string>;

/** Ops a personal policy can meaningfully allow in v1. Repay and collateral entry are never gated, 6-8 are reserved. */
export const ACCOUNT_SELECTABLE_OPS: readonly OpId[] = [Op.SUPPLY, Op.BORROW, Op.REDEEM, Op.EXIT_COLLATERAL, Op.TRANSFER];
/** INTERFACES v1: these bypass discretionary circuit checks entirely. */
export const NEVER_GATED_OPS: readonly OpId[] = [Op.REPAY, Op.ENTER_COLLATERAL];

export function opMask(ops: readonly OpId[]): number {
  return ops.reduce<number>((mask, op) => mask | (1 << op), 0);
}

export function marketPolicySpec(maxLtvBps: number, requireCashReserve: boolean, label?: string): MarketPolicySpec {
  return { schema: "peridot.policy/v1", templateVersion: 0, kind: "MARKET", templateId: "market-max-ltv-v0", params: { maxLtvBps, requireCashReserve }, ...(label ? { label } : {}) };
}

export function accountPolicySpec(maxLtvBps: number, allowedOps: readonly OpId[], label?: string): AccountPolicySpec {
  return {
    schema: "peridot.policy/v1",
    templateVersion: 0,
    kind: "ACCOUNT",
    templateId: "account-guard-v0",
    params: { maxLtvBps, allowedOps: [...allowedOps].sort((a, b) => a - b) },
    ...(label ? { label } : {}),
  };
}

let templateHashes: Map<string, { maxLtvBps: number; requireCashReserve: boolean }> | null = null;
/**
 * Recovers a Studio market template's parameters from its config hash by hashing every committed leaf
 * (0..10000 bps x reserve on/off, about 20,000 Keccak hashes, built once). No log query is needed, which matters
 * on RPCs that cap eth_getLogs ranges. The caller must still compile the result and compare the netlist hash.
 */
export function studioTemplateByConfigHash(configHash: string): { maxLtvBps: number; requireCashReserve: boolean } | null {
  if (!templateHashes) {
    templateHashes = new Map();
    for (let maxLtvBps = 0; maxLtvBps <= STUDIO_MAX_LTV_BPS; maxLtvBps++) {
      for (const requireCashReserve of [false, true]) templateHashes.set(hashPolicySpec(marketPolicySpec(maxLtvBps, requireCashReserve)).toLowerCase(), { maxLtvBps, requireCashReserve });
    }
  }
  return templateHashes.get(configHash.toLowerCase()) ?? null;
}

export function compileSpec(spec: PolicySpec): Maybe<CompiledPolicy> {
  try {
    return ok(compilePolicy(validatePolicySpec(spec)));
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Policy could not be compiled");
  }
}

export interface PolicyContextInput {
  op: OpId;
  oracleFresh: boolean;
  postLtvBps: number;
  cashOk: boolean;
}

export interface LocalEvaluation {
  /** Always the literal label; rendered next to every local result. */
  label: typeof LOCAL_PREVIEW_LABEL;
  inputs: Hex;
  output: Hex;
  allow: boolean;
}

/**
 * Evaluates the compiled netlist with the SDK reference evaluator.
 * Unavailable (not "deny") when the context cannot be encoded, e.g. LTV above 10000 bps,
 * which the contracts fail closed on before any circuit is consulted.
 */
export function evaluateLocally(compiled: CompiledPolicy, context: PolicyContextInput): Maybe<LocalEvaluation> {
  try {
    const inputs = encodeContext(context);
    const output = evaluateNetlist(compiled.netlist, compiled.nIn, compiled.nOut, inputs);
    if (output !== "0x00" && output !== "0x01") return unavailable(`Unexpected evaluator output ${output}`);
    return ok({ label: LOCAL_PREVIEW_LABEL, inputs, output, allow: output === "0x01" });
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Context could not be encoded");
  }
}

/** Plain-language rules for a spec, used by policy cards and the review step. */
export function describePolicy(spec: PolicySpec): string[] {
  const cap = `${spec.params.maxLtvBps / 100}%`;
  if (spec.kind === "MARKET") {
    return [
      `New borrowing and collateral removal are denied if they would push loan-to-value above ${cap}.`,
      "Denied while the price feed is stale.",
      spec.params.requireCashReserve ? "New borrowing is denied if it would breach the market's cash reserve." : "No cash-reserve condition in this circuit.",
      "Repayment, liquidation and safe exits are never blocked by this policy.",
    ];
  }
  const allowed = spec.params.allowedOps.map((op) => OP_LABEL[op as OpId]).join(", ") || "none";
  return [
    `Risk-increasing actions are denied if they would push your loan-to-value above ${cap}.`,
    `Allowed actions: ${allowed}.`,
    "Denied while the price feed is stale.",
    "Repayment and adding collateral are never blocked by this policy.",
  ];
}

export interface StudioTemplate {
  spec: MarketPolicySpec;
  compiled: CompiledPolicy;
  /** Merkle proof that this exact (threshold, reserve) template is committed under STUDIO_MARKET_ROOT. */
  proof: Hex[];
}

/** INTERFACES v1.2 step 1: the permissionless Studio template for a threshold and reserve switch. */
export function studioTemplate(maxLtvBps: number, requireCashReserve: boolean): Maybe<StudioTemplate> {
  try {
    return ok(studioMarketTemplate(maxLtvBps, requireCashReserve));
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Template could not be built");
  }
}

export type RootCheck =
  | { status: "match"; root: Hex }
  | { status: "mismatch"; detail: string }
  | { status: "unverifiable"; detail: string };

/**
 * INTERFACES v1.2: Studio creation is allowed only when the SDK root, the manifest's
 * capabilities.studioMarketTemplateRoot and the on-chain MARKET_TEMPLATE_ROOT() are all equal.
 */
export function checkTemplateRoots(manifestRoot: Maybe<string>, onChainRoot: Maybe<string>): RootCheck {
  const sdk = STUDIO_MARKET_ROOT.toLowerCase();
  if (manifestRoot.status !== "ok") return { status: "unverifiable", detail: `Manifest root unavailable: ${manifestRoot.reason}` };
  if (manifestRoot.value.toLowerCase() !== sdk) return { status: "mismatch", detail: "Template root mismatch: the deployment manifest commits to a different template set than this app's compiler." };
  if (onChainRoot.status !== "ok") return { status: "unverifiable", detail: `On-chain root unavailable: ${onChainRoot.reason}` };
  if (onChainRoot.value.toLowerCase() !== sdk) return { status: "mismatch", detail: "Template root mismatch: the deployed registry commits to a different template set than this app's compiler." };
  return { status: "match", root: STUDIO_MARKET_ROOT as Hex };
}

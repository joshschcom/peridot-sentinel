"use client";
/**
 * Strategy adoption and revocation on X Layer testnet 1952, through the contracts team's SDK.
 *
 * The SDK reads the chain and returns UNSIGNED owner transactions. Nothing here grants anything by itself:
 *   review   `buildAdoptionPlan` / `buildRevocationPlan` at one block (read-only, any connected address);
 *   sign     one transaction at a time, only what was reviewed (`reviewed` in the tx driver compares the calldata
 *            and the sender), after the usual simulation as the wallet;
 *   re-read  the plan is built again after every receipt, because the grant expiry derives from the review block and
 *            an account-wide trigger change produces a new review.
 * The app never re-implements the planner. On any other chain than 1952 the SDK refuses, and so does this module.
 */
import type { Abi, Hex, PublicClient } from "viem";
import { getPublicClient } from "wagmi/actions";
import v2AccountAbi from "../../../../../packages/chain-config/expansion/abi/SentinelAccountV2.json" with { type: "json" };
import { type OwnerTransaction, type Selection, buildAdoptionPlan, buildRevocationPlan } from "../../../../../packages/strategy-sdk/index.ts";
import { xLayerTestnet } from "../../lib/chains.ts";
import type { Strategy } from "../../lib/strategy.ts";
import type { Address } from "../types.ts";
import { ABI, withErrors } from "./client.ts";
import type { TxPlanStep } from "./tx.ts";
import { wagmiConfig } from "./wagmi.ts";

export type { OwnerTransaction };
export type StrategyPlan = Awaited<ReturnType<typeof buildAdoptionPlan>>;
export type PlanKind = "adopt" | "revoke";

function reader(): PublicClient {
  const rpc = getPublicClient(wagmiConfig, { chainId: xLayerTestnet.id });
  if (!rpc) throw new Error("No RPC client for X Layer testnet");
  return rpc as PublicClient;
}

/** Read-only. `acknowledge` is the `reviewId` of a plan the owner has just reviewed (existing grant or trigger change). */
export function reviewStrategy(kind: PlanKind, template: Strategy, selection: { owner: Address; operator: Address; acknowledge?: Hex }): Promise<StrategyPlan> {
  const chosen: Selection = selection.acknowledge ? { owner: selection.owner, operator: selection.operator, acknowledge: selection.acknowledge } : { owner: selection.owner, operator: selection.operator };
  return kind === "adopt" ? buildAdoptionPlan(reader(), template, chosen) : buildRevocationPlan(reader(), template, chosen);
}

const V2_ACCOUNT_ABI = v2AccountAbi as Abi;
const V1_METHODS = new Set(["setAutoRepayTrigger", "setOperator", "revokeOperator"]);

/** What each planned call does, in the owner's words. Keyed by the SDK's fixed method names. */
export const METHOD_TEXT: Record<OwnerTransaction["method"], string> = {
  setAutoRepayTrigger: "Set the account-wide auto-repay trigger",
  setOperator: "Authorise the operator: repay only, with this budget and expiry",
  setGrant: "Authorise the operator for this one swap route, with these limits and expiry",
  revokeOperator: "Revoke every permission of this operator",
  revokeGrant: "Revoke this operator's grant for this one swap route",
};

/**
 * One reviewed owner transaction as a wallet step. The driver re-encodes `method(args)` with the generated ABI,
 * refuses unless it equals the reviewed calldata and the wallet is the reviewed owner, simulates, then sends.
 */
export function ownerTransactionStep(transaction: OwnerTransaction, index: number, total: number): TxPlanStep {
  const abi = V1_METHODS.has(transaction.method) ? withErrors(ABI.sentinel) : V2_ACCOUNT_ABI;
  return {
    title: `${METHOD_TEXT[transaction.method]}${total > 1 ? ` (${index + 1} of ${total})` : ""}`,
    build: async () => ({ address: transaction.to, abi, functionName: transaction.method, args: transaction.args, reviewed: { data: transaction.data, from: transaction.from } }),
  };
}

/** Text form of one argument for the review table. Addresses and numbers only: the SDK's args carry no free text. */
export function argumentText(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

/** Argument names per method, in order, for the review table (the SDK's `Calls` tuple labels). */
export const METHOD_ARGS: Record<OwnerTransaction["method"], readonly string[]> = {
  setAutoRepayTrigger: ["triggerBps"],
  setOperator: ["operator", "mask", "cumulative", "expiry"],
  setGrant: ["operator", "adapter", "op", "input", "perCall", "cumulative", "expiry"],
  revokeOperator: ["operator"],
  revokeGrant: ["operator", "adapter", "op", "input"],
};

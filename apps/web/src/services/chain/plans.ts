"use client";
/** Transaction plans: the exact wallet calls behind each UI action, built from the manifest and generated ABIs. */
import { type Hex, parseEventLogs, zeroHash } from "viem";
import { Op, type StudioTemplate } from "../../lib/policy.ts";
import type { Address, Market, MarketLimits, OperationRequest, SentinelAccount } from "../types.ts";
import { ABI, client, contract, manifest, withErrors } from "./client.ts";
import { operationCall, readPosition, requiredApproval } from "./reads.ts";
import type { TxPlanStep } from "./tx.ts";

const need = <T>(value: { status: "ok"; value: T } | { status: "unavailable"; reason: string }): T => {
  if (value.status !== "ok") throw new Error(value.reason);
  return value.value;
};

/** The ACCOUNT policy published in the manifest; attached when a Sentinel account is created. */
export function defaultAccountPolicyId(): Hex | null {
  return manifest().tapeout.circuits.find((circuit) => circuit.kind === "ACCOUNT")?.policyId ?? null;
}

export function operationPlan(market: Market, request: OperationRequest, account: SentinelAccount | null): TxPlanStep[] {
  const leg = request.leg === "collateral" ? market.collateral : market.debt;
  const tokenAddress = need(leg.token.address);
  const steps: TxPlanStep[] = [];
  if (request.path === "direct") {
    steps.push({
      title: `Approve ${leg.token.symbol}`,
      build: async ({ wallet }) => {
        const approval = await requiredApproval(market, request, wallet);
        // Exact amount, never unlimited.
        return approval ? { address: tokenAddress, abi: withErrors(ABI.token), functionName: "approve", args: [approval.spender, approval.amount] } : null;
      },
    });
  } else if (request.op === Op.SUPPLY) {
    steps.push({
      title: `Fund your Sentinel account with ${leg.token.symbol}`,
      build: async () => {
        const sentinel = need(account!.address);
        const idle = await client().readContract({ address: tokenAddress, abi: ABI.token, functionName: "balanceOf", args: [sentinel] });
        // A plain token transfer is how an account is funded (INTERFACES v1.1).
        return idle >= request.amount ? null : { address: tokenAddress, abi: withErrors(ABI.token), functionName: "transfer", args: [sentinel, request.amount - idle] };
      },
    });
  }
  steps.push({
    title: `${request.op === Op.SUPPLY ? "Supply" : request.op === Op.BORROW ? "Borrow" : request.op === Op.REPAY ? "Repay" : "Withdraw"} ${leg.token.symbol}`,
    build: async () => operationCall(market, request, account ? need(account.address) : null),
  });
  if (request.op === Op.SUPPLY && request.leg === "collateral") {
    steps.push({
      title: "Enable as collateral",
      build: async ({ wallet }) => {
        const controller = need(market.controller);
        const holder = request.path === "sentinel" ? need(account!.address) : wallet;
        const position = await readPosition(market, holder, request.path);
        if (position.collateralEntered) return null;
        return request.path === "sentinel"
          ? { address: holder, abi: withErrors(ABI.sentinel), functionName: "enterCollateral", args: [] }
          : { address: controller, abi: withErrors(ABI.controller), functionName: "enterMarkets", args: [[need(market.collateral.pToken)]] };
      },
    });
  }
  return steps;
}

/** Mock tokens are permissionlessly mintable on the test profile. */
export function mintTestTokensPlan(market: Market): TxPlanStep[] {
  return [market.collateral.token, market.debt.token].map((token) => ({
    title: `Mint test ${token.symbol}`,
    build: async ({ wallet }) => ({ address: need(token.address), abi: withErrors(ABI.token), functionName: "mint", args: [wallet, 1000n * 10n ** BigInt(token.decimals)] }),
  }));
}

export function createAccountPlan(controller: Address): TxPlanStep[] {
  return [
    {
      title: "Create Sentinel account",
      build: async () => {
        const policyId = defaultAccountPolicyId();
        if (!policyId) throw new Error("The deployment publishes no account policy to attach");
        return { address: contract("SentinelAccountFactory"), abi: withErrors(ABI.sentinelFactory), functionName: "createAccount", args: [controller, policyId] };
      },
    },
  ];
}

export function activatePlan(controller: Address): TxPlanStep[] {
  return [{ title: "Activate market", build: async () => ({ address: controller, abi: withErrors(ABI.controller), functionName: "activate", args: [] }) }];
}

/** INTERFACES v1.2 Studio wallet flow: circuit on the processor -> registerMarketTemplate -> createMarket. */
export function studioCreatePlan(template: StudioTemplate, limits: MarketLimits): TxPlanStep[] {
  const registry = contract("PolicyRegistry");
  const { compiled, spec, proof } = template;
  const processor = () => {
    const address = manifest().tapeout.processor;
    if (!address) throw new Error("The deployment has no policy processor");
    return address;
  };
  const existing = () => client().readContract({ address: registry, abi: ABI.registry, functionName: "marketTemplatePolicy", args: [processor(), compiled.configHash] });
  return [
    {
      title: "Put the circuit on the processor",
      build: async () => {
        if ((await existing()) !== zeroHash) return null; // already registered: reuse
        if (manifest().tapeout.mode !== "development-reference") throw new Error("Fabricating on this processor is not supported from the app yet");
        return { address: processor(), abi: withErrors(ABI.processor), functionName: "addReferenceCircuit", args: [compiled.netlist] };
      },
    },
    {
      title: "Register the policy",
      build: async ({ receipts }) => {
        if ((await existing()) !== zeroHash) return null;
        const added = receipts.flatMap((receipt) => parseEventLogs({ abi: ABI.processor, eventName: "ReferenceCircuitAdded", logs: receipt.logs })).at(-1);
        if (!added) throw new Error("The circuit id was not found in the previous receipt");
        return {
          address: registry,
          abi: withErrors(ABI.registry),
          functionName: "registerMarketTemplate",
          args: [processor(), added.args.id, spec.params.maxLtvBps, spec.params.requireCashReserve, compiled.netlistHash, compiled.configHash, proof],
        };
      },
    },
    {
      title: "Create the market",
      build: async () => {
        const policyId = await existing();
        if (policyId === zeroHash) throw new Error("The policy is not registered");
        return {
          address: contract("MarketFactory"),
          abi: withErrors(ABI.factory),
          functionName: "createMarket",
          args: [policyId, limits.borrowLtvBps, limits.liquidationLtvBps, limits.collateralSupplyCap, limits.debtSupplyCap, limits.borrowCap, limits.minCash],
        };
      },
    },
  ];
}

/* ---------- Sentinel owner actions (all `onlyOwner` on the account contract) ---------- */

/** A new grant replaces the previous one. Expiry is derived from the latest block's timestamp, never the browser clock. */
export function setOperatorPlan(account: Address, operator: Address, opsMask: number, maxAmount: bigint, days: number): TxPlanStep[] {
  return [
    {
      title: "Authorise operator",
      build: async () => {
        const block = await client().getBlock();
        return { address: account, abi: withErrors(ABI.sentinel), functionName: "setOperator", args: [operator, opsMask, maxAmount, block.timestamp + BigInt(days) * 86_400n] };
      },
    },
  ];
}

export function revokeOperatorPlan(account: Address, operator: Address): TxPlanStep[] {
  return [{ title: "Revoke operator", build: async () => ({ address: account, abi: withErrors(ABI.sentinel), functionName: "revokeOperator", args: [operator] }) }];
}

export function setTriggerPlan(account: Address, bps: number): TxPlanStep[] {
  return [{ title: bps === 0 ? "Disable auto-repay" : "Set auto-repay trigger", build: async () => ({ address: account, abi: withErrors(ABI.sentinel), functionName: "setAutoRepayTrigger", args: [bps] }) }];
}

/** Idle underlying leaves the account to its immutable owner. This is not a redeem: pTokens stay on the account. */
export function withdrawPlan(account: Address, asset: Address, amount: bigint, symbol: string): TxPlanStep[] {
  return [{ title: `Withdraw ${symbol} to your wallet`, build: async () => ({ address: account, abi: withErrors(ABI.sentinel), functionName: "withdraw", args: [asset, amount] }) }];
}

/** Controller address from a createMarket receipt. */
export function createdMarket(receipts: Parameters<typeof parseEventLogs>[0]["logs"][]): Address | null {
  for (const logs of receipts) {
    const created = parseEventLogs({ abi: ABI.factory, eventName: "MarketCreated", logs }).at(-1);
    if (created) return created.args.controller;
  }
  return null;
}

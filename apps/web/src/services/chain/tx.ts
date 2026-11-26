"use client";
/**
 * Wallet write driver. Each step is simulated as the connected wallet first (so a policy or protocol
 * rejection is reported before anything is signed), then sent, then awaited to a mined receipt.
 * Produces the same TxState the fixture simulation does, with `simulated: false` and real hashes.
 */
import type { Hex, TransactionReceipt } from "viem";
import { getConnection, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { TxResult, TxState, TxStep } from "../../components/domain/tx-feedback.tsx";
import { WRITE_CHAIN } from "../../lib/chains.ts";
import { mapContractError } from "../../lib/errors.ts";
import { retryRead } from "../../lib/retry.ts";
import { ok, unavailable } from "../../lib/maybe.ts";
import type { Address } from "../types.ts";
import { client, verifyDeployment } from "./client.ts";
import { wagmiConfig } from "./wagmi.ts";

export interface TxCall {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  returnsCode?: boolean;
}

export interface TxContext {
  wallet: Address;
  receipts: TransactionReceipt[];
}

export interface TxPlanStep {
  title: string;
  /** Built lazily so a step can depend on earlier receipts. Return null to skip the step. */
  build: (context: TxContext) => Promise<TxCall | null>;
}

export interface TxRun {
  ok: boolean;
  hashes: Hex[];
  receipts: TransactionReceipt[];
}

/**
 * Gas limit with headroom. A node's estimate is the smallest limit that worked at estimation time. These calls run
 * policy circuits several calls deep (each level keeps 1/64 of the gas) and accrue interest by block time, so the
 * same call can need a little more when it is mined: a borrow sent with the bare estimate ran out of gas on the
 * local chain (tx 0x33ab5fcc…97e3, block 98, 2026-11-26). Unused gas is not charged. If the estimate itself fails,
 * no limit is passed and the wallet decides, as before.
 */
const GAS_HEADROOM_PERCENT = 30n;
async function gasWithHeadroom(wallet: Address, call: TxCall): Promise<bigint | undefined> {
  try {
    const estimate = await retryRead(() => client().estimateContractGas({ account: wallet, address: call.address, abi: call.abi as never, functionName: call.functionName as never, args: call.args as never }), { attempts: 2 });
    return (estimate * (100n + GAS_HEADROOM_PERCENT)) / 100n;
  } catch {
    return undefined;
  }
}

export async function runPlan(plan: TxPlanStep[], successSummary: string, onState: (state: TxState) => void): Promise<TxRun> {
  const statuses: TxStep["status"][] = plan.map(() => "upcoming");
  const hashes: Hex[] = [];
  const receipts: TransactionReceipt[] = [];
  const emit = (result: TxResult | null) =>
    onState({
      phase: result ? "done" : "running",
      simulated: false,
      result,
      steps: plan.map((step, index) => ({ kind: "sign", title: step.title, description: "Confirm in your wallet, then wait for the network.", status: statuses[index]! })),
    });
  const fail = (index: number, error: unknown): TxRun => {
    statuses[index] = "failed";
    for (let later = index + 1; later < plan.length; later++) statuses[later] = "skipped";
    const last = hashes.at(-1);
    emit({ status: "failed", error: mapContractError(error), hash: last ? ok(last) : unavailable("Nothing was sent: the simulation already failed") });
    return { ok: false, hashes, receipts };
  };

  const connection = getConnection(wagmiConfig);
  if (connection.status !== "connected" || !connection.address) return fail(0, { name: "WalletNotConnected", message: "Connect a wallet first" });
  if (connection.chainId !== WRITE_CHAIN.id) return fail(0, { name: "ChainMismatchError" });
  const verified = await verifyDeployment();
  if (!verified.ok) return fail(0, { name: "DeploymentNotVerified", message: verified.reason });
  const wallet = connection.address;

  for (let index = 0; index < plan.length; index++) {
    statuses[index] = "active";
    emit(null);
    try {
      const call = await plan[index]!.build({ wallet, receipts });
      if (!call) {
        statuses[index] = "skipped";
        continue;
      }
      const simulate = () => simulateContract(wagmiConfig, { account: wallet, chainId: WRITE_CHAIN.id, address: call.address, abi: call.abi as never, functionName: call.functionName as never, args: call.args as never });
      // Right after a step of this plan was mined, a lagging RPC backend may not see it yet (for example the approval
      // a supply depends on). Only the SIMULATION, which is a read, is asked again. A write is never re-sent.
      const simulation = receipts.length > 0 ? await retryRead(simulate, { attempts: 4, baseDelayMs: 700 }) : await simulate();
      if (call.returnsCode && typeof simulation.result === "bigint" && simulation.result !== 0n) return fail(index, { name: "MarketOperationFailed", args: [simulation.result] });
      const hash = await writeContract(wagmiConfig, { ...simulation.request, gas: await gasWithHeadroom(wallet, call) } as never);
      hashes.push(hash);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: WRITE_CHAIN.id });
      receipts.push(receipt);
      if (receipt.status !== "success") return fail(index, { name: "TransactionReverted", message: `Transaction ${hash} was mined and reverted` });
      statuses[index] = "done";
    } catch (error) {
      return fail(index, error);
    }
  }
  const last = hashes.at(-1);
  emit({ status: "success", summary: successSummary, hash: last ? ok(last) : unavailable("Every step was already done: nothing needed to be sent") });
  return { ok: true, hashes, receipts };
}

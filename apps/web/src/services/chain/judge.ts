"use client";
/**
 * The prepared judge campaign as the chain reports it NOW (docs/JUDGE_DEMO.md: "read operators(operator) on the v1
 * account and grants(operator, swapAdapter, 5, inputAsset) on the v2 account at a stated block and compare each
 * expiry with that block's timestamp"). Public eth_calls only, no wallet. Every value of one result is read at the
 * same block and the block hash is re-read afterwards. A failed read is unavailable data, never the prepared values.
 */
import { SentinelAccountAbi } from "@peridot/chain-config";
import { parseAbi } from "viem";
import { getPublicClient } from "wagmi/actions";
import { xLayerTestnet } from "../../lib/chains.ts";
import { JUDGE_SWAP_OP, type JudgeCampaign, type JudgeGrantState, repayGrantState, swapGrantState } from "../../lib/judge.ts";
import { retryRead } from "../../lib/retry.ts";
import { wagmiConfig } from "./wagmi.ts";

const V2_ABI = parseAbi(["function owner() view returns (address)", "function operatorCount() view returns (uint256)", "function grants(address operator, address adapter, uint8 op, address inputAsset) view returns (uint256 maxPerCall, uint256 remaining, uint64 expiry)"]);

export interface LiveJudgeCampaign {
  block: bigint;
  blockHash: string;
  /** Block timestamp in seconds: expiry is judged against the chain's clock, not the browser's. */
  blockTime: bigint;
  /** Do all three accounts answer owner() with the campaign's owner? */
  ownersMatch: boolean;
  repay: { opsMask: number; remaining: bigint; expiry: bigint; triggerBps: number; state: JudgeGrantState };
  swap: { maxPerCall: bigint; remaining: bigint; expiry: bigint; operatorCount: bigint; state: JudgeGrantState };
}

export async function readJudgeCampaign(campaign: JudgeCampaign): Promise<LiveJudgeCampaign> {
  const rpc = getPublicClient(wagmiConfig, { chainId: xLayerTestnet.id });
  if (!rpc) throw new Error("No RPC client for X Layer testnet");
  const chainId = await retryRead(() => rpc.getChainId());
  if (chainId !== xLayerTestnet.id) throw new Error(`The RPC reports chain ${chainId}, expected ${xLayerTestnet.id}`);
  const pinned = await retryRead(() => rpc.getBlock({ blockTag: "latest" }));
  const at = { blockNumber: pinned.number } as const;
  const [a, b] = campaign.markets;
  if (!a || !b) throw new Error("The campaign does not list its two markets");
  const [code, repay, trigger, ownerA, ownerB, ownerV2, swap, operatorCount] = await Promise.all([
    retryRead(() => rpc.getCode({ address: campaign.v2.account, ...at }), { accept: (value) => Boolean(value && value !== "0x") }),
    retryRead(() => rpc.readContract({ address: a.account, abi: SentinelAccountAbi, functionName: "operators", args: [campaign.operator], ...at })),
    retryRead(() => rpc.readContract({ address: a.account, abi: SentinelAccountAbi, functionName: "autoRepayTriggerBps", ...at })),
    retryRead(() => rpc.readContract({ address: a.account, abi: SentinelAccountAbi, functionName: "owner", ...at })),
    retryRead(() => rpc.readContract({ address: b.account, abi: SentinelAccountAbi, functionName: "owner", ...at })),
    retryRead(() => rpc.readContract({ address: campaign.v2.account, abi: V2_ABI, functionName: "owner", ...at })),
    retryRead(() => rpc.readContract({ address: campaign.v2.account, abi: V2_ABI, functionName: "grants", args: [campaign.operator, campaign.v2.swapAdapter, JUDGE_SWAP_OP, campaign.v2.inputAsset], ...at })),
    retryRead(() => rpc.readContract({ address: campaign.v2.account, abi: V2_ABI, functionName: "operatorCount", ...at })),
  ]);
  if (!code || code === "0x") throw new Error("There is no contract code at the campaign's v2 account on chain 1952");
  // The public RPC is load-balanced. If the pinned block is no longer the same block, the reads are discarded.
  const again = await retryRead(() => rpc.getBlock({ blockNumber: pinned.number }));
  if (again.hash !== pinned.hash) throw new Error("The pinned block changed while it was being read. Read again.");
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  const repayGrant = { opsMask: repay[0], remaining: repay[1], expiry: repay[2] };
  const swapGrant = { maxPerCall: swap[0], remaining: swap[1], expiry: BigInt(swap[2]) };
  return {
    block: pinned.number,
    blockHash: pinned.hash,
    blockTime: pinned.timestamp,
    ownersMatch: same(ownerA, campaign.owner) && same(ownerB, campaign.owner) && same(ownerV2, campaign.owner),
    repay: { ...repayGrant, triggerBps: trigger, state: repayGrantState(repayGrant, pinned.timestamp) },
    swap: { ...swapGrant, operatorCount, state: swapGrantState(swapGrant, pinned.timestamp) },
  };
}

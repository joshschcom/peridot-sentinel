"use client";
/**
 * The authorisation a Sentinel Connect agent acts under, read from X Layer testnet 1952 right now.
 * Public eth_calls only, no wallet: the account and operator are the fixed public profile of the MCP server
 * (taken from the recorded run, src/lib/connect.ts). Every value of one result is read at the same block, and the
 * block's hash is re-read afterwards, so a result is never stitched together from two backends' views.
 */
import { SentinelAccountAbi } from "@peridot/chain-config";
import { getPublicClient } from "wagmi/actions";
import { xLayerTestnet } from "../../lib/chains.ts";
import { retryRead } from "../../lib/retry.ts";
import type { Address } from "../types.ts";
import { wagmiConfig } from "./wagmi.ts";

export interface LiveConnectGrant {
  chainId: number;
  block: bigint;
  blockHash: string;
  /** Block timestamp in seconds: expiry is judged against the chain's clock, not the browser's. */
  blockTime: bigint;
  account: Address;
  operator: Address;
  owner: Address;
  opsMask: number;
  remaining: bigint;
  expiry: bigint;
  triggerBps: number;
}

export async function readConnectGrant(account: Address, operator: Address): Promise<LiveConnectGrant> {
  const rpc = getPublicClient(wagmiConfig, { chainId: xLayerTestnet.id });
  if (!rpc) throw new Error("No RPC client for X Layer testnet");
  const chainId = await retryRead(() => rpc.getChainId());
  if (chainId !== xLayerTestnet.id) throw new Error(`The RPC reports chain ${chainId}, expected ${xLayerTestnet.id}`);
  const pinned = await retryRead(() => rpc.getBlock({ blockTag: "latest" }));
  const at = { blockNumber: pinned.number } as const;
  const [code, grant, trigger, owner] = await Promise.all([
    retryRead(() => rpc.getCode({ address: account, ...at }), { accept: (value) => Boolean(value && value !== "0x") }),
    retryRead(() => rpc.readContract({ address: account, abi: SentinelAccountAbi, functionName: "operators", args: [operator], ...at })),
    retryRead(() => rpc.readContract({ address: account, abi: SentinelAccountAbi, functionName: "autoRepayTriggerBps", ...at })),
    retryRead(() => rpc.readContract({ address: account, abi: SentinelAccountAbi, functionName: "owner", ...at })),
  ]);
  if (!code || code === "0x") throw new Error("There is no contract code at the account address on chain 1952");
  // The public RPC is load-balanced. If the pinned block is no longer the same block, the reads are discarded.
  const again = await retryRead(() => rpc.getBlock({ blockNumber: pinned.number }));
  if (again.hash !== pinned.hash) throw new Error("The pinned block changed while it was being read. Read again.");
  return { chainId, block: pinned.number, blockHash: pinned.hash, blockTime: pinned.timestamp, account, operator, owner, opsMask: grant[0], remaining: grant[1], expiry: grant[2], triggerBps: trigger };
}

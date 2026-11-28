"use client";
/**
 * Read-only access to Sentinel v2 on X Layer testnet 1952. No function here sends a transaction.
 * Every result is read at ONE pinned block whose hash is re-read afterwards (the public RPC is load-balanced).
 * The ABIs below are the few view functions this app calls; src/lib/expansion.test.ts checks each of them against
 * the contracts team's JSON ABIs in packages/chain-config/expansion/abi/.
 */
import { type Hex, erc20Abi, keccak256, parseAbi, zeroAddress } from "viem";
import { getPublicClient } from "wagmi/actions";
import { xLayerTestnet } from "../../lib/chains.ts";
import { type ExpansionManifest, V2_CONTRACTS, V2_OP } from "../../lib/expansion.ts";
import { retryRead } from "../../lib/retry.ts";
import type { Address } from "../types.ts";
import { wagmiConfig } from "./wagmi.ts";

export const V2_ACCOUNT_VIEW_SIGNATURES = [
  "function owner() view returns (address)",
  "function controller() view returns (address)",
  "function swapAdapter() view returns (address)",
  "function lendingAdapter() view returns (address)",
  "function executionPolicy() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function operatorCount() view returns (uint256)",
  "function operatorAt(uint256) view returns (address)",
  "function grants(address operator, address adapter, uint8 op, address inputAsset) view returns (uint256 maxPerCall, uint256 remaining, uint64 expiry)",
  "function exposure() view returns (uint256 collateralShares, uint256 debtRaw)",
] as const;
export const V2_FACTORY_VIEW_SIGNATURES = ["function accountOf(address) view returns (address)"] as const;
export const V2_SWAP_VIEW_SIGNATURES = ["function executionQuote(address tokenIn, uint256 amountIn) view returns (uint256 expectedOut, uint256 floorOut, uint256 timestamp)"] as const;
const ACCOUNT_ABI = parseAbi(V2_ACCOUNT_VIEW_SIGNATURES);
const FACTORY_ABI = parseAbi(V2_FACTORY_VIEW_SIGNATURES);
// The view's own custom errors, so a refused quote is reported by name (QuoteExpired: the mock price is too old).
const SWAP_ABI = parseAbi([...V2_SWAP_VIEW_SIGNATURES, "error QuoteExpired()", "error InvalidAsset()", "error InvalidAmount()"]);

export interface Pinned {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

function testnet() {
  const rpc = getPublicClient(wagmiConfig, { chainId: xLayerTestnet.id });
  if (!rpc) throw new Error("No RPC client for X Layer testnet");
  return rpc;
}

async function pinned<T>(read: (rpc: ReturnType<typeof testnet>, at: { blockNumber: bigint }, block: Pinned) => Promise<T>): Promise<T & { block: Pinned }> {
  const rpc = testnet();
  const chainId = await retryRead(() => rpc.getChainId());
  if (chainId !== xLayerTestnet.id) throw new Error(`The RPC reports chain ${chainId}, expected ${xLayerTestnet.id}`);
  const head = await retryRead(() => rpc.getBlock({ blockTag: "latest" }));
  const block: Pinned = { number: head.number, hash: head.hash, timestamp: head.timestamp };
  const value = await read(rpc, { blockNumber: head.number }, block);
  const again = await retryRead(() => rpc.getBlock({ blockNumber: head.number }));
  if (again.hash !== head.hash) throw new Error("The pinned block changed while it was being read. Read again.");
  return { ...value, block };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Is the v2 manifest really deployed on chain 1952? Runtime code hash of every manifest address, the factory's
 * owner-to-account mapping for the demo account, and the account's own pins (adapters, policy, v1 market, token pair).
 * Any problem is listed; the page then shows no v2 data at all.
 */
export async function verifyV2Deployment(manifest: ExpansionManifest, owner: Address): Promise<{ ok: boolean; problems: string[]; contracts: number; block: Pinned }> {
  return pinned(async (rpc, at) => {
    const problems: string[] = [];
    const codes = await Promise.all(V2_CONTRACTS.map((name) => retryRead(() => rpc.getCode({ address: manifest.contracts[name], ...at }), { accept: (code) => Boolean(code && code !== "0x") })));
    V2_CONTRACTS.forEach((name, index) => {
      const code = codes[index];
      if (!code || code === "0x") problems.push(`No contract code at the manifest's "${name}" address`);
      else if (!same(keccak256(code), manifest.runtimeCodeHashes[name])) problems.push(`The code at the manifest's "${name}" address is not the recorded code`);
    });
    if (problems.length === 0) {
      const account = manifest.contracts.account;
      const read = <F extends "owner" | "controller" | "swapAdapter" | "lendingAdapter" | "executionPolicy" | "token0" | "token1">(functionName: F) => retryRead(() => rpc.readContract({ address: account, abi: ACCOUNT_ABI, functionName, ...at }));
      const [mapped, accountOwner, controller, swap, lending, execution, token0, token1] = await Promise.all([
        retryRead(() => rpc.readContract({ address: manifest.contracts.factory, abi: FACTORY_ABI, functionName: "accountOf", args: [owner], ...at })),
        read("owner"),
        read("controller"),
        read("swapAdapter"),
        read("lendingAdapter"),
        read("executionPolicy"),
        read("token0"),
        read("token1"),
      ]);
      if (!same(mapped, account)) problems.push("The v2 factory does not map the recorded owner to the manifest's account");
      if (!same(accountOwner, owner)) problems.push("The manifest's account is not owned by the recorded owner");
      if (!same(controller, manifest.m4Controller)) problems.push("The account is not bound to the manifest's lending market");
      if (!same(swap, manifest.contracts.swap) || !same(lending, manifest.contracts.lending) || !same(execution, manifest.contracts.execution)) problems.push("The account's adapters or execution policy differ from the manifest");
      const pair = [token0.toLowerCase(), token1.toLowerCase()].sort().join();
      if (pair !== [manifest.tokens.wokb.address.toLowerCase(), manifest.tokens.usdc.address.toLowerCase()].sort().join()) problems.push("The account's token pair is not the manifest's mock pair");
    }
    return { ok: problems.length === 0, problems, contracts: V2_CONTRACTS.length };
  });
}

export interface V2Grant {
  operator: Address;
  op: number;
  inputAsset: Address;
  maxPerCall: bigint;
  remaining: bigint;
  expiry: bigint;
  expired: boolean;
}
export interface V2AccountState {
  account: Address;
  owner: Address;
  idleWokb: bigint;
  idleUsdc: bigint;
  collateralShares: bigint;
  debtRaw: bigint;
  /** Complete by construction: the account enumerates its operators (operatorCount / operatorAt). */
  operators: Address[];
  /** Swap grants only (the one operation this page is about). Spent or expired grants stay listed until revoked. */
  swapGrants: V2Grant[];
  block: Pinned;
}

const MAX_OPERATORS = 25n;
export async function readV2Account(manifest: ExpansionManifest, account: Address): Promise<V2AccountState> {
  return pinned(async (rpc, at, block) => {
    const call = { address: account, abi: ACCOUNT_ABI, ...at } as const;
    const [owner, wokb, usdc, exposure, count] = await Promise.all([
      retryRead(() => rpc.readContract({ ...call, functionName: "owner" })),
      retryRead(() => rpc.readContract({ address: manifest.tokens.wokb.address, abi: erc20Abi, functionName: "balanceOf", args: [account], ...at })),
      retryRead(() => rpc.readContract({ address: manifest.tokens.usdc.address, abi: erc20Abi, functionName: "balanceOf", args: [account], ...at })),
      retryRead(() => rpc.readContract({ ...call, functionName: "exposure" })),
      retryRead(() => rpc.readContract({ ...call, functionName: "operatorCount" })),
    ]);
    if (count > MAX_OPERATORS) throw new Error(`The account lists ${count} operators, more than this page reads`);
    const operators = await Promise.all(Array.from({ length: Number(count) }, (_, index) => retryRead(() => rpc.readContract({ ...call, functionName: "operatorAt", args: [BigInt(index)] }))));
    const swapGrants: V2Grant[] = [];
    for (const operator of operators) {
      for (const inputAsset of [manifest.tokens.wokb.address, manifest.tokens.usdc.address]) {
        const [maxPerCall, remaining, expiry] = await retryRead(() => rpc.readContract({ ...call, functionName: "grants", args: [operator, manifest.contracts.swap, V2_OP.SWAP, inputAsset] }));
        if (maxPerCall !== 0n || remaining !== 0n || expiry !== 0n) swapGrants.push({ operator, op: V2_OP.SWAP, inputAsset, maxPerCall, remaining, expiry, expired: expiry <= block.timestamp });
      }
    }
    return { account, owner, idleWokb: wokb, idleUsdc: usdc, collateralShares: exposure[0], debtRaw: exposure[1], operators, swapGrants };
  });
}

/** The v2 account a wallet owns, if any. Null when the factory has none for it. */
export async function v2AccountOf(manifest: ExpansionManifest, owner: Address): Promise<Address | null> {
  const rpc = testnet();
  const account = await retryRead(() => rpc.readContract({ address: manifest.contracts.factory, abi: FACTORY_ABI, functionName: "accountOf", args: [owner] }));
  return account === zeroAddress ? null : account;
}

/**
 * What the swap adapter would expect for an exact input, from its MOCK price source. A read-only quote of the testnet
 * venue: it is not an OKX quote, not a mainnet price and not an order.
 */
export async function readVenueQuote(manifest: ExpansionManifest, tokenIn: Address, amountIn: bigint): Promise<{ expectedOut: bigint; floorOut: bigint; priceTime: bigint; block: Pinned }> {
  return pinned(async (rpc, at) => {
    const [expectedOut, floorOut, priceTime] = await retryRead(() => rpc.readContract({ address: manifest.contracts.swap, abi: SWAP_ABI, functionName: "executionQuote", args: [tokenIn, amountIn], ...at }));
    return { expectedOut, floorOut, priceTime };
  });
}

/** Is the snapshot's last block still the canonical block at that height? Only then is the snapshot called canonical. */
export async function verifySnapshotTerminal(toBlock: bigint, toBlockHash: string): Promise<{ canonical: boolean; head: bigint; hash: string }> {
  const rpc = testnet();
  const [block, head] = await Promise.all([retryRead(() => rpc.getBlock({ blockNumber: toBlock })), retryRead(() => rpc.getBlockNumber({ cacheTime: 0 }))]);
  return { canonical: same(block.hash, toBlockHash), head, hash: block.hash };
}

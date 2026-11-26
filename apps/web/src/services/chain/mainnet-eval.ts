"use client";
/**
 * Read-only evaluation of a PUBLISHED TapeOut circuit on X Layer mainnet (chain 196), from the browser.
 * Three eth_calls on the processor's public read surface (docs/TAPEOUT_INTEGRATION.md):
 *   circuitInfo(uint256) -> (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates)
 *   netlist(uint256)     -> bytes
 *   eval(uint256, bytes) -> bytes
 * No wallet is involved and nothing is ever sent: this module has no write path. Mainnet can never be a write chain
 * in this app (src/lib/chains.ts).
 */
import { BaseError, ContractFunctionRevertedError, type Hex, TransactionReceiptNotFoundError, encodeFunctionData, keccak256, parseAbi, toEventSelector } from "viem";
import { getPublicClient } from "wagmi/actions";
import { xLayerMainnet } from "../../lib/chains.ts";
import { retryRead } from "../../lib/retry.ts";
import { type Decision, type PublicationCheck, checkPublication, decodeDecision } from "../../lib/tapeout.ts";
import type { Address } from "../types.ts";
import { wagmiConfig } from "./wagmi.ts";

export const TAPEOUT_PROCESSOR_READ_ABI = parseAbi([
  "function circuitInfo(uint256 id) view returns (uint32, uint32, uint32, uint32)",
  "function netlist(uint256 id) view returns (bytes)",
  "function eval(uint256 id, bytes input) view returns (bytes)",
  "function ownerOf(uint256 id) view returns (address)",
]);

export interface LiveCircuit {
  chainId: number;
  block: bigint;
  processor: Address;
  circuitId: bigint;
  codeBytes: number;
  dimensions: { nIn: number; nOut: number; nState: number; gates: number };
  netlistHash: Hex;
}

function mainnet() {
  const rpc = getPublicClient(wagmiConfig, { chainId: xLayerMainnet.id });
  if (!rpc) throw new Error("No RPC client for X Layer mainnet");
  return rpc;
}

/** Identity of the circuit as the chain reports it right now. Throws if the RPC is not chain 196 or there is no code. */
export async function readLiveCircuit(processor: Address, circuitId: bigint): Promise<LiveCircuit> {
  const rpc = mainnet();
  const chainId = await retryRead(() => rpc.getChainId());
  if (chainId !== xLayerMainnet.id) throw new Error(`The RPC reports chain ${chainId}, expected ${xLayerMainnet.id}`);
  const block = await retryRead(() => rpc.getBlockNumber({ cacheTime: 0 }));
  const [code, info, netlist] = await Promise.all([
    retryRead(() => rpc.getCode({ address: processor, blockNumber: block })),
    retryRead(() => rpc.readContract({ address: processor, abi: TAPEOUT_PROCESSOR_READ_ABI, functionName: "circuitInfo", args: [circuitId], blockNumber: block })),
    retryRead(() => rpc.readContract({ address: processor, abi: TAPEOUT_PROCESSOR_READ_ABI, functionName: "netlist", args: [circuitId], blockNumber: block })),
  ]);
  if (!code || code === "0x") throw new Error("There is no contract code at the processor address on chain 196");
  return {
    chainId,
    block,
    processor,
    circuitId,
    codeBytes: (code.length - 2) / 2,
    dimensions: { nIn: info[0], nOut: info[1], nState: info[2], gates: info[3] },
    netlistHash: keccak256(netlist),
  };
}

/** One eval(id, input) eth_call at a fixed block, so a table of results is internally consistent. */
export async function evalLive(processor: Address, circuitId: bigint, input: Hex, block: bigint): Promise<Hex> {
  const rpc = mainnet();
  return retryRead(() => rpc.readContract({ address: processor, abi: TAPEOUT_PROCESSOR_READ_ABI, functionName: "eval", args: [circuitId, input], blockNumber: block }));
}

/* ---------- Peridot's published circuits ---------- */

const TAPED_OUT_TOPIC = toEventSelector("TapedOut(uint256,address,uint32,uint32)");

/**
 * A read the CONTRACT reverted (for example an ID the processor does not hold) is a fact about the chain: null.
 * Anything else (transport, timeout, rate limit) stays an error, so an RPC failure is never read as "no circuit".
 */
function nullIfReverted(error: unknown): null {
  if (error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError)) return null;
  throw error;
}

export interface PinnedBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}
export type NativeEvaluation =
  /** The gate failed: nothing was evaluated. */
  | { state: "refused"; block: PinnedBlock; check: Extract<PublicationCheck, { ok: false }> }
  /** The gate passed and eval answered. `decision` is "invalid" when the output is not exactly 0x00 or 0x01. */
  | { state: "evaluated"; block: PinnedBlock; circuitId: bigint; input: Hex; output: Hex; decision: Decision; calldata: Hex; owner: Address | null; publishedInBlock: bigint };

/**
 * One displayed result = one block. A fresh block is pinned for every call of this function (so also whenever the
 * viewer changes an input), every eth_call carries that block number, and the block's hash is read again at the end:
 * if it changed, the whole result is discarded. The receipt is the one exception, since a receipt is not a state
 * read: it is tied to the chain by checking that its block is still the canonical block at its height.
 * RPC failures throw (the caller shows them as their own state). They are never turned into "deny".
 */
export async function evaluatePublished(processor: Address, circuit: { id: bigint; receipt: Hex; netlistHash: string; gates: number }, input: Hex): Promise<NativeEvaluation> {
  const rpc = mainnet();
  const chainId = await retryRead(() => rpc.getChainId());
  if (chainId !== xLayerMainnet.id) throw new Error(`The RPC reports chain ${chainId}, expected ${xLayerMainnet.id}`);
  const pinned = await retryRead(() => rpc.getBlock({ blockTag: "latest" }));
  const block: PinnedBlock = { number: pinned.number, hash: pinned.hash, timestamp: pinned.timestamp };
  const at = { blockNumber: pinned.number } as const;
  const read = { address: processor, abi: TAPEOUT_PROCESSOR_READ_ABI, ...at } as const;
  const [receipt, info, netlist] = await Promise.all([
    retryRead(() => rpc.getTransactionReceipt({ hash: circuit.receipt }).catch((error: unknown) => (error instanceof TransactionReceiptNotFoundError ? null : Promise.reject(error)))),
    retryRead(() => rpc.readContract({ ...read, functionName: "circuitInfo", args: [circuit.id] }).catch(nullIfReverted)),
    retryRead(() => rpc.readContract({ ...read, functionName: "netlist", args: [circuit.id] }).catch(nullIfReverted)),
  ]);
  const canonical = receipt ? await retryRead(() => rpc.getBlock({ blockNumber: receipt.blockNumber })) : null;
  const check = checkPublication(circuit, processor, {
    receipt: receipt ? { status: receipt.status, to: receipt.to, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) } : null,
    canonicalBlockHash: canonical?.hash ?? null,
    pinnedBlock: pinned.number,
    tapedOutTopic: TAPED_OUT_TOPIC,
    info: info ? { nIn: info[0], nOut: info[1], nState: info[2], gates: info[3] } : null,
    netlistHash: netlist ? keccak256(netlist) : null,
  });
  const samePin = async () => {
    const again = await retryRead(() => rpc.getBlock({ blockNumber: pinned.number }));
    if (again.hash !== pinned.hash) throw new Error("The pinned block changed while it was being read. Evaluate again.");
  };
  if (!check.ok) {
    await samePin();
    return { state: "refused", block, check };
  }
  const [output, owner] = await Promise.all([
    retryRead(() => rpc.readContract({ ...read, functionName: "eval", args: [circuit.id, input] })),
    retryRead(() => rpc.readContract({ ...read, functionName: "ownerOf", args: [circuit.id] })).catch(() => null),
  ]);
  await samePin();
  return { state: "evaluated", block, circuitId: circuit.id, input, output, decision: decodeDecision(output), calldata: encodeFunctionData({ abi: TAPEOUT_PROCESSOR_READ_ABI, functionName: "eval", args: [circuit.id, input] }), owner, publishedInBlock: receipt!.blockNumber };
}

/** Is the configured processor there at all? One block, one code read. Used while no Peridot circuit is published. */
export async function readProcessorPresence(processor: Address): Promise<{ block: PinnedBlock; codeBytes: number }> {
  const rpc = mainnet();
  const chainId = await retryRead(() => rpc.getChainId());
  if (chainId !== xLayerMainnet.id) throw new Error(`The RPC reports chain ${chainId}, expected ${xLayerMainnet.id}`);
  const pinned = await retryRead(() => rpc.getBlock({ blockTag: "latest" }));
  const code = await retryRead(() => rpc.getCode({ address: processor, blockNumber: pinned.number }), { accept: (value) => Boolean(value && value !== "0x") });
  return { block: { number: pinned.number, hash: pinned.hash, timestamp: pinned.timestamp }, codeBytes: code && code !== "0x" ? (code.length - 2) / 2 : 0 };
}

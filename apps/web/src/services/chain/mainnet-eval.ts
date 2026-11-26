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
import { type Hex, keccak256, parseAbi } from "viem";
import { getPublicClient } from "wagmi/actions";
import { xLayerMainnet } from "../../lib/chains.ts";
import { retryRead } from "../../lib/retry.ts";
import type { Address } from "../types.ts";
import { wagmiConfig } from "./wagmi.ts";

export const TAPEOUT_PROCESSOR_READ_ABI = parseAbi([
  "function circuitInfo(uint256 id) view returns (uint32, uint32, uint32, uint32)",
  "function netlist(uint256 id) view returns (bytes)",
  "function eval(uint256 id, bytes input) view returns (bytes)",
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

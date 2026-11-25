"use client";
/**
 * Chain access for the target deployment. Everything here is driven by the validated manifest
 * (RUNTIME.manifest) and the generated ABIs from @peridot/chain-config. No address or ABI is hand-written.
 */
import {
  DemoRateModelAbi,
  DevelopmentReferenceProcessorAbi,
  IsolatedControllerAbi,
  MarketFactoryAbi,
  MarketPTokenAbi,
  PolicyRegistryAbi,
  SentinelAccountAbi,
  SentinelAccountFactoryAbi,
  TapeOutPolicyAdapterAbi,
  TestnetOracleAbi,
  TestnetTokenAbi,
} from "@peridot/chain-config";
import type { Abi, PublicClient } from "viem";
import { getPublicClient } from "wagmi/actions";
import { LOG_MAX_PAGES, LOG_PAGE_BLOCKS, WRITE_CHAIN } from "../../lib/chains.ts";
import { fetchLogPages, scanWindow } from "../../lib/log-pages.ts";
import type { DeploymentManifest } from "../../lib/manifest.ts";
import { STUDIO_MARKET_ROOT } from "../../lib/policy.ts";
import { RUNTIME } from "../runtime.ts";
import type { Address } from "../types.ts";
import { wagmiConfig } from "./wagmi.ts";

export const ABI = {
  rateModel: DemoRateModelAbi,
  processor: DevelopmentReferenceProcessorAbi,
  controller: IsolatedControllerAbi,
  factory: MarketFactoryAbi,
  pToken: MarketPTokenAbi,
  registry: PolicyRegistryAbi,
  sentinel: SentinelAccountAbi,
  sentinelFactory: SentinelAccountFactoryAbi,
  adapter: TapeOutPolicyAdapterAbi,
  oracle: TestnetOracleAbi,
  token: TestnetTokenAbi,
} as const;

/** Every custom error from every generated ABI, so a revert bubbling up from any contract can be decoded. */
const seen = new Set<string>();
export const ERRORS_ABI = Object.values(ABI)
  .flatMap((abi) => (abi as Abi).filter((item) => item.type === "error"))
  .filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) as Abi;

export function withErrors<const T extends Abi>(abi: T): T {
  return [...abi, ...ERRORS_ABI.filter((error) => !abi.some((item) => item.type === "error" && "name" in error && "name" in item && item.name === error.name))] as unknown as T;
}

export function manifest(): DeploymentManifest {
  if (RUNTIME.manifest.state !== "deployed") throw new Error("No deployed manifest for the target chain");
  return RUNTIME.manifest.manifest;
}

export function contract(name: string): Address {
  const address = manifest().contracts[name];
  if (!address) throw new Error(`Manifest has no ${name} address`);
  return address;
}

export function client(): PublicClient {
  const found = getPublicClient(wagmiConfig, { chainId: WRITE_CHAIN.id });
  if (!found) throw new Error("No RPC client for the target chain");
  return found as PublicClient;
}

export const DEPLOYMENT_BLOCK = (): bigint => BigInt(RUNTIME.manifest.state === "deployed" ? (RUNTIME.manifest.manifest.deploymentBlock ?? "0") : "0");

/* ---------- manifest-derived labels (nothing here may assume the local profile) ---------- */

const mockAddresses = (): Set<string> => {
  const m = manifest();
  return new Set(m.mocks.flatMap((name) => (typeof name === "string" && m.contracts[name] ? [m.contracts[name]!.toLowerCase()] : [])));
};
/** True only for a token the manifest lists under `mocks` (permissionless test token without value). */
export const isMockToken = (address: Address): boolean => mockAddresses().has(address.toLowerCase());
/** The oracle is a mock feed exactly when the manifest says so. */
export const feedLabel = (): string => (manifest().mocks.includes("TestnetOracle") ? "Test price feed (mock, owner-set)" : "On-chain price feed");
export const feedIsMock = (): boolean => RUNTIME.manifest.state === "deployed" && RUNTIME.manifest.manifest.mocks.includes("TestnetOracle");

/* ---------- paged log scans ---------- */

export interface LogScan<L> {
  logs: L[];
  fromBlock: bigint;
  toBlock: bigint;
  /** False when blocks between the deployment block and `fromBlock` were not scanned. */
  complete: boolean;
}

type CachedScan = { from: bigint; to: bigint; logs: Array<{ blockNumber: bigint }> };
const logCache = new Map<string, CachedScan>();
let logDepth = 1;
const REORG_OVERLAP = 12n;

/** Doubles how far back log scans reach ("Scan further back"). Cached scans are dropped and redone. */
export function extendLogWindow(): number {
  logDepth *= 2;
  logCache.clear();
  return logDepth;
}

/**
 * Logs for one query from the deployment block (or as far back as the page budget reaches) to the head, in pages
 * the RPC accepts. Results are cached per key; a later call only fetches the new blocks plus a short overlap.
 */
export async function scanLogs<L extends { blockNumber: bigint }>(key: string, fetchPage: (fromBlock: bigint, toBlock: bigint) => Promise<L[]>): Promise<LogScan<L>> {
  // Never a cached head: a scan right after a confirmed transaction must include that transaction's block.
  const latest = await client().getBlockNumber({ cacheTime: 0 });
  const deployment = DEPLOYMENT_BLOCK();
  const window = scanWindow(deployment, latest, LOG_PAGE_BLOCKS, LOG_MAX_PAGES * logDepth);
  const options = { pageBlocks: LOG_PAGE_BLOCKS, concurrency: 4 };
  const cached = logCache.get(key);
  if (cached && cached.to <= latest && cached.to + 1n >= window.from) {
    const resume = cached.to - cached.from >= REORG_OVERLAP ? cached.to - REORG_OVERLAP + 1n : cached.from;
    const fresh = await fetchLogPages(fetchPage, resume, latest, options);
    const next: CachedScan = { from: cached.from, to: latest, logs: [...cached.logs.filter((log) => log.blockNumber < resume), ...fresh] };
    logCache.set(key, next);
    return { logs: next.logs as L[], fromBlock: next.from, toBlock: latest, complete: next.from <= deployment };
  }
  const logs = await fetchLogPages(fetchPage, window.from, window.to, options);
  logCache.set(key, { from: window.from, to: latest, logs });
  return { logs, fromBlock: window.from, toBlock: latest, complete: window.complete };
}

export type DeploymentCheck = { ok: true; chainId: number; contracts: number; root: string } | { ok: false; reason: string };

let verification: Promise<DeploymentCheck> | null = null;

/**
 * INTERFACES: "verify chain ID and code before wallet writes". Checked once per page load against the RPC:
 * chain id equals the manifest's, every manifest contract and market address has bytecode, and the on-chain
 * MARKET_TEMPLATE_ROOT() equals both the manifest capability and the SDK root.
 */
export function resetDeploymentCheck(): void {
  verification = null;
}

export function verifyDeployment(): Promise<DeploymentCheck> {
  verification ??= (async (): Promise<DeploymentCheck> => {
    try {
      const m = manifest();
      const rpc = client();
      const chainId = await rpc.getChainId();
      if (chainId !== m.chainId) return { ok: false, reason: `RPC reports chain ${chainId}, manifest is for ${m.chainId}` };
      const addresses = [...Object.values(m.contracts), ...m.markets.flatMap((market) => Object.values(market).filter((value): value is Address => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)))];
      const codes = await Promise.all(addresses.map((address) => rpc.getCode({ address })));
      const missing = addresses.filter((_, index) => !codes[index] || codes[index] === "0x");
      if (missing.length) return { ok: false, reason: `No bytecode at ${missing.length} manifest address(es), e.g. ${missing[0]}` };
      const manifestRoot = m.capabilities.studioMarketTemplateRoot;
      if (!manifestRoot) return { ok: false, reason: "Manifest does not publish capabilities.studioMarketTemplateRoot" };
      const onChainRoot = await rpc.readContract({ address: contract("PolicyRegistry"), abi: ABI.registry, functionName: "MARKET_TEMPLATE_ROOT" });
      const sdk = STUDIO_MARKET_ROOT.toLowerCase();
      if (manifestRoot.toLowerCase() !== sdk || onChainRoot.toLowerCase() !== sdk) return { ok: false, reason: "Template root mismatch between the compiler, the manifest and the deployed registry" };
      return { ok: true, chainId, contracts: addresses.length, root: onChainRoot };
    } catch (error) {
      verification = null; // allow a retry after a transport failure
      return { ok: false, reason: error instanceof Error ? error.message.split("\n")[0]! : "Deployment could not be verified" };
    }
  })();
  return verification;
}

import { defineChain } from "viem";

/**
 * X Layer chain definitions. RPCs and explorer roots follow docs/coordination/INTERFACES.md (v1).
 * Wallet writes are only ever allowed on the build's target chain: X Layer testnet 1952 by default.
 * Mainnet 196 is configured for read-only calls and is never offered as a switch target.
 */
export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  // The override exists for a second official endpoint or a rate-limit workaround. It is public configuration, never a key.
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_TESTNET_RPC_URL || "https://testrpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer-test" } },
  testnet: true,
});

export const xLayerMainnet = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer" } },
});

/**
 * Local development chain (unforked Anvil, test profile). Only used when the app is started with
 * NEXT_PUBLIC_PERIDOT_TARGET=local; it is labelled "Local development chain" everywhere, never "Testnet".
 *
 * A build for the public testnet (the default, and the hosted app) must not contain a loopback address at all, so
 * this file has no default for the local RPC: next.config.ts supplies it, and only to a local-target build. In a
 * testnet build the chain keeps a reserved ".invalid" host that nothing reads.
 */
const LOCAL_RPC_URL: string = process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://local-target-not-built.invalid";
export const localDevChain = defineChain({
  id: 31337,
  name: "Local development chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [LOCAL_RPC_URL] } },
  testnet: true,
});

export type TargetKind = "testnet" | "local";
/** Which deployment this build talks to. Default: X Layer testnet. Mainnet can never be a target. */
export const TARGET_KIND: TargetKind = process.env.NEXT_PUBLIC_PERIDOT_TARGET === "local" ? "local" : "testnet";
export const WRITE_CHAIN = TARGET_KIND === "local" ? localDevChain : xLayerTestnet;
export const WRITE_CHAIN_ID: number = WRITE_CHAIN.id;
/**
 * A testnet-target build pointed at a PRIVATE FORK of chain 1952 (a loopback Anvil with `--chain-id 1952`), used only
 * to accept wallet signing against the real testnet state without a funded key. Set by NEXT_PUBLIC_PERIDOT_FORK=1
 * through next.config.ts. Such a build is labelled "Private fork of 1952" everywhere, offers no faucet, and never
 * produces a testnet explorer link: nothing that happens on a fork exists on the public chain.
 */
export const IS_PRIVATE_FORK: boolean = TARGET_KIND === "testnet" && process.env.NEXT_PUBLIC_PERIDOT_FORK === "1";
export const TARGET_LABEL = TARGET_KIND === "local" ? "Local development chain" : IS_PRIVATE_FORK ? "Private fork of 1952" : "Testnet";
/** Phone header: the full label does not fit next to a connected wallet at 360 px. */
export const TARGET_LABEL_SHORT = TARGET_KIND === "local" ? "Local" : IS_PRIVATE_FORK ? "Fork" : "Testnet";
export const TARGET_DETAIL = TARGET_KIND === "local" ? "Anvil · 31337" : IS_PRIVATE_FORK ? "Anvil fork · not public" : "X Layer · 1952";
export const READ_ONLY_CHAIN_ID = xLayerMainnet.id;
/** Test OKB for network fees on X Layer testnet. Local chains have pre-funded accounts. */
export const FAUCET_URL: string | null = TARGET_KIND === "testnet" && !IS_PRIVATE_FORK ? "https://web3.okx.com/xlayer/faucet/xlayerfaucet" : null;

const positiveInt = (value: string | undefined, fallback: number): number => (value && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : fallback);
/**
 * eth_getLogs paging. Both official X Layer testnet RPCs refuse more than 100 blocks per query (checked 2026-11-25),
 * so the testnet default is 100. A refused page is halved at runtime, so a wrong value costs requests, not correctness.
 */
export const LOG_PAGE_BLOCKS = BigInt(positiveInt(process.env.NEXT_PUBLIC_LOG_PAGE_BLOCKS, TARGET_KIND === "local" ? 5000 : 100));
/** Pages a first scan may fetch back from the head. History before that is reported as not scanned. */
export const LOG_MAX_PAGES = positiveInt(process.env.NEXT_PUBLIC_LOG_MAX_PAGES, 40);
/**
 * Pages a first scan fetches forward from the deployment block when the head pages do not reach it (the deployment's
 * own events and the first recorded demo activity live there). The blocks in between are reported as not scanned.
 */
export const LOG_EARLY_PAGES = positiveInt(process.env.NEXT_PUBLIC_LOG_EARLY_PAGES, 10);

export function chainName(chainId: number | undefined): string {
  if (chainId === xLayerTestnet.id) return xLayerTestnet.name;
  if (chainId === xLayerMainnet.id) return `${xLayerMainnet.name} (read-only)`;
  if (chainId === 31337) return "Local development chain (31337)";
  return chainId === undefined ? "No network" : `Unsupported network (${chainId})`;
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Explorer links are only produced for live data. Fixture records never get one. */
export function explorerTxUrl(chainId: number, hash: string): string | null {
  const root = explorerRoot(chainId);
  return root && HASH_PATTERN.test(hash) ? `${root}/tx/${hash}` : null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const root = explorerRoot(chainId);
  return root && ADDRESS_PATTERN.test(address) ? `${root}/address/${address}` : null;
}

function explorerRoot(chainId: number): string | null {
  // On a private fork the app's own "testnet" hashes do not exist on the public chain: no link at all.
  if (chainId === xLayerTestnet.id) return IS_PRIVATE_FORK ? null : xLayerTestnet.blockExplorers.default.url;
  if (chainId === xLayerMainnet.id) return xLayerMainnet.blockExplorers.default.url;
  return null;
}

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
 */
export const localDevChain = defineChain({
  id: 31337,
  name: "Local development chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:18545"] } },
  testnet: true,
});

export type TargetKind = "testnet" | "local";
/** Which deployment this build talks to. Default: X Layer testnet. Mainnet can never be a target. */
export const TARGET_KIND: TargetKind = process.env.NEXT_PUBLIC_PERIDOT_TARGET === "local" ? "local" : "testnet";
export const WRITE_CHAIN = TARGET_KIND === "local" ? localDevChain : xLayerTestnet;
export const WRITE_CHAIN_ID: number = WRITE_CHAIN.id;
export const TARGET_LABEL = TARGET_KIND === "local" ? "Local development chain" : "Testnet";
export const TARGET_DETAIL = TARGET_KIND === "local" ? "Anvil · 31337" : "X Layer · 1952";
export const READ_ONLY_CHAIN_ID = xLayerMainnet.id;

const positiveInt = (value: string | undefined, fallback: number): number => (value && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : fallback);
/**
 * eth_getLogs paging. Both official X Layer testnet RPCs refuse more than 100 blocks per query (checked 2026-11-25),
 * so the testnet default is 100. A refused page is halved at runtime, so a wrong value costs requests, not correctness.
 */
export const LOG_PAGE_BLOCKS = BigInt(positiveInt(process.env.NEXT_PUBLIC_LOG_PAGE_BLOCKS, TARGET_KIND === "local" ? 5000 : 100));
/** Pages a first scan may fetch back from the head. History before that is reported as not scanned. */
export const LOG_MAX_PAGES = positiveInt(process.env.NEXT_PUBLIC_LOG_MAX_PAGES, 40);

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
  if (chainId === xLayerTestnet.id) return xLayerTestnet.blockExplorers.default.url;
  if (chainId === xLayerMainnet.id) return xLayerMainnet.blockExplorers.default.url;
  return null;
}

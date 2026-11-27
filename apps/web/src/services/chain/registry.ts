"use client";
/**
 * The public strategy registry on X Layer testnet 1952, read through the contracts team's SDK
 * (packages/strategy-sdk/registry.ts). This module never validates a publication itself.
 *
 *   check     one read of the pinned address at head − confirmations: chain id and runtime code hash. If it fails,
 *             NOTHING of the registry is shown or offered. That is a different state from a page that cannot be read.
 *   scan      `discoverPublishedStrategies`, one page of at most 100 confirmed blocks at a time, on the fixed grid
 *             from the deployment block. The SDK checks the registry code, every event's block hash, that event and
 *             stored record agree, the content hash, the canonical bytes, the strategy validator and the three index
 *             labels. It returns accepted and rejected publications apart. A page the RPC does not serve is reported
 *             with its range and reason; it is never counted as "no publications".
 *   re-read   one publication for the adoption page: the SAME discovery call on the one block its event is in.
 *             There is no second, weaker path to adoption.
 *   publish   `buildStrategyPublication`: the SDK validates and canonicalises the text, checks the registry and the
 *             next version, and returns ONE unsigned, zero-value transaction to the registry. The creator signs it
 *             after reviewing it. It stores text under the creator's own address and grants nothing to anyone.
 * A publication is text. What it may lead to is decided by the existing owner review (services/chain/strategy.ts).
 */
import { type Abi, type Hex, type PublicClient, createPublicClient, http, keccak256, stringToHex } from "viem";
import registryAbiJson from "../../../../../packages/chain-config/expansion/abi/StrategyRegistry.json" with { type: "json" };
import { buildStrategyPublication, discoverPublishedStrategies, registryAbi } from "../../../../../packages/strategy-sdk/registry.ts";
import { xLayerTestnet } from "../../lib/chains.ts";
import { retryRead } from "../../lib/retry.ts";
import type { CheckedStrategy } from "../../lib/strategy.ts";
import type { Address } from "../types.ts";
import type { TxPlanStep } from "./tx.ts";
import { type CoverageRange, type PublicationKey, type RegistryPinFile, coverageRanges, pageCount, pageSpan, samePublication, selectPages } from "../../lib/strategy-registry.ts";

export interface PublishedStrategy extends CheckedStrategy {
  creator: Hex;
  seriesId: Hex;
  version: number;
  transactionHash: Hex;
  publishedBlock: bigint;
  logIndex: number;
}
export interface RejectedPublication {
  creator: Hex;
  seriesId: Hex;
  version: number;
  transactionHash: Hex;
  publishedBlock: bigint;
  logIndex: number;
  /** The SDK's own sentence. No text of the publication is kept. */
  reason: string;
}

let cachedClient: PublicClient | null = null;
/**
 * A client of its own. No transport retries: the SDK already asks three times for every read, and a page that still
 * fails is reported as unavailable instead of being retried further against a public RPC. Calls made in the same
 * moment travel as one JSON-RPC batch, so reading several pages side by side costs about as many HTTP requests as
 * reading one (the SDK makes its reads of a page one after the other; each takes a few hundred ms on the public RPC).
 */
function registryClient(): PublicClient {
  cachedClient ??= createPublicClient({ chain: xLayerTestnet, transport: http(xLayerTestnet.rpcUrls.default.http[0], { retryCount: 0, timeout: 20_000, batch: { wait: 16, batchSize: 16 } }) }) as PublicClient;
  return cachedClient;
}
const firstLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

export type RegistryCheck = { state: "verified"; head: bigint; confirmed: bigint } | { state: "mismatch" | "unreachable"; reason: string };

/** Is the pinned address, on this RPC, the reviewed registry? Read at head − confirmations. */
export async function checkRegistry(pin: RegistryPinFile): Promise<RegistryCheck> {
  const client = registryClient();
  try {
    const [chainId, latest] = await retryRead(() => Promise.all([client.getChainId(), client.getBlock({ blockTag: "latest" })]), { attempts: 3 });
    if (chainId !== pin.chainId) return { state: "mismatch", reason: `the RPC reports chain ${chainId}, not ${pin.chainId}` };
    const confirmed = latest.number - BigInt(pin.confirmations);
    if (confirmed < pin.deploymentBlock) return { state: "mismatch", reason: "the chain is shorter than the registry's deployment block plus its confirmations" };
    const code = await retryRead(() => client.getCode({ address: pin.address, blockNumber: confirmed }), { attempts: 3, accept: (value) => Boolean(value && value !== "0x") });
    if (!code || code === "0x") return { state: "mismatch", reason: "there is no contract code at the registry address" };
    if (keccak256(code).toLowerCase() !== pin.runtimeCodeHash.toLowerCase()) return { state: "mismatch", reason: "the code at the registry address is not the reviewed registry (its runtime code hash differs)" };
    return { state: "verified", head: latest.number, confirmed };
  } catch (error) {
    return { state: "unreachable", reason: firstLine(error) };
  }
}

interface PageData {
  accepted: PublishedStrategy[];
  rejected: RejectedPublication[];
}
/** Pages read successfully, by block range. A confirmed page of an append-only registry does not change. */
const pageCache = new Map<string, PageData>();

async function readPage(pin: RegistryPinFile, from: bigint, to: bigint): Promise<PageData> {
  const key = `${pin.address}:${from}:${to}`;
  const known = pageCache.get(key);
  if (known) return known;
  const page = await discoverPublishedStrategies(registryClient(), pin, { fromBlock: from, toBlock: to });
  const data: PageData = {
    accepted: page.accepted.map((item) => ({ template: item.template, canonical: item.canonical, hash: item.hash, creator: item.creator, seriesId: item.seriesId, version: item.version, transactionHash: item.transactionHash, publishedBlock: item.publishedBlock, logIndex: item.logIndex })),
    rejected: page.rejected.map((item) => ({ creator: item.creator, seriesId: item.seriesId, version: item.version, transactionHash: item.transactionHash, publishedBlock: item.publishedBlock, logIndex: item.logIndex, reason: item.reason })),
  };
  pageCache.set(key, data);
  return data;
}

export type RegistryScan =
  | { state: "verified"; head: bigint; confirmed: bigint; pages: number; pagesRead: number; ranges: CoverageRange[]; accepted: PublishedStrategy[]; rejected: RejectedPublication[] }
  | { state: "mismatch" | "unreachable"; reason: string };

const byPosition = (a: { publishedBlock: bigint; logIndex: number }, b: { publishedBlock: bigint; logIndex: number }) => (a.publishedBlock === b.publishedBlock ? a.logIndex - b.logIndex : a.publishedBlock < b.publishedBlock ? -1 : 1);

const PAGES_SIDE_BY_SIDE = 5;

/**
 * Reads the first `early` and the last `head` pages of the registry's history, at most five side by side. The result states
 * every block range from the deployment block through head − confirmations as read, not read, or unavailable.
 */
export async function scanRegistry(pin: RegistryPinFile, budget: { early: number; head: number }): Promise<RegistryScan> {
  const check = await checkRegistry(pin);
  if (check.state !== "verified") return check;
  const total = pageCount(pin.deploymentBlock, check.confirmed);
  const wanted = selectPages(total, budget.early, budget.head);
  const outcome = new Map<number, { ok: true } | { ok: false; reason: string }>();
  const accepted: PublishedStrategy[] = [];
  const rejected: RejectedPublication[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < wanted.length) {
      const index = wanted[cursor++]!;
      const span = pageSpan(pin.deploymentBlock, check.confirmed, index);
      try {
        const page = await readPage(pin, span.from, span.to);
        accepted.push(...page.accepted);
        rejected.push(...page.rejected);
        outcome.set(index, { ok: true });
      } catch (error) {
        outcome.set(index, { ok: false, reason: firstLine(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: PAGES_SIDE_BY_SIDE }, worker));
  return { state: "verified", head: check.head, confirmed: check.confirmed, pages: total, pagesRead: [...outcome.values()].filter((entry) => entry.ok).length, ranges: coverageRanges(pin.deploymentBlock, check.confirmed, outcome), accepted: accepted.sort(byPosition), rejected: rejected.sort(byPosition) };
}

export type PublicationRead =
  | { state: "verified"; item: PublishedStrategy; confirmed: bigint }
  | { state: "rejected"; item: RejectedPublication }
  | { state: "not-found"; reason: string }
  | { state: "pending"; reason: string }
  | { state: "mismatch" | "unreachable" | "unavailable"; reason: string };

/**
 * One publication, for the adoption page. The registry is checked, then the SDK reads the one block the key names:
 * its event, the stored record, hash, canonical bytes, validator and labels. Only "verified" may lead to a review.
 */
export async function readPublication(pin: RegistryPinFile, key: PublicationKey): Promise<PublicationRead> {
  const check = await checkRegistry(pin);
  if (check.state !== "verified") return check;
  if (key.block < pin.deploymentBlock) return { state: "not-found", reason: `block ${key.block} is before the registry was deployed` };
  if (key.block > check.confirmed) return { state: "pending", reason: `block ${key.block} does not have ${pin.confirmations} confirmations yet (confirmed through ${check.confirmed})` };
  try {
    const page = await readPage(pin, key.block, key.block);
    const item = page.accepted.find((entry) => samePublication(entry, key));
    if (item) return { state: "verified", item, confirmed: check.confirmed };
    const refused = page.rejected.find((entry) => samePublication(entry, key));
    if (refused) return { state: "rejected", item: refused };
    return { state: "not-found", reason: `the registry has no such publication in block ${key.block}` };
  } catch (error) {
    return { state: "unavailable", reason: firstLine(error) };
  }
}

/* ---------- publishing ---------- */

export type Publication = Awaited<ReturnType<typeof buildStrategyPublication>>;
export type PreparedPublication = { ok: true; publication: Publication; bytes: number } | { ok: false; reason: string };
/** The generated ABI (with the registry's custom errors), for simulation and friendly reverts. Calldata is the SDK's. */
const REGISTRY_ABI = registryAbiJson as Abi;

/**
 * The unsigned publication of `canonical` as the next version of the creator's series. Read-only. The version is the
 * one after the latest the chain reports; the SDK checks it again at the confirmed block and refuses a mismatch (a
 * publication of the same series that is still confirming), in which case nothing is offered.
 */
export async function preparePublication(pin: RegistryPinFile, request: { creator: Address; seriesId: Hex; canonical: string }): Promise<PreparedPublication> {
  const check = await checkRegistry(pin);
  if (check.state !== "verified") return { ok: false, reason: check.state === "mismatch" ? `The registry could not be verified: ${check.reason}` : `The registry could not be read: ${check.reason}` };
  try {
    const client = registryClient();
    const latest = await retryRead(() => client.readContract({ address: pin.address, abi: registryAbi, functionName: "latestVersion", args: [request.creator, request.seriesId] }), { attempts: 3 });
    const publication = await buildStrategyPublication(client, pin, { creator: request.creator, seriesId: request.seriesId, expectedVersion: latest + 1, json: request.canonical });
    return { ok: true, publication, bytes: (stringToHex(publication.canonical).length - 2) / 2 };
  } catch (error) {
    const reason = firstLine(error);
    return { ok: false, reason: reason === "Expected strategy version differs from registry" ? "An earlier publication of this series is still being confirmed. Wait a few seconds and prepare it again" : reason };
  }
}

/** The six arguments of publish(), in order, exactly as the SDK encoded them into the reviewed calldata. */
export function publicationArgs(publication: Publication): readonly [Hex, number, bigint, Hex, Hex, Hex] {
  return [publication.seriesId, publication.expectedVersion, publication.topics.targetChainId, publication.topics.adapterVersion, publication.topics.policyKey, stringToHex(publication.canonical)];
}

/** The reviewed publication as one wallet step. The driver refuses unless the call encodes to the SDK's calldata and the wallet is the creator. */
export function publicationStep(publication: Publication): TxPlanStep {
  return {
    title: `Publish version ${publication.expectedVersion} to the strategy registry`,
    build: async () => ({ address: publication.to, abi: REGISTRY_ABI, functionName: "publish", args: publicationArgs(publication), reviewed: { data: publication.data, from: publication.from } }),
  };
}

/**
 * The public strategy registry on X Layer testnet (docs/STRATEGY_REGISTRY.md), as far as it can be decided without a
 * chain read: the reviewed pin, the two switches, the page grid of a scan, and the address of one publication.
 * Pure (one hash function from viem), so it runs in node tests. Nothing here validates a strategy or a publication: that is the
 * SDK's job (packages/strategy-sdk/registry.ts), called from src/services/chain/registry.ts.
 *
 * Rules this module encodes:
 *   - The pin (address, runtime code hash, deployment block, confirmations) comes from the reviewed file in
 *     packages/chain-config and from nowhere else. No strategy, publication or URL can supply or change it.
 *   - A scan reads fixed pages of 100 blocks counted from the deployment block, through head − confirmations. What
 *     was not read (page budget) and what could not be read (the RPC refused) are two different, stated things.
 *   - Publishing gives the publisher nothing. A publication is text: the adopter chooses the operator and signs.
 */
import { keccak256, stringToHex } from "viem";
import { type Maybe, ok, unavailable } from "./maybe.ts";

type Hex = `0x${string}`;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const zero = (value: string) => /^0x0+$/.test(value);

/* ---------- switches ---------- */

/**
 * The committed switches. Discovery and adoption of published strategies, and publishing from this app. An
 * environment variable can only turn them OFF (NEXT_PUBLIC_PERIDOT_REGISTRY=off); nothing can force them on.
 */
const DISCOVERY_COMMITTED = true;
const PUBLISH_COMMITTED = true;
export function registrySwitches(override: string | undefined): { discover: boolean; publish: boolean } {
  const off = override === "off";
  return { discover: DISCOVERY_COMMITTED && !off, publish: DISCOVERY_COMMITTED && PUBLISH_COMMITTED && !off };
}
export const REGISTRY_SWITCHES = registrySwitches(process.env.NEXT_PUBLIC_PERIDOT_REGISTRY);

/* ---------- the reviewed pin ---------- */

export interface RegistryPinFile {
  chainId: 1952;
  address: Hex;
  runtimeCodeHash: Hex;
  deploymentBlock: bigint;
  confirmations: number;
  /** Shown as provenance only. */
  deploymentTxHash: Hex | null;
}

/** The registry pin of X Layer testnet, or why this build has none. Fewer than 12 confirmations is refused. */
export function parseRegistryPin(json: unknown): Maybe<RegistryPinFile> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return unavailable("This build has no strategy registry pin");
  const pin = json as Record<string, unknown>;
  if (pin.chainId !== 1952) return unavailable("The strategy registry pin is not for X Layer testnet (1952)");
  if (typeof pin.address !== "string" || !ADDRESS.test(pin.address) || zero(pin.address)) return unavailable("The strategy registry pin has no valid address");
  if (typeof pin.runtimeCodeHash !== "string" || !HASH.test(pin.runtimeCodeHash) || zero(pin.runtimeCodeHash)) return unavailable("The strategy registry pin has no runtime code hash");
  if (typeof pin.deploymentBlock !== "string" || !/^[1-9]\d{0,17}$/.test(pin.deploymentBlock)) return unavailable("The strategy registry pin has no deployment block");
  if (typeof pin.confirmations !== "number" || !Number.isSafeInteger(pin.confirmations) || pin.confirmations < 12 || pin.confirmations > 10_000) return unavailable("The strategy registry pin does not require at least 12 confirmations");
  return ok({
    chainId: 1952,
    address: pin.address as Hex,
    runtimeCodeHash: pin.runtimeCodeHash as Hex,
    deploymentBlock: BigInt(pin.deploymentBlock),
    confirmations: pin.confirmations,
    deploymentTxHash: typeof pin.deploymentTxHash === "string" && HASH.test(pin.deploymentTxHash) ? (pin.deploymentTxHash as Hex) : null,
  });
}

/* ---------- the page grid of a scan ---------- */

/** The SDK reads at most 100 blocks per page. The grid is fixed to the deployment block, so a page read once stays valid. */
export const REGISTRY_PAGE_BLOCKS = 100n;

export interface BlockSpan {
  from: bigint;
  to: bigint;
}

/** Number of pages from the deployment block through `confirmed` (the last one may be shorter). Zero: nothing is confirmed yet. */
export function pageCount(deploymentBlock: bigint, confirmed: bigint): number {
  if (confirmed < deploymentBlock) return 0;
  return Number((confirmed - deploymentBlock) / REGISTRY_PAGE_BLOCKS) + 1;
}

export function pageSpan(deploymentBlock: bigint, confirmed: bigint, index: number): BlockSpan {
  const from = deploymentBlock + REGISTRY_PAGE_BLOCKS * BigInt(index);
  const end = from + REGISTRY_PAGE_BLOCKS - 1n;
  return { from, to: end > confirmed ? confirmed : end };
}

/**
 * Which pages a scan reads: the first `early` pages (where a registry's first publications are) and the last `head`
 * pages (what was published just now). Everything when the two ends meet. Ascending, no duplicates.
 */
export function selectPages(total: number, early: number, head: number): number[] {
  const first = Math.max(0, Math.min(total, Math.floor(early)));
  const last = Math.max(0, Math.min(total, Math.floor(head)));
  const picked: number[] = [];
  for (let index = 0; index < total; index++) if (index < first || index >= total - last) picked.push(index);
  return picked;
}

export type CoverageStatus = "read" | "not-read" | "unavailable";
export interface CoverageRange extends BlockSpan {
  status: CoverageStatus;
  /** Why the RPC did not serve it (status "unavailable" only). */
  reason: string | null;
  pages: number;
}

/**
 * Every block from the deployment block through `confirmed`, as consecutive ranges: read, not read (outside this
 * scan's page budget) or unavailable (the RPC refused or failed; the reason is kept). Adjacent ranges of the same
 * status and reason are merged, so the result is what a reader is told.
 */
export function coverageRanges(deploymentBlock: bigint, confirmed: bigint, outcome: ReadonlyMap<number, { ok: true } | { ok: false; reason: string }>): CoverageRange[] {
  const ranges: CoverageRange[] = [];
  const total = pageCount(deploymentBlock, confirmed);
  for (let index = 0; index < total; index++) {
    const result = outcome.get(index);
    const status: CoverageStatus = !result ? "not-read" : result.ok ? "read" : "unavailable";
    const reason = result && !result.ok ? result.reason : null;
    const span = pageSpan(deploymentBlock, confirmed, index);
    const previous = ranges.at(-1);
    if (previous && previous.status === status && previous.reason === reason) {
      previous.to = span.to;
      previous.pages += 1;
    } else ranges.push({ ...span, status, reason, pages: 1 });
  }
  return ranges;
}

export const blocksIn = (span: BlockSpan): bigint => span.to - span.from + 1n;

/* ---------- one publication, addressed ---------- */

export interface PublicationKey {
  creator: Hex;
  seriesId: Hex;
  version: number;
  /** The block its `StrategyPublished` event is in. The adoption page re-reads that block, event included. */
  block: bigint;
}

/**
 * `?published=<creator>:<seriesId>:<version>&at=<block>` from Discover. Anything that is not exactly an address, a
 * 32-byte series id, a version and a block number is ignored. The key only says WHERE to read: what is shown and
 * offered comes from the registry itself.
 */
export function parsePublicationKey(published: string | null, at: string | null): PublicationKey | null {
  if (!published || !at || !/^[1-9]\d{0,17}$/.test(at)) return null;
  const parts = published.split(":");
  if (parts.length !== 3) return null;
  const [creator, seriesId, version] = parts as [string, string, string];
  if (!ADDRESS.test(creator) || zero(creator) || !HASH.test(seriesId) || zero(seriesId) || !/^[1-9]\d{0,9}$/.test(version) || Number(version) > 0xffffffff) return null;
  return { creator: creator as Hex, seriesId: seriesId as Hex, version: Number(version), block: BigInt(at) };
}

export const publicationHref = (key: PublicationKey): string => `/strategies?published=${key.creator}:${key.seriesId}:${key.version}&at=${key.block.toString()}#create`;

export const samePublication = (a: { creator: string; seriesId: string; version: number }, b: { creator: string; seriesId: string; version: number }): boolean =>
  a.creator.toLowerCase() === b.creator.toLowerCase() && a.seriesId.toLowerCase() === b.seriesId.toLowerCase() && a.version === b.version;

/* ---------- why a publication was rejected, in this app's words ---------- */

/**
 * The SDK rejects a publication with one of five fixed sentences. Each is shown as written, next to what it means for
 * a reader. Text of a rejected publication is never shown: it did not pass, so nothing in it is known to be a strategy.
 */
const REJECTION_MEANING: Record<string, string> = {
  "Invalid published byte length or encoding": "The stored bytes are empty, too long or not readable.",
  "Registered content hash mismatch": "The stored bytes do not match the hash the registry recorded for them.",
  "Published content failed UTF-8 or peridot.strategy/v1 validation": "The content is not a valid strategy for this deployment: wrong format, network, contracts or limits, or a field a strategy may not have.",
  "Published JSON is not canonical": "The content is not in the one exact encoding a strategy must be published in, so its hash does not identify a strategy.",
  "Publication topics differ from validated strategy": "Its index labels (network, adapter version or policy) do not match its own content.",
};
export const rejectionMeaning = (reason: string): string => REJECTION_MEANING[reason] ?? "It did not pass the registry checks.";
export const REJECTION_SENTENCES = Object.keys(REJECTION_MEANING);

/* ---------- publishing: the series a creator publishes under ---------- */

/**
 * A creator numbers the versions of one strategy under a series id of their own choosing (any non-zero 32 bytes).
 * This app derives it from a short name the creator types: keccak256 of its UTF-8 bytes. Lower-case letters, digits
 * and single hyphens, 1 to 32 characters. The name itself is not stored anywhere; the id is.
 */
export const SERIES_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function seriesIdFromName(name: string): Hex | null {
  if (name.length < 1 || name.length > 32 || !SERIES_NAME.test(name)) return null;
  return keccak256(stringToHex(name));
}

/**
 * Merging the indexed activity snapshot into the live activity list. Pure and dependency-free.
 *
 * Two sources describe the same chain: this page's own paged scan (recent blocks and the first blocks after the
 * deployment) and the contracts team's indexed snapshot (one inclusive block range, shipped with the build). They are
 * merged into ONE list, de-duplicated by transaction hash and log index, and every row keeps where it came from.
 *
 * The coverage statement is the union of what was really read:
 *   - the scan's own ranges, always;
 *   - the snapshot's range, but ONLY when its last block was re-read from the chain and matches (canonical), and only
 *     when the snapshot indexes every contract the list is about. A contract it does not index counts as covered
 *     only if it is shown not to have existed at the snapshot's last block.
 * Whatever is covered by neither is a gap, and the caller must say so.
 */
export interface BlockRange {
  from: bigint;
  to: bigint;
}
export interface SnapshotEventLike {
  blockNumber: bigint;
  transactionHash: string;
  logIndex: bigint;
  address: string;
  eventName: string;
  args: Record<string, unknown>;
  timestamp: bigint | null;
}
export interface SnapshotLike {
  fromBlock: bigint;
  toBlock: bigint;
  sources: Array<{ address: string; fromBlock: bigint }>;
  events: SnapshotEventLike[];
}

export const activityKey = (transactionHash: string, logIndex: bigint | number): string => `${transactionHash.toLowerCase()}-${logIndex.toString()}`;
const lower = (list: readonly string[]) => new Set(list.map((entry) => entry.toLowerCase()));
const uintArg = (value: unknown): bigint | null => (typeof value === "string" && /^\d{1,78}$/.test(value) ? BigInt(value) : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null);

export interface SnapshotPolicyAllowed {
  kind: "PolicyAllowed";
  key: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: bigint;
  address: `0x${string}`;
  timestamp: bigint | null;
  account: `0x${string}`;
  op: number;
  postLtvBps: bigint;
  oracleFresh: boolean;
}
export interface SnapshotAutoRepay {
  kind: "AutoRepayExecuted";
  key: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: bigint;
  address: `0x${string}`;
  timestamp: bigint | null;
  amount: bigint;
  ltvBeforeBps: bigint;
  ltvAfterBps: bigint;
}

/**
 * The snapshot's events that the live list would also show, with the SAME filter as the scan: PolicyAllowed emitted
 * by one of `controllers` or `sentinels` for one of `holders`, and AutoRepayExecuted emitted by one of `sentinels`.
 * An event of the right name with arguments in an unexpected shape is skipped and counted, never guessed at.
 */
export function snapshotActivity(snapshot: SnapshotLike, scope: { controllers: readonly string[]; sentinels: readonly string[]; holders: readonly string[] }): { events: Array<SnapshotPolicyAllowed | SnapshotAutoRepay>; skipped: number } {
  const controllers = lower(scope.controllers);
  const sentinels = lower(scope.sentinels);
  const holders = lower(scope.holders);
  const events: Array<SnapshotPolicyAllowed | SnapshotAutoRepay> = [];
  let skipped = 0;
  for (const event of snapshot.events) {
    const emitter = event.address.toLowerCase();
    const base = { key: activityKey(event.transactionHash, event.logIndex), transactionHash: event.transactionHash as `0x${string}`, blockNumber: event.blockNumber, logIndex: event.logIndex, address: event.address as `0x${string}`, timestamp: event.timestamp };
    if (event.eventName === "PolicyAllowed" && (controllers.has(emitter) || sentinels.has(emitter))) {
      const account = typeof event.args.account === "string" && /^0x[0-9a-fA-F]{40}$/.test(event.args.account) ? event.args.account : null;
      const op = uintArg(event.args.op);
      const postLtvBps = uintArg(event.args.postLtvBps);
      if (!account || op === null || op > 255n || postLtvBps === null || typeof event.args.oracleFresh !== "boolean") {
        skipped++;
        continue;
      }
      if (!holders.has(account.toLowerCase())) continue;
      events.push({ ...base, kind: "PolicyAllowed", account: account as `0x${string}`, op: Number(op), postLtvBps, oracleFresh: event.args.oracleFresh });
    } else if (event.eventName === "AutoRepayExecuted" && sentinels.has(emitter)) {
      const amount = uintArg(event.args.amount);
      const before = uintArg(event.args.ltvBeforeBps);
      const after = uintArg(event.args.ltvAfterBps);
      if (amount === null || before === null || after === null) {
        skipped++;
        continue;
      }
      events.push({ ...base, kind: "AutoRepayExecuted", amount, ltvBeforeBps: before, ltvAfterBps: after });
    }
  }
  return { events, skipped };
}

/** Sorted, non-overlapping ranges. Adjacent ranges (b.from === a.to + 1) are joined. */
export function mergeRanges(ranges: readonly BlockRange[]): BlockRange[] {
  const sorted = ranges.filter((range) => range.to >= range.from).map((range) => ({ ...range })).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: BlockRange[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range.from <= last.to + 1n) last.to = range.to > last.to ? range.to : last.to;
    else out.push(range);
  }
  return out;
}

/** Blocks inside [from, to] that none of the ranges cover, as ranges. */
export function uncoveredRanges(ranges: readonly BlockRange[], from: bigint, to: bigint): BlockRange[] {
  const gaps: BlockRange[] = [];
  let cursor = from;
  for (const range of mergeRanges(ranges)) {
    if (range.to < cursor) continue;
    if (range.from > to) break;
    if (range.from > cursor) gaps.push({ from: cursor, to: range.from - 1n });
    cursor = range.to + 1n;
  }
  if (cursor <= to) gaps.push({ from: cursor, to });
  return gaps;
}

/** Contracts the list is about that the snapshot does not index. Each needs a proof of absence before its range counts. */
export function unindexedEmitters(snapshot: SnapshotLike, emitters: readonly string[]): string[] {
  const indexed = lower(snapshot.sources.map((source) => source.address));
  return [...new Set(emitters.map((entry) => entry.toLowerCase()))].filter((emitter) => !indexed.has(emitter));
}

export type SnapshotMergeState =
  /** Its range counts as read and its events are in the list. */
  | "merged"
  /** Its last block is not the canonical block at that height: nothing of it is used. */
  | "not-canonical"
  /** Its last block could not be re-read: nothing of it is used. */
  | "unverified"
  /** Canonical, events are in the list, but it does not index every contract of this list: its range is NOT counted. */
  | "events-only";

export interface MergedCoverage {
  ranges: BlockRange[];
  /** Every block from the deployment block to the head is covered by a source that was really read. */
  complete: boolean;
  gaps: BlockRange[];
  unreadBlocks: bigint;
}

/**
 * The union of the scan's ranges and, when `snapshotRange` is given, the snapshot's range. Pass the snapshot range
 * only for state "merged".
 */
export function mergedCoverage(scanRanges: readonly BlockRange[], snapshotRange: BlockRange | null, deploymentBlock: bigint, head: bigint): MergedCoverage {
  const ranges = mergeRanges(snapshotRange ? [...scanRanges, snapshotRange] : scanRanges);
  const gaps = uncoveredRanges(ranges, deploymentBlock, head);
  return { ranges, complete: gaps.length === 0, gaps, unreadBlocks: gaps.reduce((sum, gap) => sum + (gap.to - gap.from + 1n), 0n) };
}

/**
 * Paged eth_getLogs. Public RPCs cap the block range of one log query (both official X Layer testnet RPCs
 * answered "block range greater than 100 max" on 2026-11-25), so nothing in the app may ask for an open range.
 * Dependency-free so it runs in node tests.
 */
export interface LogPageOptions {
  /** Blocks per request (inclusive range). Halved when the RPC refuses a page, never below `minPageBlocks`. */
  pageBlocks: bigint;
  minPageBlocks?: bigint;
  /** Pages fetched at the same time. */
  concurrency?: number;
}

export type PageFetcher<T> = (fromBlock: bigint, toBlock: bigint) => Promise<T[]>;

/** Every log in [from, to], oldest first. A page the RPC refuses is retried with half the span before giving up. */
export async function fetchLogPages<T>(fetchPage: PageFetcher<T>, from: bigint, to: bigint, options: LogPageOptions): Promise<T[]> {
  if (to < from) return [];
  const min = options.minPageBlocks ?? 1n;
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let span = options.pageBlocks < min ? min : options.pageBlocks;
  const out: T[] = [];
  let cursor = from;
  while (cursor <= to) {
    const ranges: Array<[bigint, bigint]> = [];
    for (let start = cursor; start <= to && ranges.length < concurrency; start += span) ranges.push([start, start + span - 1n > to ? to : start + span - 1n]);
    try {
      const pages = await Promise.all(ranges.map(([start, end]) => fetchPage(start, end)));
      for (const page of pages) out.push(...page);
      cursor = ranges.at(-1)![1] + 1n;
    } catch (error) {
      if (span <= min) throw error;
      span = span / 2n < min ? min : span / 2n;
    }
  }
  return out;
}

/**
 * The block window a first scan covers: at most `maxPages` pages back from `latest`, never before `deploymentBlock`.
 * `complete` is false when history before `from` was not scanned; the UI must say so.
 */
export function scanWindow(deploymentBlock: bigint, latest: bigint, pageBlocks: bigint, maxPages: number): { from: bigint; to: bigint; complete: boolean } {
  const reach = pageBlocks * BigInt(Math.max(1, maxPages));
  const earliest = latest + 1n > reach ? latest + 1n - reach : 0n;
  const from = earliest > deploymentBlock ? earliest : deploymentBlock;
  return { from, to: latest, complete: from <= deploymentBlock };
}

export interface BlockRange {
  from: bigint;
  to: bigint;
}

/**
 * What a first scan reads when the whole history is too long to page through (X Layer testnet: 100 blocks per
 * query, about one block per second, so a day of history is roughly 860 requests per event filter).
 * Two ends are read and the gap between them is reported, never hidden:
 *   - the first `earlyPages` pages from the deployment block (the deployment's own events and first demo activity);
 *   - the last `headPages` pages up to the head (what the viewer just did).
 * `complete` is true only when the two ends meet, so every block from the deployment block to the head was read.
 */
export function scanPlan(deploymentBlock: bigint, latest: bigint, pageBlocks: bigint, headPages: number, earlyPages: number): { ranges: BlockRange[]; complete: boolean } {
  const head = scanWindow(deploymentBlock, latest, pageBlocks, headPages);
  if (head.complete) return { ranges: [{ from: head.from, to: head.to }], complete: true };
  if (earlyPages <= 0) return { ranges: [{ from: head.from, to: head.to }], complete: false };
  const earlyTo = deploymentBlock + pageBlocks * BigInt(earlyPages) - 1n;
  if (earlyTo + 1n >= head.from) return { ranges: [{ from: deploymentBlock, to: head.to }], complete: true };
  return { ranges: [{ from: deploymentBlock, to: earlyTo }, { from: head.from, to: head.to }], complete: false };
}

/** Blocks between the scanned ranges, i.e. what a reader must be told was NOT read. */
export function unscannedBlocks(ranges: BlockRange[]): bigint {
  let gap = 0n;
  for (let index = 1; index < ranges.length; index++) gap += ranges[index]!.from - ranges[index - 1]!.to - 1n;
  return gap;
}

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

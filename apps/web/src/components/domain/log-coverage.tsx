import { LOG_PAGE_BLOCKS } from "@/lib/chains";
import { unscannedBlocks } from "@/lib/log-pages";
import type { LogCoverage } from "@/services/types";

const group = (value: bigint) => value.toLocaleString("en-US");

/** One short clause for inline use, e.g. "blocks 47,161,508–47,162,507 and 47,237,461–47,241,460". */
export function coverageRanges(coverage: LogCoverage): string {
  return `blocks ${coverage.ranges.map((range) => `${group(range.from)}–${group(range.to)}`).join(" and ")}`;
}

/**
 * Says exactly which blocks the on-chain events were read from, and how many in between were not read.
 * Rendered only when the scan is incomplete: a complete scan needs no caveat.
 */
export function LogCoverageText({ coverage }: { coverage: LogCoverage }) {
  const gap = unscannedBlocks(coverage.ranges);
  const first = coverage.ranges[0]!;
  const last = coverage.ranges.at(-1)!;
  return (
    <span data-ranges={coverage.ranges.length} data-gap={gap.toString()}>
      {coverage.ranges.length > 1 ? (
        <>
          On-chain events are read from the deployment block <span className="num text-fg">{group(first.from)}</span> to <span className="num text-fg">{group(first.to)}</span>, and from <span className="num text-fg">{group(last.from)}</span> to the latest block <span className="num text-fg">{group(last.to)}</span>. The <span className="num text-fg">{group(gap)}</span> blocks in between have not been read
        </>
      ) : (
        <>
          On-chain events are read from block <span className="num text-fg">{group(first.from)}</span> to <span className="num text-fg">{group(last.to)}</span>. Earlier history has not been read
        </>
      )}
      : the network&apos;s public RPC only answers event queries {LOG_PAGE_BLOCKS.toString()} blocks at a time, and this app has no indexer.
    </span>
  );
}

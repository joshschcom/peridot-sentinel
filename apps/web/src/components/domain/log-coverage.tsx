import { LOG_PAGE_BLOCKS } from "@/lib/chains";
import { unscannedBlocks } from "@/lib/log-pages";
import type { ActivityFeed, LogCoverage } from "@/services/types";

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

const rangeList = (ranges: Array<{ from: bigint; to: bigint }>) => ranges.map((range) => `${group(range.from)} to ${group(range.to)}`).join(" and ");

/**
 * Coverage of the activity list when the indexed snapshot is in play: which blocks each source covers, whether the
 * snapshot was verified against the chain, and exactly which blocks NEITHER source covers. Also rendered when the
 * union is complete, because a reader should know that part of the list comes from a shipped file.
 */
export function MergedCoverageText({ feed }: { feed: ActivityFeed }) {
  const { coverage, snapshot, scanRanges = [], gaps = [], head } = feed;
  if (!coverage || !snapshot) return null;
  const unread = gaps.reduce((sum, gap) => sum + (gap.to - gap.from + 1n), 0n);
  const first = coverage.ranges[0];
  const snapshotRange = `${group(snapshot.fromBlock)} to ${group(snapshot.toBlock)}`;
  const refreshed = snapshot.updatedAt.slice(0, 16).replace("T", " ");
  return (
    <span data-ranges={coverage.ranges.length} data-gap={unread.toString()} data-snapshot={snapshot.state} data-snapshot-added={snapshot.added} data-snapshot-shared={snapshot.shared} data-snapshot-to={snapshot.toBlock.toString()}>
      {snapshot.state === "merged" ? (
        <>
          This list is merged from two sources. The indexed snapshot shipped with this build covers blocks <span className="num text-fg">{snapshotRange}</span> (refreshed {refreshed} UTC); its last block was re-read from the chain for this page and matches. This page&apos;s own scan read blocks <span className="num text-fg">{rangeList(scanRanges)}</span>
          {head !== undefined ? <>, up to the latest block <span className="num text-fg">{group(head)}</span></> : null}. {snapshot.added} of the entries above come from the snapshot only{snapshot.shared > 0 ? `, and ${snapshot.shared} were found by both and are shown once` : ""}.{" "}
        </>
      ) : snapshot.state === "events-only" ? (
        <>
          Entries from the indexed snapshot (blocks <span className="num text-fg">{snapshotRange}</span>, last block verified against the chain) are included: {snapshot.added} come from it only. The snapshot does not index {snapshot.unindexed} of the contracts this list reads, so its range is not counted as read below. This page&apos;s own scan read blocks <span className="num text-fg">{rangeList(scanRanges)}</span>.{" "}
        </>
      ) : (
        <>
          The indexed snapshot shipped with this build (blocks <span className="num text-fg">{snapshotRange}</span>) is not used in this list: {snapshot.state === "not-canonical" ? "its last block is not the block the chain has at that height" : "its last block could not be re-read from the chain just now"}. Only this page&apos;s own scan is shown, which read blocks <span className="num text-fg">{rangeList(scanRanges)}</span>.{" "}
        </>
      )}
      {coverage.complete ? (
        <>Together they cover every block from the deployment block{first ? <> <span className="num text-fg">{group(first.from)}</span></> : null} to the latest block.</>
      ) : (
        <>
          Counted from the deployment block{first ? <> <span className="num text-fg">{group(first.from)}</span></> : null}, the <span className="num text-fg">{group(unread)}</span> blocks <span className="num text-fg">{rangeList(gaps)}</span> have not been read by {snapshot.state === "merged" ? "either source" : "this page"}: an action in them is not shown here{snapshot.state === "merged" ? " until the snapshot is refreshed" : ""}. The network&apos;s public RPC only answers event queries {LOG_PAGE_BLOCKS.toString()} blocks at a time, and this app has no indexer of its own.
        </>
      )}
    </span>
  );
}

/**
 * Coverage of an activity snapshot (shared or judge), schema version 1 with the additive recovery fields of
 * MILESTONE_LOG M10-activity-recovery. Pure. The contract is the contracts team's `activityCoverageView`
 * (packages/chain-config/src/activity-coverage.ts, re-exported by @peridot/chain-config after its build); this module only reduces its answer to
 * bigints for the pages, after handing it the ORIGINAL coverage object.
 *
 * What the pages must hold to:
 *   - a snapshot is one or more CHECKED SEGMENTS. The outer envelope (first block to last block) is never shown as
 *     one checked range when there is more than one segment;
 *   - every gap is shown with its reason and its exact range. `history-unavailable` is permanent: the RPC no longer
 *     served those blocks when the snapshot was refreshed, so events in them are missing for good;
 *   - a segment with `sourceCoverage: "known-emitters"` only speaks for the contracts that were indexed: contracts a
 *     factory created during the preceding gap may be missing;
 *   - events stay previously verified evidence, with their original hashes, whatever the checkpoint says. Only a
 *     checkpoint that MATCHES lets the last segment join a live scan; a conflict withholds the merge.
 */
import { type ActivityCoverage, activityCoverageView } from "@peridot/chain-config";

type Hex = `0x${string}`;
export interface CoverageSegment {
  from: bigint;
  to: bigint;
  toBlockHash: Hex;
  /** Present on a segment that re-anchors after a history gap. */
  fromBlockHash: Hex | null;
  sourceCoverage: "configured" | "known-emitters";
}
export interface CoverageGap {
  from: bigint;
  to: bigint;
  reason: string;
  /** `history-unavailable`: inside the recorded coverage, and never going to be filled. */
  permanent: boolean;
}
export interface ParsedCoverage {
  /** The object exactly as the file has it; the only thing ever passed to the contracts team's helper. */
  raw: ActivityCoverage;
  segments: CoverageSegment[];
  gaps: CoverageGap[];
}
export type Checkpoint = "matches" | "unavailable" | "conflict";

/** Null when the coverage is malformed or contradicts itself (the helper's own rules decide, not this module). */
export function parseCoverage(value: unknown): ParsedCoverage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<ActivityCoverage>;
  if (typeof candidate.fromBlock !== "string" || typeof candidate.toBlock !== "string" || typeof candidate.toBlockHash !== "string" || !Array.isArray(candidate.gaps) || (candidate.segments !== undefined && !Array.isArray(candidate.segments))) return null;
  if (!candidate.gaps.every((gap) => typeof gap === "object" && gap !== null && typeof gap.fromBlock === "string" && typeof gap.toBlock === "string" && typeof gap.reason === "string")) return null;
  try {
    const raw = candidate as ActivityCoverage;
    const view = activityCoverageView(raw, null);
    return {
      raw,
      segments: view.historicalSegments.map((segment) => ({ from: BigInt(segment.fromBlock), to: BigInt(segment.toBlock), toBlockHash: segment.toBlockHash as Hex, fromBlockHash: (segment.fromBlockHash as Hex | undefined) ?? null, sourceCoverage: segment.sourceCoverage })),
      gaps: view.gaps.map((gap) => ({ from: BigInt(gap.fromBlock), to: BigInt(gap.toBlock), reason: gap.reason, permanent: gap.reason === "history-unavailable" })),
    };
  } catch {
    return null;
  }
}

/** Is this block inside a checked segment? An event outside every segment contradicts the coverage. */
export const inCheckedSegment = (coverage: ParsedCoverage, block: bigint): boolean => coverage.segments.some((segment) => block >= segment.from && block <= segment.to);

/**
 * `observedTerminalHash`: the hash the chain reports at the coverage's last block, or null when it could not be read.
 * Only "matches" returns a segment that may join a live scan, and it is the LAST segment alone.
 */
export function coverageCheckpoint(coverage: ParsedCoverage, observedTerminalHash: string | null): { checkpoint: Checkpoint; mergeableTail: CoverageSegment | null } {
  const view = activityCoverageView(coverage.raw, observedTerminalHash);
  return { checkpoint: view.checkpoint, mergeableTail: view.mergeableTail ? coverage.segments.at(-1)! : null };
}

/** Segments before the last one: previously verified, and not re-checked by a terminal read. */
export const earlierSegments = (coverage: ParsedCoverage): CoverageSegment[] => coverage.segments.slice(0, -1);

export function gapReasonText(reason: string, confirmations: number | null = null): string {
  if (reason === "history-unavailable") return "history unavailable: the RPC no longer served these blocks when the snapshot was refreshed, so events in them are permanently missing from it";
  if (reason === "confirmation-depth") return `inside the confirmation depth${confirmations !== null ? ` of ${confirmations} blocks` : ""} when it was refreshed`;
  return /^[a-z][a-z0-9-]{0,40}$/.test(reason) ? reason.replace(/-/g, " ") : "unspecified reason";
}
export const SEGMENT_SOURCE_TEXT: Record<CoverageSegment["sourceCoverage"], string> = {
  configured: "every configured contract",
  "known-emitters": "known emitters only: contracts a factory created during the preceding gap may be missing",
};

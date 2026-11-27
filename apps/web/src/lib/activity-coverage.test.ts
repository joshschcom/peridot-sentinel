import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RAW_CONFIG } from "../generated/config.ts";
import { coverageCheckpoint, earlierSegments, gapReasonText, inCheckedSegment, parseCoverage } from "./activity-coverage.ts";
import { parseActivitySnapshot } from "./expansion.ts";
import { mergedCoverage } from "./activity-merge.ts";

// Synthetic fixtures of the contracts team (evidence/session9-activity). They are read here only: never a build input.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../evidence/session9-activity/${name}.json`, import.meta.url), "utf8")) as { coverage: Record<string, unknown>; events: Array<Record<string, unknown>> };
const shared = fixture("pruned-shared");
const judge = fixture("pruned-judge");

test("the committed shared snapshot is the legacy shape: one configured segment, no permanent gap", () => {
  const coverage = parseCoverage((RAW_CONFIG.activity.byChain["1952"] as { coverage: unknown }).coverage);
  assert.ok(coverage);
  assert.equal(coverage.segments.length, 1);
  assert.equal(coverage.segments[0]!.sourceCoverage, "configured");
  assert.equal(coverage.gaps.filter((gap) => gap.permanent).length, 0);
  assert.deepEqual(earlierSegments(coverage), []);
  const parsed = parseActivitySnapshot(RAW_CONFIG.activity.byChain["1952"], "activity/1952.json");
  assert.equal(parsed.status, "ok");
});

test("a pruned snapshot is two checked segments and a permanent gap, never one envelope", () => {
  for (const [file, tailSource] of [[shared, "known-emitters"], [judge, "configured"]] as const) {
    const coverage = parseCoverage(file.coverage);
    assert.ok(coverage);
    assert.deepEqual(coverage.segments.map((segment) => [segment.from, segment.to, segment.sourceCoverage]), [[100n, 101n, "configured"], [120n, 120n, tailSource]]);
    assert.deepEqual(coverage.gaps.map((gap) => [gap.from, gap.to, gap.reason, gap.permanent]), [[102n, 119n, "history-unavailable", true], [121n, 132n, "confirmation-depth", false]]);
    assert.equal(inCheckedSegment(coverage, 101n), true);
    assert.equal(inCheckedSegment(coverage, 110n), false, "a block of the history gap is not covered although it lies inside the envelope");
    assert.deepEqual(earlierSegments(coverage).map((segment) => segment.to), [101n]);
  }
});

test("only a matching checkpoint lets the LAST segment join a live scan; unavailable and conflict withhold it", () => {
  const coverage = parseCoverage(shared.coverage)!;
  const terminal = shared.coverage.toBlockHash as string;
  const match = coverageCheckpoint(coverage, terminal.toUpperCase().replace("0X", "0x"));
  assert.equal(match.checkpoint, "matches");
  assert.deepEqual([match.mergeableTail!.from, match.mergeableTail!.to, match.mergeableTail!.sourceCoverage], [120n, 120n, "known-emitters"]);
  assert.deepEqual(coverageCheckpoint(coverage, null), { checkpoint: "unavailable", mergeableTail: null });
  assert.deepEqual(coverageCheckpoint(coverage, `0x${"ab".repeat(32)}`), { checkpoint: "conflict", mergeableTail: null });
  // With the tail merged, the history gap is still reported as unread: the envelope 100..120 is never counted.
  const merged = mergedCoverage([{ from: 121n, to: 140n }], { from: match.mergeableTail!.from, to: match.mergeableTail!.to }, 100n, 140n);
  assert.deepEqual(merged.gaps, [{ from: 100n, to: 119n }]);
  assert.equal(merged.complete, false);
});

test("the shared parser keeps the events of every segment with their original hashes, and refuses an event inside a gap", () => {
  const file = { ...shared, chainId: 1952 } as Record<string, unknown>;
  const parsed = parseActivitySnapshot(file, "pruned-shared.json");
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.deepEqual(parsed.value.events.map((event) => event.transactionHash), shared.events.map((event) => event.transactionHash));
  assert.equal(parsed.value.coverage.segments.length, 2);
  const inGap = { ...file, events: [{ ...shared.events[0], blockNumber: "110" }] };
  assert.equal(parseActivitySnapshot(inGap, "x.json").status, "unavailable");
});

test("contradictory coverage is refused: segments without their gap, a missing anchor, an unknown reason inside the range", () => {
  const base = shared.coverage as { segments: Array<Record<string, unknown>>; gaps: Array<Record<string, unknown>> };
  assert.equal(parseCoverage({ ...base, gaps: base.gaps.slice(1) }), null);
  assert.equal(parseCoverage({ ...base, segments: [base.segments[0], { ...base.segments[1], fromBlockHash: undefined }] }), null);
  assert.equal(parseCoverage({ ...base, gaps: [{ ...base.gaps[0], reason: "skipped" }, base.gaps[1]] }), null);
  assert.equal(parseCoverage({ ...base, toBlock: "119" }), null);
  assert.equal(parseCoverage(null), null);
});

test("gap reasons are worded by this app; an unknown reason is never echoed raw", () => {
  assert.match(gapReasonText("history-unavailable"), /permanently missing/);
  assert.match(gapReasonText("confirmation-depth", 12), /confirmation depth of 12 blocks/);
  assert.equal(gapReasonText("<script>"), "unspecified reason");
});

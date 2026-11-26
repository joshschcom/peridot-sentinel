import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLogPages, scanPlan, scanWindow, unscannedBlocks } from "./log-pages.ts";

const logsAt = [3n, 99n, 100n, 101n, 250n, 1000n];
const source = (limit: bigint, calls: Array<[bigint, bigint]>) => async (from: bigint, to: bigint) => {
  calls.push([from, to]);
  if (to - from + 1n > limit) throw new Error("block range greater than 100 max");
  return logsAt.filter((block) => block >= from && block <= to);
};

test("paged result equals the unpaged result, in order, with no gaps or overlaps", async () => {
  for (const pageBlocks of [1n, 7n, 100n, 5000n]) {
    for (const concurrency of [1, 4]) {
      const calls: Array<[bigint, bigint]> = [];
      const logs = await fetchLogPages(source(10_000n, calls), 0n, 1000n, { pageBlocks, concurrency });
      assert.deepEqual(logs, logsAt);
      const sorted = [...calls].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      assert.equal(sorted[0]![0], 0n);
      assert.equal(sorted.at(-1)![1], 1000n);
      for (let index = 1; index < sorted.length; index++) assert.equal(sorted[index]![0], sorted[index - 1]![1] + 1n);
    }
  }
});

test("a refused range is halved until the RPC accepts it, and no request ever exceeds the accepted span afterwards", async () => {
  const calls: Array<[bigint, bigint]> = [];
  const logs = await fetchLogPages(source(100n, calls), 0n, 1000n, { pageBlocks: 5000n });
  assert.deepEqual(logs, logsAt);
  const accepted = calls.filter(([from, to]) => to - from + 1n <= 100n);
  assert.ok(accepted.length >= 11);
  assert.ok(calls.length - accepted.length <= 6, "only the first few probes may be refused");
});

test("gives up with the RPC's error once the minimum span is refused", async () => {
  await assert.rejects(fetchLogPages(async () => { throw new Error("rate limited"); }, 0n, 10n, { pageBlocks: 4n }), /rate limited/);
});

test("an empty range asks nothing", async () => {
  const calls: Array<[bigint, bigint]> = [];
  assert.deepEqual(await fetchLogPages(source(100n, calls), 5n, 4n, { pageBlocks: 100n }), []);
  assert.equal(calls.length, 0);
});

test("scan window never starts before the deployment block and reports incomplete history", () => {
  assert.deepEqual(scanWindow(1n, 68n, 5000n, 40), { from: 1n, to: 68n, complete: true });
  assert.deepEqual(scanWindow(47_000_000n, 47_160_000n, 100n, 40), { from: 47_156_001n, to: 47_160_000n, complete: false });
  assert.deepEqual(scanWindow(47_159_000n, 47_160_000n, 100n, 40), { from: 47_159_000n, to: 47_160_000n, complete: true });
});

test("scan plan reads both ends of a long history and reports the gap between them", () => {
  // Short history: one range, complete.
  assert.deepEqual(scanPlan(1n, 68n, 5000n, 40, 10), { ranges: [{ from: 1n, to: 68n }], complete: true });
  // X Layer testnet a day after deployment: the first 1,000 blocks and the last 4,000, with the gap stated.
  const plan = scanPlan(47_161_508n, 47_241_460n, 100n, 40, 10);
  assert.deepEqual(plan, { ranges: [{ from: 47_161_508n, to: 47_162_507n }, { from: 47_237_461n, to: 47_241_460n }], complete: false });
  assert.equal(unscannedBlocks(plan.ranges), 47_237_461n - 47_162_507n - 1n);
  // The recorded public auto-repay (block 47,161,960) is inside the early range.
  assert.ok(plan.ranges[0]!.from <= 47_161_960n && 47_161_960n <= plan.ranges[0]!.to);
  // The two ends meet: one merged range, complete, nothing read twice.
  assert.deepEqual(scanPlan(1000n, 5500n, 100n, 40, 10), { ranges: [{ from: 1000n, to: 5500n }], complete: true });
  assert.deepEqual(scanPlan(1000n, 5999n, 100n, 40, 10), { ranges: [{ from: 1000n, to: 5999n }], complete: true });
  assert.equal(scanPlan(1000n, 6001n, 100n, 40, 10).complete, false);
  // No early pages: the head only, as before.
  assert.deepEqual(scanPlan(47_000_000n, 47_160_000n, 100n, 40, 0), { ranges: [{ from: 47_156_001n, to: 47_160_000n }], complete: false });
  assert.equal(unscannedBlocks([{ from: 1n, to: 68n }]), 0n);
});

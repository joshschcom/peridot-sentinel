import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLogPages, scanWindow } from "./log-pages.ts";

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

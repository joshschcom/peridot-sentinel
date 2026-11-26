import assert from "node:assert/strict";
import { test } from "node:test";
import { type SnapshotLike, activityKey, mergeRanges, mergedCoverage, snapshotActivity, uncoveredRanges, unindexedEmitters } from "./activity-merge.ts";
import { EXPANSION } from "./expansion.ts";

const A = "0x00000000000000000000000000000000000000a1";
const CONTROLLER = "0x00000000000000000000000000000000000000c1";
const SENTINEL = "0x00000000000000000000000000000000000000d1";
const OTHER = "0x00000000000000000000000000000000000000e1";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const snapshot = (events: SnapshotLike["events"]): SnapshotLike => ({ fromBlock: 100n, toBlock: 200n, sources: [{ address: CONTROLLER, fromBlock: 100n }, { address: SENTINEL, fromBlock: 120n }], events });
const allowed = (n: number, address: string, account: string, logIndex = 0n) => ({ blockNumber: 150n, transactionHash: tx(n), logIndex, address, eventName: "PolicyAllowed", args: { account, op: "2", postLtvBps: "4000", oracleFresh: true, cashOk: true }, timestamp: 1n });
const scope = { controllers: [CONTROLLER], sentinels: [SENTINEL], holders: [A, SENTINEL] };

test("snapshot events use the same filter as the live scan", () => {
  const found = snapshotActivity(
    snapshot([
      allowed(1, CONTROLLER, A), // controller, for the wallet: shown
      allowed(2, SENTINEL.toUpperCase().replace("0X", "0x"), SENTINEL), // case-insensitive
      allowed(3, CONTROLLER, OTHER), // another holder: not this wallet's
      allowed(4, OTHER, A), // an emitter outside the list (for example a v2 account): not shown
      { blockNumber: 160n, transactionHash: tx(5), logIndex: 9n, address: SENTINEL, eventName: "AutoRepayExecuted", args: { operator: OTHER, amount: "20000000", ltvBeforeBps: "5001", ltvAfterBps: "3751" }, timestamp: 2n },
      { blockNumber: 160n, transactionHash: tx(6), logIndex: 1n, address: CONTROLLER, eventName: "AutoRepayExecuted", args: { amount: "1", ltvBeforeBps: "1", ltvAfterBps: "1" }, timestamp: 2n }, // not a Sentinel account
      { blockNumber: 160n, transactionHash: tx(7), logIndex: 1n, address: CONTROLLER, eventName: "MarketActivated", args: {}, timestamp: 2n },
    ]),
    scope,
  );
  assert.deepEqual(found.events.map((event) => [event.kind, event.transactionHash]), [["PolicyAllowed", tx(1)], ["PolicyAllowed", tx(2)], ["AutoRepayExecuted", tx(5)]]);
  assert.equal(found.skipped, 0);
  const repay = found.events[2]!;
  assert.ok(repay.kind === "AutoRepayExecuted" && repay.amount === 20_000_000n && repay.ltvBeforeBps === 5001n && repay.ltvAfterBps === 3751n);
});

test("an event with unexpected arguments is skipped and counted, never guessed at", () => {
  const found = snapshotActivity(snapshot([{ ...allowed(1, CONTROLLER, A), args: { account: A, op: "two", postLtvBps: "4000", oracleFresh: true } }, { ...allowed(2, CONTROLLER, A), args: { account: A, op: "2", postLtvBps: "-1", oracleFresh: true } }, { ...allowed(3, CONTROLLER, A), args: { account: A, op: "2", postLtvBps: "1", oracleFresh: "yes" } }, allowed(4, CONTROLLER, A)]), scope);
  assert.equal(found.events.length, 1);
  assert.equal(found.skipped, 3);
});

test("the de-duplication key ignores the case of the hash and separates log positions", () => {
  assert.equal(activityKey("0xABCD", 3n), activityKey("0xabcd", 3));
  assert.notEqual(activityKey("0xabcd", 3n), activityKey("0xabcd", 4n));
});

test("ranges: merged when they overlap or touch, gaps reported exactly", () => {
  assert.deepEqual(mergeRanges([{ from: 50n, to: 60n }, { from: 10n, to: 20n }, { from: 21n, to: 30n }, { from: 25n, to: 28n }]), [{ from: 10n, to: 30n }, { from: 50n, to: 60n }]);
  assert.deepEqual(uncoveredRanges([{ from: 10n, to: 30n }, { from: 50n, to: 60n }], 5n, 70n), [{ from: 5n, to: 9n }, { from: 31n, to: 49n }, { from: 61n, to: 70n }]);
  assert.deepEqual(uncoveredRanges([{ from: 0n, to: 100n }], 5n, 70n), []);
  assert.deepEqual(uncoveredRanges([], 5n, 7n), [{ from: 5n, to: 7n }]);
});

test("coverage: the snapshot closes the middle, the blocks after it and before the head scan stay a stated gap", () => {
  const scan = [{ from: 100n, to: 199n }, { from: 9_000n, to: 10_000n }];
  const without = mergedCoverage(scan, null, 100n, 10_000n);
  assert.equal(without.complete, false);
  assert.equal(without.unreadBlocks, 8_800n);
  const withSnapshot = mergedCoverage(scan, { from: 100n, to: 8_000n }, 100n, 10_000n);
  assert.deepEqual(withSnapshot.ranges, [{ from: 100n, to: 8_000n }, { from: 9_000n, to: 10_000n }]);
  assert.deepEqual(withSnapshot.gaps, [{ from: 8_001n, to: 8_999n }]);
  assert.equal(withSnapshot.unreadBlocks, 999n);
  assert.equal(withSnapshot.complete, false);
  // The head scan reaches back into the snapshot: every block was read by one of the two.
  assert.equal(mergedCoverage([{ from: 7_500n, to: 10_000n }], { from: 100n, to: 8_000n }, 100n, 10_000n).complete, true);
  // A snapshot that starts after the deployment block leaves the beginning unread.
  assert.deepEqual(mergedCoverage([{ from: 9_000n, to: 10_000n }], { from: 300n, to: 9_500n }, 100n, 10_000n).gaps, [{ from: 100n, to: 299n }]);
});

test("a contract the snapshot does not index is reported", () => {
  assert.deepEqual(unindexedEmitters(snapshot([]), [CONTROLLER, SENTINEL.toUpperCase().replace("0X", "0x"), OTHER, OTHER]), [OTHER]);
});

test("the shipped testnet snapshot: sources are parsed, and the recorded auto-repay is found for its account", { skip: EXPANSION.snapshot.status !== "ok" }, () => {
  if (EXPANSION.snapshot.status !== "ok") return;
  const shipped = EXPANSION.snapshot.value;
  assert.ok(shipped.sources.length > 0 && shipped.sources.every((source) => source.fromBlock >= shipped.fromBlock));
  const repays = shipped.events.filter((event) => event.eventName === "AutoRepayExecuted");
  assert.ok(repays.length > 0);
  const found = snapshotActivity(shipped, { controllers: [], sentinels: [repays[0]!.address], holders: [repays[0]!.address] });
  assert.ok(found.events.some((event) => event.kind === "AutoRepayExecuted" && event.transactionHash === repays[0]!.transactionHash));
  assert.equal(found.skipped, 0);
});

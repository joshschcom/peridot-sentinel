import assert from "node:assert/strict";
import { test } from "node:test";
import { RAW_CONFIG } from "../generated/config.ts";
import { JUDGE_REPAY_MASK, parseJudgeCampaign, repayGrantState, swapGrantState } from "./judge.ts";

const raw = RAW_CONFIG.judge;
const parse = (json: unknown = raw.json, activity: unknown = raw.activity) => parseJudgeCampaign(json, raw.file, activity, raw.activityFile);
const clone = <T>(value: T): T => structuredClone(value);
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("judge-01: owner, operator, two markets with their v1 accounts, the v2 account and both grants", () => {
  const parsed = parse();
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  const campaign = parsed.value;
  assert.equal(campaign.campaign, "judge-01");
  assert.equal(campaign.owner, "0x36bdf2AF3aAa8113c34a6d0168769F6Cc695D50B");
  assert.equal(campaign.operator, "0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88");
  assert.deepEqual(campaign.markets.map((market) => [market.key, market.marketId, market.marketCapBps]), [["A", "2", 6350], ["B", "3", 4850]]);
  assert.equal(campaign.accountCapBps, 5500);
  // The repay grant is on market A's borrower, the swap grant on the v2 account.
  assert.equal(campaign.repayGrant.account, campaign.markets[0]!.account);
  assert.equal(campaign.swapGrant.account, campaign.v2.account);
  assert.equal(campaign.repayGrant.budgetRaw, 2_000_000n);
  assert.equal(campaign.swapGrant.perCallRaw, 10n ** 18n);
  assert.equal(campaign.swapGrant.remainingRaw, 2n * 10n ** 18n);
  // Both expire on 3 December 2026 at 16:50:32 UTC (docs/JUDGE_DEMO.md).
  assert.equal(campaign.repayGrant.expiry, 1796316632n);
  assert.equal(campaign.swapGrant.expiry, 1796316632n);
  assert.equal(new Date(Number(campaign.repayGrant.expiry) * 1000).toISOString(), "2026-12-03T16:50:32.000Z");
  assert.match(campaign.repayGrant.receipt ?? "", /^0x[0-9a-f]{64}$/);
  assert.match(campaign.swapGrant.receipt ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(campaign.setupReceiptCount, 49);
});

test("judge-01: the sync keeps funding balances, the journal and the other setup receipts out of the bundle", () => {
  const text = JSON.stringify(raw);
  assert.ok(!/funding|afterWei|judgeValue|operatorValue|setupReceipts|runtimeCodeHashes|deployer/i.test(text));
  assert.deepEqual(Object.keys((raw.json as Loose).grantReceipts), ["repay", "swap"]);
});

test("judge-01 activity: scoped snapshot with its range, terminal hash and stated gap, newest first", () => {
  const parsed = parse();
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok" || parsed.value.activity.status !== "ok") return assert.fail("activity unavailable");
  const activity = parsed.value.activity.value;
  const source = raw.activity as Loose;
  assert.equal(activity.events.length, source.events.length);
  assert.equal(activity.fromBlock.toString(), source.coverage.fromBlock);
  assert.equal(activity.toBlock.toString(), source.coverage.toBlock);
  assert.equal(activity.toBlockHash, source.coverage.toBlockHash);
  assert.equal(activity.gaps.length, source.coverage.gaps.length);
  assert.ok(activity.gaps.every((gap) => gap.fromBlock > activity.toBlock));
  for (let i = 1; i < activity.events.length; i++) assert.ok(activity.events[i - 1]!.blockNumber >= activity.events[i]!.blockNumber);
  assert.ok(activity.events.some((event) => event.eventName === "OperatorSet") && activity.events.some((event) => event.eventName === "GrantSet"));
});

test("judge campaign: a manifest that is not what the guide describes is unavailable, not repaired", () => {
  const edit = (change: (json: Loose) => void) => {
    const json = clone(raw.json) as Loose;
    change(json);
    return parse(json).status;
  };
  assert.equal(parse(null).status, "unavailable");
  assert.equal(edit((json) => (json.chainId = 196)), "unavailable"); // never a mainnet campaign
  assert.equal(edit((json) => (json.profile = "fork")), "unavailable");
  assert.equal(edit((json) => (json.label = "Real assets")), "unavailable");
  assert.equal(edit((json) => (json.operator = json.owner)), "unavailable");
  assert.equal(edit((json) => (json.grants.repay.account = json.markets.B.account)), "unavailable");
  assert.equal(edit((json) => (json.grants.swap.expiry = "soon")), "unavailable");
  assert.equal(edit((json) => (json.policies.execution.mode = "tapeout")), "unavailable");
  assert.equal(edit((json) => (json.policies.A.capBps = 10_001)), "unavailable");
  assert.equal(edit((json) => (json.markets.A.marketPolicy = json.markets.B.marketPolicy)), "unavailable");
  assert.equal(edit((json) => (json.campaign = "../other")), "unavailable");
});

test("judge activity: a snapshot of another campaign, chain or range is not shown", () => {
  const edit = (change: (json: Loose) => void) => {
    const activity = clone(raw.activity) as Loose;
    change(activity);
    const parsed = parse(raw.json, activity);
    return parsed.status === "ok" ? parsed.value.activity.status : "campaign-unavailable";
  };
  assert.equal(edit(() => {}), "ok");
  assert.equal(edit((activity) => (activity.campaign = "judge-02")), "unavailable");
  assert.equal(edit((activity) => (activity.chainId = 31337)), "unavailable");
  assert.equal(edit((activity) => (activity.kind = "indexer-snapshot")), "unavailable");
  assert.equal(edit((activity) => (activity.coverage.toBlock = activity.coverage.fromBlock)), "unavailable"); // events beyond the claimed range
  assert.equal(edit((activity) => (activity.events[0].transactionHash = "0x12")), "unavailable");
  assert.equal(edit((activity) => (activity.events[0].eventName = "<img src=x>")), "unavailable");
  // A missing snapshot leaves the campaign itself readable.
  const parsed = parseJudgeCampaign(raw.json, raw.file, null, null);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.status === "ok" ? parsed.value.activity.status : "", "unavailable");
});

test("grant state is judged against the block time: an expiry equal to it has passed", () => {
  const expiry = 1796316632n;
  assert.equal(repayGrantState({ opsMask: JUDGE_REPAY_MASK, remaining: 2_000_000n, expiry }, expiry - 1n), "ready");
  assert.equal(repayGrantState({ opsMask: JUDGE_REPAY_MASK, remaining: 2_000_000n, expiry }, expiry), "expired");
  assert.equal(repayGrantState({ opsMask: JUDGE_REPAY_MASK, remaining: 0n, expiry }, expiry - 1n), "spent");
  assert.equal(repayGrantState({ opsMask: 0, remaining: 0n, expiry: 0n }, 1n), "revoked");
  assert.equal(repayGrantState({ opsMask: 12, remaining: 1n, expiry }, 1n), "unexpected"); // repay AND borrow is not the prepared grant
  assert.equal(swapGrantState({ maxPerCall: 10n ** 18n, remaining: 2n * 10n ** 18n, expiry }, expiry - 1n), "ready");
  assert.equal(swapGrantState({ maxPerCall: 10n ** 18n, remaining: 2n * 10n ** 18n, expiry }, expiry + 1n), "expired");
  assert.equal(swapGrantState({ maxPerCall: 10n ** 18n, remaining: 0n, expiry }, expiry - 1n), "spent");
  assert.equal(swapGrantState({ maxPerCall: 0n, remaining: 0n, expiry: 0n }, 1n), "revoked");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";
import { type PublishedRecord, verifyStrategyPublication } from "../../../../packages/strategy-sdk/registry.ts";
import { RAW_CONFIG } from "../generated/config.ts";
import { CURATED } from "./strategy.ts";
import { REJECTION_SENTENCES, blocksIn, coverageRanges, pageCount, pageSpan, parsePublicationKey, parseRegistryPin, publicationHref, registrySwitches, rejectionMeaning, samePublication, selectPages, seriesIdFromName } from "./strategy-registry.ts";

const PIN = { chainId: 1952, address: "0xB1BE0326E007e2719CdBBd61D8E26356d39F28ed", runtimeCodeHash: `0x${"c8".repeat(32)}`, deploymentBlock: "47314090", confirmations: 12, deploymentTxHash: `0x${"6c".repeat(32)}` };

test("the committed pin of the public registry parses, with a bigint deployment block and 12 confirmations", () => {
  const pin = parseRegistryPin(RAW_CONFIG.registry.json);
  assert.equal(pin.status, "ok");
  if (pin.status !== "ok") return;
  assert.equal(pin.value.address, "0xB1BE0326E007e2719CdBBd61D8E26356d39F28ed");
  assert.equal(pin.value.deploymentBlock, 47314090n);
  assert.equal(pin.value.confirmations, 12);
  assert.match(pin.value.runtimeCodeHash, /^0x[0-9a-f]{64}$/);
});

test("a pin is refused unless it is a complete 1952 pin with at least 12 confirmations", () => {
  assert.equal(parseRegistryPin(PIN).status, "ok");
  for (const [label, change] of [
    ["absent", null],
    ["another chain", { ...PIN, chainId: 196 }],
    ["the local chain", { ...PIN, chainId: 31337 }],
    ["zero address", { ...PIN, address: `0x${"0".repeat(40)}` }],
    ["short address", { ...PIN, address: "0xB1BE" }],
    ["no code hash", { ...PIN, runtimeCodeHash: undefined }],
    ["zero code hash", { ...PIN, runtimeCodeHash: `0x${"0".repeat(64)}` }],
    ["numeric block", { ...PIN, deploymentBlock: 47314090 }],
    ["hex block", { ...PIN, deploymentBlock: "0x2d1f4aa" }],
    ["fewer confirmations", { ...PIN, confirmations: 3 }],
    ["no confirmations", { ...PIN, confirmations: undefined }],
  ] as const) assert.equal(parseRegistryPin(change).status, "unavailable", label);
  const noTx = parseRegistryPin({ ...PIN, deploymentTxHash: "not a hash" });
  assert.equal(noTx.status === "ok" && noTx.value.deploymentTxHash, null);
});

test("the environment can turn the registry off and can never turn publishing on", () => {
  const committed = registrySwitches(undefined);
  assert.deepEqual(registrySwitches("off"), { discover: false, publish: false });
  for (const value of ["on", "1", "true", "publish", ""]) assert.deepEqual(registrySwitches(value), committed, value);
  assert.equal(committed.publish && !committed.discover, false);
});

test("pages are 100 blocks on a grid fixed to the deployment block, through the confirmed block", () => {
  const dep = 47314090n;
  assert.equal(pageCount(dep, dep - 1n), 0);
  assert.equal(pageCount(dep, dep), 1);
  assert.equal(pageCount(dep, dep + 99n), 1);
  assert.equal(pageCount(dep, dep + 100n), 2);
  assert.deepEqual(pageSpan(dep, dep + 250n, 0), { from: dep, to: dep + 99n });
  assert.deepEqual(pageSpan(dep, dep + 250n, 2), { from: dep + 200n, to: dep + 250n });
  for (let index = 0; index < 3; index++) assert.ok(blocksIn(pageSpan(dep, dep + 250n, index)) <= 100n);
  // The two curated publications (blocks 47,314,279 and 47,314,291) are in the second and third page.
  assert.equal(Number((47314279n - dep) / 100n), 1);
  assert.equal(Number((47314291n - dep) / 100n), 2);
});

test("a scan reads the first and the last pages, everything when they meet, and never a page twice", () => {
  assert.deepEqual(selectPages(53, 3, 2), [0, 1, 2, 51, 52]);
  assert.deepEqual(selectPages(5, 3, 2), [0, 1, 2, 3, 4]);
  assert.deepEqual(selectPages(4, 3, 2), [0, 1, 2, 3]);
  assert.deepEqual(selectPages(1, 3, 2), [0]);
  assert.deepEqual(selectPages(0, 3, 2), []);
  assert.deepEqual(selectPages(10, 0, 0), []);
  assert.deepEqual(selectPages(10, 8, 2), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("coverage states every block once: read, not read, or unavailable with the reason", () => {
  const dep = 1000n;
  const confirmed = 1549n; // six pages, the last one 50 blocks
  const outcome = new Map<number, { ok: true } | { ok: false; reason: string }>([[0, { ok: true }], [1, { ok: true }], [2, { ok: false, reason: "block range too large" }], [5, { ok: true }]]);
  const ranges = coverageRanges(dep, confirmed, outcome);
  assert.deepEqual(ranges, [
    { from: 1000n, to: 1199n, status: "read", reason: null, pages: 2 },
    { from: 1200n, to: 1299n, status: "unavailable", reason: "block range too large", pages: 1 },
    { from: 1300n, to: 1499n, status: "not-read", reason: null, pages: 2 },
    { from: 1500n, to: 1549n, status: "read", reason: null, pages: 1 },
  ]);
  // No block is missing and none is counted twice.
  assert.equal(ranges.reduce((sum, range) => sum + blocksIn(range), 0n), confirmed - dep + 1n);
  for (let index = 1; index < ranges.length; index++) assert.equal(ranges[index]!.from, ranges[index - 1]!.to + 1n);
  // Two failures with different reasons stay apart.
  const two = coverageRanges(dep, 1199n, new Map([[0, { ok: false, reason: "a" }], [1, { ok: false, reason: "b" }]]));
  assert.equal(two.length, 2);
  assert.deepEqual(coverageRanges(dep, dep - 1n, new Map()), []);
});

test("a publication key is exactly an address, a series, a version and a block, or nothing", () => {
  const creator = "0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67";
  const series = `0x${"6f".repeat(32)}`;
  const key = parsePublicationKey(`${creator}:${series}:1`, "47314279");
  assert.deepEqual(key, { creator, seriesId: series, version: 1, block: 47314279n });
  assert.equal(publicationHref(key!), `/strategies?published=${creator}:${series}:1&at=47314279#create`);
  const query = new URLSearchParams(publicationHref(key!).split("?")[1]!.split("#")[0]);
  assert.deepEqual(parsePublicationKey(query.get("published"), query.get("at")), key);
  for (const [published, at] of [
    [null, "1"],
    [`${creator}:${series}:1`, null],
    [`${creator}:${series}:1`, "0"],
    [`${creator}:${series}:1`, "0x10"],
    [`${creator}:${series}:0`, "5"],
    [`${creator}:${series}:4294967296`, "5"],
    [`${creator}:${series}:1:extra`, "5"],
    [`${creator}:${series}`, "5"],
    [`0x${"0".repeat(40)}:${series}:1`, "5"],
    [`${creator}:0x${"0".repeat(64)}:1`, "5"],
    [`${creator}:${series.slice(0, 40)}:1`, "5"],
    [`javascript:alert(1):1`, "5"],
  ] as const) assert.equal(parsePublicationKey(published, at), null, `${published} @ ${at}`);
  assert.ok(samePublication({ creator: creator.toLowerCase(), seriesId: series.toUpperCase().replace("0X", "0x"), version: 1 }, key!));
  assert.ok(!samePublication({ creator, seriesId: series, version: 2 }, key!));
});

test("every sentence the SDK rejects a publication with has a meaning here (the SDK's own outputs are the source)", () => {
  const curated = CURATED[0]!;
  const good = { canonicalJson: stringToHex(curated.canonical), contentHash: curated.hash };
  // The labels as docs/STRATEGY_REGISTRY.md defines them, computed here independently of the SDK.
  const policy = curated.template.policy;
  const policyKey = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }], [getAddress(policy.enforcer), getAddress(policy.processor), BigInt(policy.circuitId), policy.netlistHash as `0x${string}`]));
  const record: PublishedRecord = { ...good, targetChainId: 1952n, adapterVersion: keccak256(stringToHex(curated.template.deployment.adapter)), policyKey };
  const accepted = verifyStrategyPublication(record);
  assert.equal(accepted.hash, curated.hash);
  assert.deepEqual(accepted.topics, { targetChainId: 1952n, adapterVersion: record.adapterVersion, policyKey });
  const pretty = stringToHex(JSON.stringify(JSON.parse(curated.canonical), null, 2));
  const invalid = stringToHex(JSON.stringify({ ...JSON.parse(curated.canonical), author: "Mallory Capital" }));
  const seen = new Set<string>();
  for (const bad of [
    { ...record, canonicalJson: "0x" as const },
    { ...record, contentHash: keccak256("0x01") },
    { ...record, canonicalJson: invalid, contentHash: keccak256(invalid) },
    { ...record, canonicalJson: pretty, contentHash: keccak256(pretty) },
    { ...record, adapterVersion: keccak256(stringToHex("another-adapter-v9")) },
    { ...record, policyKey: keccak256("0x02") },
    { ...record, targetChainId: 196n },
  ]) {
    assert.throws(() => verifyStrategyPublication(bad), (error: Error) => {
      seen.add(error.message);
      return true;
    });
  }
  assert.deepEqual([...seen].sort(), [...REJECTION_SENTENCES].sort());
  for (const sentence of seen) assert.notEqual(rejectionMeaning(sentence), rejectionMeaning("something else"));
});

test("a series id is the hash of a short, plain name, and nothing else is accepted as a name", () => {
  assert.equal(seriesIdFromName("my-debt-guard"), keccak256(stringToHex("my-debt-guard")));
  assert.notEqual(seriesIdFromName("a"), seriesIdFromName("b"));
  for (const bad of ["", "-a", "a-", "a--b", "Has Capitals", "has space", "ünï", "a".repeat(33), "0x" + "00".repeat(32), "a_b", "a.b"]) assert.equal(seriesIdFromName(bad), null, bad);
  assert.match(seriesIdFromName("a".repeat(32))!, /^0x[0-9a-f]{64}$/);
});

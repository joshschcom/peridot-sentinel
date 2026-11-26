import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAbi, toFunctionSelector } from "viem";
import { RAW_CONFIG } from "../generated/config.ts";
import { RAW_EVIDENCE } from "../generated/evidence.ts";
import { V2_ACCOUNT_VIEW_SIGNATURES, V2_FACTORY_VIEW_SIGNATURES, V2_SWAP_VIEW_SIGNATURES } from "../services/chain/expansion.ts";
import { EXPANSION, parseActivitySnapshot, parseExpansionManifest, parseMinedRejections, parseV2Demo } from "./expansion.ts";

// All assertions run against the files in the repo (synced by scripts/sync-manifests.mjs).
test("v2 manifest: public 1952 deployment, mock venue, development reference processor, no UI writes", () => {
  assert.equal(EXPANSION.manifest.status, "ok");
  if (EXPANSION.manifest.status !== "ok") return;
  const m = EXPANSION.manifest.value;
  assert.equal(m.contracts.factory.toLowerCase(), "0xbdd270a685596452557c8342ca3d39b1133ba7a0");
  assert.equal(m.contracts.account.toLowerCase(), "0x7dc8dd13f3c73daeecaa37cb1f321a08af741b5f");
  assert.equal(m.contracts.swap.toLowerCase(), "0xf2e6d955158fe77252713d982f9d376f467e7cd3");
  assert.equal(m.contracts.lending.toLowerCase(), "0xdad2bbf5ce7bc43a932c78b5bcd5e0d284348101");
  assert.match(m.label, /mock/i);
  assert.equal(m.processorMode, "development-reference");
  assert.equal(m.swap.policyMaxLossBps, 100);
  assert.equal(m.ownerSetupSwap?.hash, "0xcc0cff745e7b03831ef7379f9fd11395283cf1fa103b5ec8c0f833a568f7482c");
  assert.equal(m.simulatedDenial?.lossBps, 101);
  assert.equal(m.uiEnabled, (RAW_CONFIG.expansion.byChain["1952"] as { uiEnabled: unknown }).uiEnabled === true);
});

test("a v2 manifest for another chain, without the mock label or with a bad address is refused", () => {
  const json = structuredClone(RAW_CONFIG.expansion.byChain["1952"]) as Record<string, unknown> & { contracts: Record<string, string>; execution: Record<string, string> };
  assert.equal(parseExpansionManifest({ ...json, chainId: 196 }, "t").status, "unavailable");
  assert.equal(parseExpansionManifest({ ...json, label: "Public testnet with Uniswap v3" }, "t").status, "unavailable");
  assert.equal(parseExpansionManifest({ ...json, contracts: { ...json.contracts, swap: "0x1234" } }, "t").status, "unavailable");
  assert.equal(parseExpansionManifest({ ...json, execution: { ...json.execution, mode: "official" } }, "t").status, "unavailable");
  assert.equal(parseExpansionManifest(undefined, "t").status, "unavailable");
});

test("v2 receipts: operator execution, owner actions and the mined denial are kept apart", () => {
  assert.equal(EXPANSION.demo.status, "ok");
  if (EXPANSION.demo.status !== "ok") return;
  const d = EXPANSION.demo.value;
  assert.equal(d.operatorSwap?.hash, "0x623c753bfc084e370bab5ddde0f3f729ba9372c5de00ea47f12029bb066a672d");
  assert.equal(d.operatorSwap?.from.toLowerCase(), d.operator.toLowerCase());
  assert.equal(d.operatorSwap?.recipient.toLowerCase(), d.account.toLowerCase());
  assert.equal(d.operatorSwap?.amountOut, 79_960_000n);
  assert.equal(d.minedDenial?.hash, "0x2f813549a851fd50e4afc90349e961e39ea39e0115db7cf22e6568e00a8dfa12");
  assert.equal(d.minedDenial?.error, "ExecutionPolicyDenied");
  assert.equal(d.minedDenial?.lossBps, 101);
  assert.equal(d.grant?.op, 5);
  assert.notEqual(d.ownerSupply?.from.toLowerCase(), d.operator.toLowerCase());
  // A "swap" sent by someone other than the operator is not shown as operator execution; a success is not a denial.
  const json = structuredClone(RAW_EVIDENCE.v2Demo.json) as { operatorSwap: Record<string, unknown>; denial: Record<string, unknown> };
  json.operatorSwap.from = "0x8c1741a53d5fb97d74c1d105b0fbfbb4740d5d67";
  json.denial.status = "success";
  const tampered = parseV2Demo(json, "t");
  assert.ok(tampered.status === "ok" && tampered.value.operatorSwap === null && tampered.value.minedDenial === null);
});

test("mined rejections: one per layer, each with the other layer allowing", () => {
  assert.equal(EXPANSION.minedRejections.status, "ok");
  if (EXPANSION.minedRejections.status !== "ok") return;
  const rows = EXPANSION.minedRejections.value.rejections;
  assert.deepEqual(rows.map((row) => [row.error, row.marketOutput, row.accountOutput, row.postLtvBps]), [["AccountPolicyRejected", "0x01", "0x00", 5800], ["MarketPolicyRejected", "0x00", "0x01", 5200]]);
  assert.deepEqual(rows.map((row) => row.hash), ["0x4d9730244f37960058310b2ec2d173546634aed58436fa70966e5c2d6a6d4c0b", "0xb0981049d5c21deb724ac471709e459da14c81c634b12352925f7829023f4feb"]);
  assert.ok(rows.every((row) => row.debtUnchanged));
  // A fork file, or a row that did not revert, is never listed as a mined testnet revert.
  const json = structuredClone(RAW_EVIDENCE.publicRejections.json) as { fork: unknown; rejections: Array<Record<string, unknown>> };
  assert.equal(parseMinedRejections({ ...json, fork: { block: 1 } }, "t").status, "unavailable");
  json.rejections[0]!.status = "success";
  const one = parseMinedRejections(json, "t");
  assert.ok(one.status === "ok" && one.value.rejections.length === 1);
});

test("activity snapshot: one inclusive range, every event inside it", { skip: EXPANSION.snapshot.status !== "ok" }, () => {
  if (EXPANSION.snapshot.status !== "ok") return;
  const s = EXPANSION.snapshot.value;
  assert.ok(s.toBlock >= s.fromBlock && s.events.length > 0);
  assert.ok(s.events.every((event) => event.blockNumber >= s.fromBlock && event.blockNumber <= s.toBlock));
  const json = structuredClone(RAW_CONFIG.activity.byChain["1952"]) as { coverage: Record<string, unknown>; events: Array<Record<string, unknown>> };
  json.events[0]!.blockNumber = String(s.toBlock + 1n);
  assert.equal(parseActivitySnapshot(json, "t").status, "unavailable");
  assert.equal(parseActivitySnapshot({ ...json, chainId: 196 }, "t").status, "unavailable");
});

test("the view functions this app calls exist, with the same selectors, in the published v2 ABIs", () => {
  const selectors = (name: string) => new Set((JSON.parse(readFileSync(new URL(`../../../../packages/chain-config/expansion/abi/${name}.json`, import.meta.url), "utf8")) as Array<{ type: string; stateMutability?: string }>).filter((item) => item.type === "function" && (item.stateMutability === "view" || item.stateMutability === "pure")).map((item) => toFunctionSelector(item as never)));
  for (const [file, signatures] of [["SentinelAccountV2", V2_ACCOUNT_VIEW_SIGNATURES], ["SentinelAccountFactoryV2", V2_FACTORY_VIEW_SIGNATURES], ["SinglePoolSwapAdapter", V2_SWAP_VIEW_SIGNATURES]] as const) {
    const published = selectors(file);
    for (const item of parseAbi(signatures)) assert.ok(published.has(toFunctionSelector(item)), `${file} has no view function ${item.name}`);
  }
});

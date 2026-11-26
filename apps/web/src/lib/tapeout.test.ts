import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeContext } from "@peridot/circuit-sdk";
import { RAW_CONFIG } from "../generated/config.ts";
import { EVAL_SELECTOR, type PublicationFacts, REHEARSAL, TAPEOUT, checkPublication, decodeDecision, encodeExecutionV1, encodeLendingV1, parseTapeoutConfig } from "./tapeout.ts";

test("configuration in the repo: three Peridot circuits on CPU 410, each with a publication state", () => {
  assert.equal(TAPEOUT.status, "ok");
  if (TAPEOUT.status !== "ok") return;
  assert.equal(TAPEOUT.value.chainId, 196);
  assert.equal(TAPEOUT.value.processor.toLowerCase(), "0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5");
  assert.deepEqual(TAPEOUT.value.circuits.map((circuit) => [circuit.name, circuit.kind, circuit.gates]), [["Market Policy V1", "MARKET", 63], ["Sentinel Policy V1", "ACCOUNT", 87], ["Expanded Sentinel Policy V2", "EXECUTION", 59]]);
  // Whatever the file says today, a circuit counts as published only with an ID AND a receipt hash.
  const raw = (RAW_CONFIG.tapeout.json as { circuits: Array<{ publishedId: unknown; publicReceipt: unknown }> }).circuits;
  TAPEOUT.value.circuits.forEach((circuit, index) => {
    const both = raw[index]!.publishedId !== null && raw[index]!.publicReceipt !== null;
    assert.equal(circuit.publication.state === "published", both && circuit.publication.state === "published");
    if (raw[index]!.publishedId === null && raw[index]!.publicReceipt === null) assert.equal(circuit.publication.state, "unpublished");
  });
});

test("a circuit is published only with an ID and a receipt; fork-style or partial entries are refused", () => {
  const base = structuredClone(RAW_CONFIG.tapeout.json) as { chainId: number; circuits: Array<Record<string, unknown>> };
  const withEntry = (patch: Record<string, unknown>) => {
    const json = structuredClone(base);
    Object.assign(json.circuits[0]!, patch);
    const parsed = parseTapeoutConfig(json, "test");
    assert.equal(parsed.status, "ok");
    return parsed.status === "ok" ? parsed.value.circuits[0]!.publication : null;
  };
  const receipt = `0x${"ab".repeat(32)}`;
  assert.deepEqual(withEntry({ publishedId: null, publicReceipt: null }), { state: "unpublished" });
  assert.deepEqual(withEntry({ publishedId: "7", publicReceipt: receipt }), { state: "published", id: 7n, receipt });
  assert.deepEqual(withEntry({ publishedId: 7, publicReceipt: { hash: receipt } }), { state: "published", id: 7n, receipt });
  assert.equal(withEntry({ publishedId: "7", publicReceipt: null })?.state, "incomplete");
  assert.equal(withEntry({ publishedId: null, publicReceipt: receipt })?.state, "incomplete");
  assert.equal(withEntry({ publishedId: "0", publicReceipt: receipt })?.state, "incomplete");
  assert.equal(withEntry({ publishedId: "0x2", publicReceipt: receipt })?.state, "incomplete");
  assert.equal(withEntry({ publishedId: "7", publicReceipt: "0x1234" })?.state, "incomplete");
  // The same ID on two circuits is a mistake: neither is treated as published.
  const duplicate = structuredClone(base);
  Object.assign(duplicate.circuits[0]!, { publishedId: "7", publicReceipt: receipt });
  Object.assign(duplicate.circuits[1]!, { publishedId: "7", publicReceipt: receipt });
  const parsed = parseTapeoutConfig(duplicate, "test");
  assert.ok(parsed.status === "ok" && parsed.value.circuits[0]!.publication.state === "incomplete" && parsed.value.circuits[1]!.publication.state === "incomplete");
  assert.equal(parseTapeoutConfig({ ...base, chainId: 1952 }, "test").status, "unavailable");
  assert.equal(parseTapeoutConfig(null, "test").status, "unavailable");
});

test("both encoders reproduce all 23 rehearsed vectors; the lending one equals the SDK encoder", () => {
  assert.equal(REHEARSAL.circuits.length, 3);
  let checked = 0;
  for (const circuit of REHEARSAL.circuits) {
    const execution = /EXECUTION/.test(circuit.label);
    for (const vector of circuit.vectors) {
      assert.equal(vector.selector, EVAL_SELECTOR);
      assert.ok(vector.output === "0x00" || vector.output === "0x01");
      const context = vector.context as Record<string, unknown>;
      if (execution) {
        // Two vectors describe malformed inputs by a reason only (reserved bit set, wrong operation). The encoder
        // cannot produce them by construction, which is the point: check that instead.
        if (typeof context.reason === "string") {
          for (let checks = 0; checks < 16; checks++) assert.notEqual(encodeExecutionV1({ checks, lossBps: 0 }).status === "ok" ? (encodeExecutionV1({ checks, lossBps: 0 }) as { value: string }).value : "", vector.inputs);
          checked++;
          continue;
        }
        const encoded = encodeExecutionV1({ checks: context.checks as number, lossBps: context.lossBps as number });
        assert.deepEqual(encoded, { status: "ok", value: vector.inputs });
      } else {
        const lending = { op: context.op as number, oracleFresh: context.oracleFresh as boolean, postLtvBps: context.postLtvBps as number, cashOk: context.cashOk as boolean };
        assert.deepEqual(encodeLendingV1(lending), { status: "ok", value: vector.inputs });
        assert.equal(encodeContext(lending as Parameters<typeof encodeContext>[0]), vector.inputs);
      }
      checked++;
    }
  }
  assert.equal(checked, 23);
});

test("the rehearsed circuits are the configured ones (same netlist hashes)", () => {
  if (TAPEOUT.status !== "ok") return;
  assert.deepEqual(REHEARSAL.circuits.map((circuit) => circuit.netlistHash), TAPEOUT.value.circuits.map((circuit) => circuit.netlistHash));
});

test("out-of-range inputs are rejected, never truncated", () => {
  assert.equal(encodeLendingV1({ op: 2, oracleFresh: true, postLtvBps: 16383, cashOk: true }).status, "ok");
  assert.equal(encodeLendingV1({ op: 2, oracleFresh: true, postLtvBps: 16384, cashOk: true }).status, "unavailable");
  assert.equal(encodeLendingV1({ op: 2, oracleFresh: true, postLtvBps: -1, cashOk: true }).status, "unavailable");
  assert.equal(encodeLendingV1({ op: 2, oracleFresh: true, postLtvBps: 65.5, cashOk: true }).status, "unavailable");
  assert.equal(encodeLendingV1({ op: 16, oracleFresh: true, postLtvBps: 1, cashOk: true }).status, "unavailable");
  assert.equal(encodeExecutionV1({ checks: 15, lossBps: 1023 }).status, "ok");
  assert.equal(encodeExecutionV1({ checks: 15, lossBps: 1024 }).status, "unavailable");
  assert.equal(encodeExecutionV1({ checks: 16, lossBps: 0 }).status, "unavailable");
  assert.equal(encodeExecutionV1({ checks: 15, lossBps: Number.NaN }).status, "unavailable");
});

test("only 0x00 and 0x01 are decisions", () => {
  assert.deepEqual(decodeDecision("0x01"), { kind: "allow" });
  assert.deepEqual(decodeDecision("0x00"), { kind: "deny" });
  for (const output of ["0x", "0x02", "0x0001", "0x942560200000", ""]) assert.equal(decodeDecision(output).kind, "invalid");
});

// SYNTHETIC facts: no Peridot circuit is published, so the positive path is exercised with made-up receipts here.
// It has not been run against mainnet.
test("publication gate: order and every refusal (synthetic receipts)", () => {
  const processor = "0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5";
  const topic = `0x${"7a".repeat(32)}`;
  const circuit = { id: 9n, netlistHash: `0x${"cd".repeat(32)}`, gates: 63 };
  const pad = (value: bigint) => value.toString(16).padStart(64, "0");
  const good = (): PublicationFacts => ({
    receipt: { status: "success", to: processor.toLowerCase(), blockNumber: 100n, blockHash: `0x${"11".repeat(32)}`, logs: [{ address: processor, topics: [topic, `0x${pad(9n)}`, `0x${pad(1n)}`], data: `0x${pad(20n)}${pad(1n)}` }] },
    canonicalBlockHash: `0x${"11".repeat(32)}`,
    pinnedBlock: 200n,
    tapedOutTopic: topic,
    info: { nIn: 20, nOut: 1, nState: 0, gates: 63 },
    netlistHash: `0x${"CD".repeat(32)}`,
  });
  const run = (patch: (facts: PublicationFacts) => void) => {
    const facts = good();
    patch(facts);
    return checkPublication(circuit, processor, facts);
  };
  assert.deepEqual(run(() => {}), { ok: true });
  const step = (result: ReturnType<typeof checkPublication>) => (result.ok ? "ok" : result.step);
  assert.equal(step(run((facts) => (facts.receipt = null))), "receipt");
  assert.equal(step(run((facts) => (facts.receipt!.status = "reverted"))), "receipt");
  assert.equal(step(run((facts) => (facts.receipt!.to = "0x0000000000000000000000000000000000000001"))), "receipt");
  assert.equal(step(run((facts) => (facts.canonicalBlockHash = `0x${"22".repeat(32)}`))), "receipt");
  assert.equal(step(run((facts) => (facts.pinnedBlock = 99n))), "receipt");
  assert.equal(step(run((facts) => (facts.receipt!.logs = []))), "event");
  assert.equal(step(run((facts) => (facts.receipt!.logs[0]!.topics = [topic, `0x${pad(8n)}`, `0x${pad(1n)}`]))), "event");
  assert.equal(step(run((facts) => (facts.receipt!.logs[0]!.address = "0x0000000000000000000000000000000000000001"))), "event");
  assert.equal(step(run((facts) => (facts.receipt!.logs[0]!.data = `0x${pad(5n)}${pad(42n)}`))), "event");
  assert.equal(step(run((facts) => (facts.info = { nIn: 5, nOut: 42, nState: 0, gates: 163 }))), "dimensions");
  assert.equal(step(run((facts) => (facts.info!.gates = 64))), "dimensions");
  assert.equal(step(run((facts) => (facts.info = null))), "dimensions");
  assert.equal(step(run((facts) => (facts.netlistHash = null))), "netlist");
  assert.equal(step(run((facts) => (facts.netlistHash = `0x${"ee".repeat(32)}`))), "netlist");
});

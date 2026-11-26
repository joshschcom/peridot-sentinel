/**
 * Peridot's policy circuits on X Layer mainnet (chain 196), as published on the TapeOut processor.
 *
 * ONE configuration file decides what this app treats as published:
 *   packages/chain-config/expansion/tapeout-196.json   (synced into src/generated/config.ts)
 * A circuit is "published" only when that file gives it BOTH a `publishedId` and a `publicReceipt` (the hash of its
 * public fabrication transaction). Until then it is shown as "Not yet published". IDs from a fork rehearsal must
 * never be written there, and nothing in this module ever falls back to one.
 *
 * What a native evaluation is: evidence that the circuit exists on the processor and computes a given answer for
 * given inputs. It is NOT enforcement. No account or market on mainnet is bound to these circuits; enforcement
 * happens in the account and market contract paths.
 */
import { RAW_CONFIG } from "../generated/config.ts";
import { RAW_EVIDENCE } from "../generated/evidence.ts";
import { type Maybe, ok, unavailable } from "./maybe.ts";

export type Hex = `0x${string}`;
export const NATIVE_EVAL_LABEL = "Native evaluation (read-only)";
export const FORK_REHEARSAL_LABEL = "Mainnet fork rehearsal (not a public transaction)";
/** eval(uint256,bytes) on the processor. Checked against the calldata recorded in the rehearsal. */
export const EVAL_SELECTOR = "0x934d06ea";
/** Every Peridot policy circuit: 20 input wires, one output bit, no state. */
export const POLICY_DIMENSIONS = { nIn: 20, nOut: 1, nState: 0 } as const;

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/* ---------- configuration ---------- */

export type CircuitSchema = "lending-v1" | "sentinel-execution-swap-v1";
export interface PeridotCircuit {
  name: string;
  kind: "MARKET" | "ACCOUNT" | "EXECUTION";
  schema: CircuitSchema;
  gates: number;
  netlistHash: Hex;
  /**
   * published      ID and fabrication receipt are both configured: the page may verify and evaluate it on mainnet.
   * unpublished    neither is configured.
   * incomplete     only one of the two is configured, or one is malformed: treated as not published, with the reason.
   */
  publication: { state: "published"; id: bigint; receipt: Hex } | { state: "unpublished" } | { state: "incomplete"; reason: string };
}
export interface TapeoutConfig {
  file: string;
  chainId: 196;
  processor: Hex;
  circuits: PeridotCircuit[];
}

function publication(entry: Rec): PeridotCircuit["publication"] {
  const rawId = entry.publishedId;
  const rawReceipt = entry.publicReceipt;
  const receiptText = typeof rawReceipt === "string" ? rawReceipt : (rec(rawReceipt)?.hash ?? rec(rawReceipt)?.transactionHash ?? null);
  const hasId = rawId !== null && rawId !== undefined;
  const hasReceipt = rawReceipt !== null && rawReceipt !== undefined;
  if (!hasId && !hasReceipt) return { state: "unpublished" };
  const idText = typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : typeof rawId === "string" ? rawId : "";
  if (!/^[1-9]\d{0,30}$/.test(idText)) return { state: "incomplete", reason: hasId ? "The configured circuit ID is not a positive integer" : "A receipt is configured without a circuit ID" };
  if (typeof receiptText !== "string" || !HASH.test(receiptText)) return { state: "incomplete", reason: hasReceipt ? "The configured publication receipt is not a transaction hash" : "A circuit ID is configured without its publication receipt" };
  return { state: "published", id: BigInt(idText), receipt: receiptText as Hex };
}

export function parseTapeoutConfig(json: unknown, file: string): Maybe<TapeoutConfig> {
  const root = rec(json);
  if (!root) return unavailable("The TapeOut circuit configuration is not in this build");
  if (root.chainId !== 196) return unavailable("The TapeOut circuit configuration is not for X Layer mainnet (chain 196)");
  if (typeof root.processor !== "string" || !ADDRESS.test(root.processor)) return unavailable("The TapeOut circuit configuration has no valid processor address");
  if (!Array.isArray(root.circuits) || root.circuits.length === 0) return unavailable("The TapeOut circuit configuration lists no circuits");
  const circuits: PeridotCircuit[] = [];
  for (const item of root.circuits) {
    const entry = rec(item);
    const schema = entry?.schema;
    const kind = entry?.kind;
    if (!entry || typeof entry.name !== "string" || typeof entry.netlistHash !== "string" || !HASH.test(entry.netlistHash) || typeof entry.gates !== "number" || (schema !== "lending-v1" && schema !== "sentinel-execution-swap-v1") || (kind !== "MARKET" && kind !== "ACCOUNT" && kind !== "EXECUTION")) return unavailable("The TapeOut circuit configuration has an entry this app does not understand");
    // The schema decides what the input bits mean, so a mismatch between kind and schema is refused, not guessed.
    if ((schema === "sentinel-execution-swap-v1") !== (kind === "EXECUTION")) return unavailable(`The TapeOut circuit configuration pairs ${kind} with schema ${schema}`);
    circuits.push({ name: entry.name, kind, schema, gates: entry.gates, netlistHash: entry.netlistHash.toLowerCase() as Hex, publication: publication(entry) });
  }
  // Two circuits cannot share an ID on one processor: a duplicate is a configuration mistake, so neither is evaluated.
  const ids = circuits.flatMap((circuit) => (circuit.publication.state === "published" ? [circuit.publication.id.toString()] : []));
  for (const circuit of circuits) {
    if (circuit.publication.state === "published" && ids.filter((id) => circuit.publication.state === "published" && id === circuit.publication.id.toString()).length > 1) circuit.publication = { state: "incomplete", reason: "The same circuit ID is configured for more than one circuit" };
  }
  return ok({ file, chainId: 196, processor: root.processor as Hex, circuits });
}

export const TAPEOUT: Maybe<TapeoutConfig> = parseTapeoutConfig(RAW_CONFIG.tapeout.json, RAW_CONFIG.tapeout.file);

/* ---------- input encoders (two schemas, different bit meanings) ---------- */

const toHex3 = (bits: number): Hex => `0x${[bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
const isInt = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/**
 * lending-v1 (docs/coordination/INTERFACES.md): wire 0–3 op, 4 oracleFresh, 5–18 postLtvBps (14 bits), 19 cashOk.
 * Out-of-range values are rejected. Nothing is truncated to fit.
 */
export interface LendingContext {
  op: number;
  oracleFresh: boolean;
  postLtvBps: number;
  cashOk: boolean;
}
export function encodeLendingV1(context: LendingContext): Maybe<Hex> {
  if (!isInt(context.op, 15)) return unavailable("The operation id must be an integer from 0 to 15");
  if (!isInt(context.postLtvBps, 0x3fff)) return unavailable("Loan-to-value must be a whole number of basis points from 0 to 16383 (14 bits)");
  return ok(toHex3(context.op | (context.oracleFresh ? 1 << 4 : 0) | (context.postLtvBps << 5) | (context.cashOk ? 1 << 19 : 0)));
}

/**
 * sentinel-execution-swap-v1 (docs/coordination/INTERFACES_V2.md): wire 0–3 action (5 = swap exact input),
 * 4–7 checks (pair, budget, freshness, input availability), 8–17 permitted loss in bps (10 bits), 18–19 reserved zero.
 */
export const EXECUTION_ACTION_SWAP = 5;
export const EXECUTION_CHECKS = ["Pair and target verified", "Within the authorised budget", "Price is fresh", "Input is available"] as const;
export interface ExecutionContext {
  /** Bit i set = EXECUTION_CHECKS[i] holds. */
  checks: number;
  lossBps: number;
}
export function encodeExecutionV1(context: ExecutionContext): Maybe<Hex> {
  if (!isInt(context.checks, 15)) return unavailable("The checks must be a 4-bit value from 0 to 15");
  if (!isInt(context.lossBps, 0x3ff)) return unavailable("The permitted loss must be a whole number of basis points from 0 to 1023 (10 bits)");
  return ok(toHex3(EXECUTION_ACTION_SWAP | (context.checks << 4) | (context.lossBps << 8)));
}

/** A policy circuit answers one byte: 01 allow, 00 deny. Anything else is not a decision and is never shown as one. */
export type Decision = { kind: "allow" } | { kind: "deny" } | { kind: "invalid"; output: string };
export function decodeDecision(output: string): Decision {
  const value = output.toLowerCase();
  return value === "0x01" ? { kind: "allow" } : value === "0x00" ? { kind: "deny" } : { kind: "invalid", output };
}

/* ---------- publication checks (pure: the chain reads are in services/chain/mainnet-eval.ts) ---------- */

/**
 * keccak256("TapedOut(uint256,address,uint32,uint32)") is computed by the caller with viem and passed in.
 * Event layout: TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState).
 */
export interface PublicationFacts {
  /** Receipt of the configured fabrication transaction, or null when the RPC has none. */
  receipt: { status: "success" | "reverted"; to: string | null; blockNumber: bigint; blockHash: string; logs: Array<{ address: string; topics: readonly string[]; data: string }> } | null;
  /** Hash of the canonical block at receipt.blockNumber, as the RPC reports it now. */
  canonicalBlockHash: string | null;
  /** Block every read of this result is pinned to. */
  pinnedBlock: bigint;
  tapedOutTopic: string;
  /** Null when the processor's read reverted: it holds no circuit under this ID at the pinned block. */
  info: { nIn: number; nOut: number; nState: number; gates: number } | null;
  /** keccak256 of the netlist bytes read from the processor at the pinned block. Null when that read reverted. */
  netlistHash: string | null;
}
export type PublicationCheck = { ok: true } | { ok: false; step: "receipt" | "event" | "dimensions" | "netlist"; reason: string };

const topicId = (topic: string | undefined): bigint | null => (topic && HASH.test(topic) ? BigInt(topic) : null);
const word = (data: string, index: number): bigint | null => {
  const hex = data.slice(2 + index * 64, 2 + (index + 1) * 64);
  return hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex) ? BigInt(`0x${hex}`) : null;
};

/**
 * The gate before any evaluation, in order: a successful canonical receipt sent to the processor; a TapedOut event
 * from the processor for exactly this ID with the configured gate count and no state; matching dimensions on chain
 * (20 inputs, one output, read with circuitInfo); and the
 * netlist on chain hashing to the configured hash. The first failure stops everything: nothing is evaluated.
 */
export function checkPublication(circuit: { id: bigint; netlistHash: string; gates: number }, processor: string, facts: PublicationFacts): PublicationCheck {
  const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
  const receipt = facts.receipt;
  if (!receipt) return { ok: false, step: "receipt", reason: "The public RPC has no receipt for the configured publication transaction" };
  if (receipt.status !== "success") return { ok: false, step: "receipt", reason: "The configured publication transaction reverted" };
  if (!same(receipt.to, processor)) return { ok: false, step: "receipt", reason: "The configured publication transaction was not sent to the configured processor" };
  if (!same(facts.canonicalBlockHash, receipt.blockHash)) return { ok: false, step: "receipt", reason: "The publication receipt is not in the canonical block at its height" };
  if (receipt.blockNumber > facts.pinnedBlock) return { ok: false, step: "receipt", reason: "The publication is newer than the block this result is read at" };
  const event = receipt.logs.find((log) => same(log.address, processor) && same(log.topics[0] ?? null, facts.tapedOutTopic) && topicId(log.topics[1]) === circuit.id);
  if (!event) return { ok: false, step: "event", reason: `The publication receipt has no TapedOut event for circuit #${circuit.id} from the processor` };
  // The event's two data words are the gate count and the state-bit count (MILESTONE_LOG M7-D8b-presign-read-ABI-
  // correction: the earlier brief mislabelled them as nIn/nOut). Inputs and outputs are checked from circuitInfo below.
  if (word(event.data, 0) !== BigInt(circuit.gates) || word(event.data, 1) !== BigInt(POLICY_DIMENSIONS.nState)) return { ok: false, step: "event", reason: `The TapedOut event does not describe a stateless circuit of ${circuit.gates} gates` };
  const info = facts.info;
  if (!info) return { ok: false, step: "dimensions", reason: `The processor has no circuit #${circuit.id} at the block this result is read at` };
  if (info.nIn !== POLICY_DIMENSIONS.nIn || info.nOut !== POLICY_DIMENSIONS.nOut || info.nState !== POLICY_DIMENSIONS.nState || info.gates !== circuit.gates) return { ok: false, step: "dimensions", reason: `The circuit on chain has ${info.nIn} inputs, ${info.nOut} outputs, ${info.nState} state bits and ${info.gates} gates, not the configured 20 / 1 / 0 / ${circuit.gates}` };
  if (facts.netlistHash === null) return { ok: false, step: "netlist", reason: "The processor returned no netlist for this circuit ID" };
  if (!same(facts.netlistHash, circuit.netlistHash)) return { ok: false, step: "netlist", reason: "The netlist on chain does not hash to the configured netlist hash" };
  return { ok: true };
}

/* ---------- rehearsed vectors (fork only; used for tests and as labelled examples) ---------- */

export interface RehearsedVector {
  context: Rec;
  inputs: Hex;
  output: Hex;
  selector: string | null;
}
export interface RehearsedCircuit {
  label: string;
  netlistHash: string;
  dimensions: number[];
  vectors: RehearsedVector[];
}
export function parseRehearsal(json: unknown): RehearsedCircuit[] {
  const evaluations = rec(json)?.evaluations;
  if (!Array.isArray(evaluations)) return [];
  return evaluations.flatMap((item) => {
    const entry = rec(item);
    if (!entry || typeof entry.label !== "string" || typeof entry.netlistHash !== "string" || !Array.isArray(entry.vectors)) return [];
    const vectors = entry.vectors.flatMap((value) => {
      const vector = rec(value);
      const context = rec(vector?.context);
      return vector && context && typeof vector.inputs === "string" && typeof vector.output === "string" ? [{ context, inputs: vector.inputs as Hex, output: vector.output as Hex, selector: typeof vector.selector === "string" ? vector.selector : null }] : [];
    });
    return [{ label: entry.label, netlistHash: entry.netlistHash.toLowerCase(), dimensions: Array.isArray(entry.dimensions) ? entry.dimensions.map(Number) : [], vectors }];
  });
}
export const REHEARSAL = { file: RAW_EVIDENCE.tapeoutVectors.file, circuits: parseRehearsal(RAW_EVIDENCE.tapeoutVectors.json) };

/**
 * Evidence recorded by the contracts team, read from the repo's evidence/ folder at build time.
 * This is NOT fixture data. Each bundle carries a provenance label that must be shown with it:
 *   public   read-only calls against X Layer mainnet (the only publicly verifiable item)
 *   fork     local Anvil fork of X Layer mainnet using the real TapeOut processor code;
 *            its transactions exist only on that fork and are never linked to an explorer
 * Fields are picked defensively: anything missing makes the bundle unavailable rather than guessed.
 */
import { RAW_EVIDENCE } from "../generated/evidence.ts";
import { type Maybe, ok, unavailable } from "./maybe.ts";

export const FORK_LABEL = "Mainnet fork simulation (real TapeOut processor code) — not a public transaction";
export const PUBLIC_READ_LABEL = "Read-only mainnet evaluation of an existing TapeOut circuit";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : typeof value === "number" || typeof value === "bigint" ? String(value) : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export interface PublicSample {
  file: string;
  chainId: number;
  block: string;
  processor: string;
  circuitId: string;
  dimensions: { nIn: string; nOut: string; nState: string; gates: string };
  netlistHash: string;
  vectors: Array<{ input: string; output: string; reference: string; gas: string; matches: boolean }>;
  fabricationTx: string | null;
  factory: { address: string | null; sealed: string | null; owner: string | null };
}

export interface ForkPolicies {
  file: string;
  sourceChainId: string;
  sourceBlock: string;
  processor: string;
  /** Fabrication fee per circuit observed on the fork, in wei of the native token. Null when not recorded. */
  fabricationFeeWei: bigint | null;
  policies: Array<{ kind: string; circuitId: string; netlistHash: string; gates: string; fabricationGas: string; vectors: number; policyId: string | null }>;
}

export interface ForkReceipt {
  hash: string;
  block: string;
  gasUsed: string;
  amount: string | null;
}

export interface ForkSettlement {
  file: string;
  label: string;
  pinnedBlock: string;
  processor: string;
  account: string;
  controller: string;
  borrow: ForkReceipt;
  evaluations: Array<{ circuitId: string; context: string; gasUsed: string; allow: boolean | null }>;
  accountDenial: ForkReceipt & { selector: string };
  marketDenial: ForkReceipt & { selector: string };
}

function parsePublicSample(): Maybe<PublicSample> {
  const source = RAW_EVIDENCE.mainnetReads;
  const root = rec(source.json);
  const circuit = rec(root?.circuit);
  if (!source.file || !root || !circuit) return unavailable("evidence/a1/mainnet-reads.json is not available in this build");
  const dims = arr(circuit.dimensions).map(str);
  const processor = str(circuit.processor);
  const netlistHash = str(circuit.netlistHash);
  if (root.chainId !== 196 || !processor || !netlistHash || dims.length < 4) return unavailable("Mainnet read evidence has an unexpected shape");
  const factory = rec(root.factory);
  const code = arr(root.code).map(rec);
  return ok({
    file: source.file,
    chainId: 196,
    block: str(root.block) ?? "unknown",
    processor,
    circuitId: str(circuit.id) ?? "unknown",
    dimensions: { nIn: dims[0] ?? "?", nOut: dims[1] ?? "?", nState: dims[2] ?? "?", gates: dims[3] ?? "?" },
    netlistHash,
    vectors: arr(circuit.vectors).flatMap((entry) => {
      const vector = rec(entry);
      const input = str(vector?.input);
      const output = str(vector?.output);
      const reference = str(vector?.reference);
      if (!vector || input === null || output === null || reference === null) return [];
      return [{ input, output, reference, gas: str(vector.gasEstimate) ?? "?", matches: output === reference }];
    }),
    fabricationTx: str(rec(circuit.historicalFabrication)?.tx),
    factory: { address: str(code[0]?.address), sealed: str(factory?.["isSealed()(bool)"]), owner: str(factory?.["owner()(address)"]) },
  });
}

function parseForkPolicies(): Maybe<ForkPolicies> {
  const source = RAW_EVIDENCE.forkPolicies;
  const root = rec(source.json);
  const processor = str(root?.processor);
  if (!source.file || !root || !processor) return unavailable("evidence/a1/fork-policy-evaluations.json is not available in this build");
  const registered = arr(rec(root.peridotAdapter)?.policies).map(rec);
  return ok({
    file: source.file,
    sourceChainId: str(root.sourceChainId) ?? "?",
    sourceBlock: str(root.sourceBlock) ?? "?",
    processor,
    fabricationFeeWei: /^\d+$/.test(str(root.fabricationFeeWeiPerCircuit) ?? "") ? BigInt(str(root.fabricationFeeWeiPerCircuit)!) : null,
    policies: arr(root.policies).flatMap((entry, index) => {
      const policy = rec(entry);
      if (!policy) return [];
      return [
        {
          kind: str(policy.kind) ?? "?",
          circuitId: str(policy.id) ?? "?",
          netlistHash: str(policy.netlistHash) ?? "?",
          gates: str(policy.nandBurned) ?? "?",
          fabricationGas: str(rec(policy.fabrication)?.gasUsed) ?? "?",
          vectors: arr(policy.vectors).length,
          policyId: str(registered[index]?.policyId),
        },
      ];
    }),
  });
}

function receipt(value: unknown): ForkReceipt | null {
  const r = rec(value);
  const hash = str(r?.hash);
  if (!r || !hash) return null;
  return { hash, block: str(r.block) ?? "?", gasUsed: str(r.gasUsed) ?? "?", amount: str(r.amount) };
}

function parseForkSettlement(): Maybe<ForkSettlement> {
  const source = RAW_EVIDENCE.forkSettlement;
  const root = rec(source.json);
  const borrow = receipt(root?.borrowReceipt);
  const accountDenial = receipt(root?.accountDenial);
  const marketDenial = receipt(root?.directMarketDenial);
  if (!source.file || !root || !borrow || !accountDenial || !marketDenial) return unavailable("Fork settlement evidence is not available in this build");
  const selector = (value: unknown) => (str(rec(value)?.returnData) ?? "").slice(0, 10);
  return ok({
    file: source.file,
    label: str(root.label) ?? "Local fork",
    pinnedBlock: str(rec(root.source)?.pinnedBlock) ?? "?",
    processor: str(root.processor) ?? "?",
    account: str(root.account) ?? "?",
    controller: str(root.controller) ?? "?",
    borrow,
    evaluations: arr(root.borrowContextEvaluations).flatMap((entry) => {
      const evaluation = rec(entry);
      if (!evaluation) return [];
      const output = str(evaluation.output) ?? "";
      // ABI bytes return: offset, length 1, one data byte (01 allow / 00 deny).
      const allow = output.length === 194 ? output.slice(130, 132) === "01" : null;
      return [{ circuitId: str(evaluation.circuitId) ?? "?", context: str(evaluation.context) ?? "?", gasUsed: str(evaluation.gasUsed) ?? "?", allow }];
    }),
    accountDenial: { ...accountDenial, selector: selector(root.accountDenial) },
    marketDenial: { ...marketDenial, selector: selector(root.directMarketDenial) },
  });
}

export const LOCAL_LABEL = "Local development chain (Anvil 31337) with the development reference processor — not TapeOut, not a public transaction";

export interface LocalAutoRepay {
  file: string;
  label: string;
  account: string;
  operator: string;
  hash: string;
  block: string;
  gasUsed: string;
  status: string;
  amountRaw: bigint;
  decimals: number;
  ltvBeforeBps: number;
  ltvAfterBps: number;
}

function parseLocalAutoRepay(): Maybe<LocalAutoRepay> {
  const source = RAW_EVIDENCE.localAutoRepay;
  const root = rec(source.json);
  const r = rec(root?.receipt);
  const event = rec(root?.event);
  const hash = str(r?.hash);
  const amount = str(event?.amount);
  const before = Number(str(event?.ltvBeforeBps));
  const after = Number(str(event?.ltvAfterBps));
  const decimals = root?.debtAssetDecimals;
  if (!source.file || !root || !r || !hash || !amount || !/^\d+$/.test(amount) || !Number.isInteger(before) || !Number.isInteger(after) || typeof decimals !== "number") {
    return unavailable("Local auto-repay evidence is not available in this build");
  }
  return ok({
    file: source.file,
    label: str(root.label) ?? "Local Anvil simulation",
    account: str(root.account) ?? "?",
    operator: str(event?.operator) ?? "?",
    hash,
    block: str(r.block) ?? "?",
    gasUsed: str(r.gasUsed) ?? "?",
    status: str(r.status) ?? "?",
    amountRaw: BigInt(amount),
    decimals,
    ltvBeforeBps: before,
    ltvAfterBps: after,
  });
}

export const EVIDENCE = {
  localAutoRepay: parseLocalAutoRepay(),
  publicSample: parsePublicSample(),
  forkPolicies: parseForkPolicies(),
  forkSettlement: parseForkSettlement(),
};

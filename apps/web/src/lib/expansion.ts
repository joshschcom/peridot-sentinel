/**
 * Sentinel v2 (the additive expansion: typed adapters, swap, enumerable operators) on X Layer testnet 1952.
 *
 * Sources, all optional (absent or malformed = the feature is hidden, never guessed):
 *   packages/chain-config/expansion/deployments/1952.json   public v2 manifest (addresses, runtime code hashes, labels)
 *   evidence/session6-v2/1952.json                          recorded public receipts of the v2 demo account
 *   evidence/session6-rejections/public-1952.json           two mined reverts (account-only and market-only denial)
 *
 * Rules this module encodes:
 *   - The swap venue on testnet is an inventory-backed MOCK. It is never called Uniswap. The real Uniswap v3 route was
 *     verified on a mainnet fork only (evidence/session5-swap) and is labelled as that.
 *   - An OWNER action is never presented as operator execution, and a SIMULATED rejection never as a MINED revert.
 *   - v2 writes are not offered by this app: the manifest carries `uiEnabled: false`, and no write has been verified
 *     from a browser wallet on 1952. Everything here is a read or a recorded receipt.
 */
import { RAW_CONFIG } from "../generated/config.ts";
import { RAW_EVIDENCE } from "../generated/evidence.ts";
import { type ParsedCoverage, inCheckedSegment, parseCoverage } from "./activity-coverage.ts";
import { type Maybe, ok, unavailable } from "./maybe.ts";

export const V2_SWAP_LABEL = "Mock swap on testnet; real Uniswap v3 verified on mainnet fork";
export const V2_SCOPE_LABEL = "X Layer testnet 1952: mock tokens, mock price source, inventory-backed mock swap venue, development reference processor (not TapeOut)";
/** v2 grant operation ids (INTERFACES_V2). They are NOT the v1 permission-mask bits. */
export const V2_OP = { SUPPLY: 0, REDEEM: 1, BORROW: 2, REPAY: 3, SWAP: 5 } as const;
export const V2_OP_LABEL: Record<number, string> = { 0: "Supply", 1: "Withdraw (shares)", 2: "Borrow", 3: "Repay", 5: "Swap (exact input)" };

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const address = (value: unknown): `0x${string}` | null => (typeof value === "string" && ADDRESS.test(value) ? (value as `0x${string}`) : null);
const hash = (value: unknown): `0x${string}` | null => (typeof value === "string" && HASH.test(value) ? (value as `0x${string}`) : null);
const uint = (value: unknown): bigint | null => (typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null);

/* ---------- manifest ---------- */

export const V2_CONTRACTS = ["mockWokb", "mockUsdc", "mockOracle", "cpu", "execution", "source", "venue", "swap", "lending", "factory", "account"] as const;
export type V2ContractName = (typeof V2_CONTRACTS)[number];
export interface ExpansionManifest {
  file: string;
  chainId: 1952;
  label: string;
  /** The contracts team's own switch. False = this app offers no v2 write. */
  uiEnabled: boolean;
  contracts: Record<V2ContractName, `0x${string}`>;
  runtimeCodeHashes: Record<V2ContractName, `0x${string}`>;
  m4Controller: `0x${string}`;
  processorMode: string;
  tokens: { wokb: { address: `0x${string}`; symbol: "mWOKB"; decimals: number }; usdc: { address: `0x${string}`; symbol: "mUSDC"; decimals: number } };
  swap: { feePpm: number; hardMaxLossBps: number; policyMaxLossBps: number };
  /** The deployment's OWNER setup swap. Never operator execution. */
  ownerSetupSwap: { hash: `0x${string}`; block: bigint; amountIn: bigint; amountOut: bigint } | null;
  /** An eth_call simulation recorded at deployment: a 101 bps swap denied by the execution circuit. Nothing mined. */
  simulatedDenial: { block: bigint; lossBps: number; selector: string } | null;
}

export function parseExpansionManifest(json: unknown, file: string): Maybe<ExpansionManifest> {
  const root = rec(json);
  if (!root) return unavailable("No Sentinel v2 deployment manifest for X Layer testnet in this build");
  if (root.chainId !== 1952 || root.schemaVersion !== 2) return unavailable("The Sentinel v2 manifest is not a schema-2 manifest for chain 1952");
  const contracts = rec(root.contracts);
  const hashes = rec(root.runtimeCodeHashes);
  const swap = rec(root.swap);
  const names: Partial<Record<V2ContractName, `0x${string}`>> = {};
  const codes: Partial<Record<V2ContractName, `0x${string}`>> = {};
  for (const name of V2_CONTRACTS) {
    const at = address(contracts?.[name]);
    const code = hash(hashes?.[name]);
    if (!at || !code) return unavailable(`The Sentinel v2 manifest has no valid address and code hash for "${name}"`);
    names[name] = at;
    codes[name] = code;
  }
  const controller = address(rec(root.m4)?.controller);
  // The processor on testnet must be declared as the development reference one. Anything else is not this deployment.
  const mode = rec(root.execution)?.mode;
  if (!controller || mode !== "development-reference") return unavailable("The Sentinel v2 manifest does not declare the v1 market or the development reference processor");
  if (!swap || typeof swap.feePpm !== "number" || typeof swap.hardMaxLossBps !== "number" || typeof swap.policyMaxLossBps !== "number" || typeof swap.mockWokbDecimals !== "number" || typeof swap.mockUsdcDecimals !== "number") return unavailable("The Sentinel v2 manifest has no swap configuration");
  // The label must say what the venue is. A manifest that does not call it a mock is refused rather than relabelled.
  if (typeof root.label !== "string" || !/mock/i.test(root.label)) return unavailable("The Sentinel v2 manifest does not label its swap venue as a mock");
  const setupHash = hash(swap.receipt);
  const setupBlock = uint(swap.block);
  const amountIn = uint(swap.amountIn);
  const amountOut = uint(swap.amountOut);
  const denial = rec(swap.denial);
  const denialBlock = uint(denial?.block);
  return ok({
    file,
    chainId: 1952,
    label: root.label,
    uiEnabled: root.uiEnabled === true,
    contracts: names as Record<V2ContractName, `0x${string}`>,
    runtimeCodeHashes: codes as Record<V2ContractName, `0x${string}`>,
    m4Controller: controller,
    processorMode: mode,
    tokens: { wokb: { address: names.mockWokb!, symbol: "mWOKB", decimals: swap.mockWokbDecimals }, usdc: { address: names.mockUsdc!, symbol: "mUSDC", decimals: swap.mockUsdcDecimals } },
    swap: { feePpm: swap.feePpm, hardMaxLossBps: swap.hardMaxLossBps, policyMaxLossBps: swap.policyMaxLossBps },
    ownerSetupSwap: setupHash && setupBlock !== null && amountIn !== null && amountOut !== null ? { hash: setupHash, block: setupBlock, amountIn, amountOut } : null,
    simulatedDenial: denial && denial.method === "eth_call" && denialBlock !== null && typeof denial.lossBps === "number" && typeof denial.revertSelector === "string" ? { block: denialBlock, lossBps: denial.lossBps, selector: denial.revertSelector } : null,
  });
}

/* ---------- recorded public receipts of the demo account ---------- */

interface Receipt {
  hash: `0x${string}`;
  block: bigint;
  gasUsed: bigint;
  from: `0x${string}`;
}
export interface V2Demo {
  file: string;
  account: `0x${string}`;
  operator: `0x${string}`;
  owner: `0x${string}`;
  ownerSupply: (Receipt & { rawInput: bigint; sharesAfter: bigint }) | null;
  grant: (Receipt & { op: number; maxPerCall: bigint; cumulative: bigint; expiry: bigint }) | null;
  /** A MINED revert: the transaction is on chain with status "reverted". */
  minedDenial: (Receipt & { error: string; lossBps: number; policyMaxBps: number }) | null;
  /** OPERATOR execution under the swap-only grant, through the mock venue, output paid to the account. */
  /** The owner's emergency stop: revokeAllOperators(). An OWNER action; afterwards the account lists no operator. */
  emergencyRevoke: (Receipt & { operatorCountAfter: bigint; newEpoch: bigint }) | null;
  operatorSwap: (Receipt & { amountIn: bigint; amountOut: bigint; tokenIn: `0x${string}`; tokenOut: `0x${string}`; remaining: bigint; recipient: `0x${string}` }) | null;
}

function receipt(value: unknown, status: "success" | "reverted", to: string): (Receipt & { raw: Rec }) | null {
  const r = rec(value);
  const h = hash(r?.hash);
  const block = uint(r?.block);
  const gas = uint(r?.gasUsed);
  const from = address(r?.from);
  // Each record must be a transaction to the demo account with the status its row claims.
  if (!r || !h || block === null || gas === null || !from || r.status !== status || address(r.to)?.toLowerCase() !== to.toLowerCase()) return null;
  return { hash: h, block, gasUsed: gas, from, raw: r };
}

export function parseV2Demo(json: unknown, file: string | null): Maybe<V2Demo> {
  const root = rec(json);
  const account = address(root?.account);
  const operator = address(root?.operator);
  if (!file || !root || root.chainId !== 1952 || root.public !== true || !account || !operator) return unavailable("No recorded Sentinel v2 testnet receipts in this build");
  const supply = receipt(root.ownerSupply, "success", account);
  const grant = receipt(root.grant, "success", account);
  const denial = receipt(root.denial, "reverted", account);
  const swap = receipt(root.operatorSwap, "success", account);
  const revoke = receipt(root.emergencyRevoke, "success", account);
  const countAfter = uint(revoke?.raw.operatorCount);
  const epoch = uint(revoke?.raw.newEpoch);
  const owner = supply?.from ?? grant?.from ?? null;
  if (!owner) return unavailable("The recorded Sentinel v2 receipts do not identify the account owner");
  const event = rec(swap?.raw.event);
  const replay = rec(denial?.raw.replay);
  const pick = <T,>(value: T | null): T | null => value;
  const base = (r: (Receipt & { raw: Rec }) | null): Receipt | null => (r ? { hash: r.hash, block: r.block, gasUsed: r.gasUsed, from: r.from } : null);
  const supplyInput = uint(supply?.raw.rawInput);
  const supplyShares = uint(supply?.raw.sharesAfter);
  const perCall = uint(grant?.raw.maxPerCall);
  const cumulative = uint(grant?.raw.cumulative);
  const expiry = uint(grant?.raw.expiry);
  const amountIn = uint(event?.amountIn);
  const amountOut = uint(event?.amountOut);
  const remaining = uint(swap?.raw.remaining);
  return ok({
    file,
    account,
    operator,
    owner,
    ownerSupply: pick(supply && supplyInput !== null && supplyShares !== null && supply.from.toLowerCase() !== operator.toLowerCase() ? { ...base(supply)!, rawInput: supplyInput, sharesAfter: supplyShares } : null),
    grant: pick(grant && typeof grant.raw.op === "number" && perCall !== null && cumulative !== null && expiry !== null ? { ...base(grant)!, op: grant.raw.op, maxPerCall: perCall, cumulative, expiry } : null),
    minedDenial: pick(denial && typeof replay?.error === "string" && typeof denial.raw.lossBps === "number" && typeof denial.raw.policyMaxBps === "number" ? { ...base(denial)!, error: replay.error, lossBps: denial.raw.lossBps, policyMaxBps: denial.raw.policyMaxBps } : null),
    // Only the owner can stop everything: a "revoke" sent by the operator is not shown as the owner's emergency stop.
    emergencyRevoke: pick(revoke && revoke.from.toLowerCase() === owner.toLowerCase() && countAfter !== null && epoch !== null ? { ...base(revoke)!, operatorCountAfter: countAfter, newEpoch: epoch } : null),
    // Operator execution only if the OPERATOR sent it and the output went to the ACCOUNT.
    operatorSwap: pick(swap && swap.from.toLowerCase() === operator.toLowerCase() && amountIn !== null && amountOut !== null && remaining !== null && address(event?.tokenIn) && address(event?.tokenOut) && address(swap.raw.recipient)?.toLowerCase() === account.toLowerCase() ? { ...base(swap)!, amountIn, amountOut, tokenIn: address(event?.tokenIn)!, tokenOut: address(event?.tokenOut)!, remaining, recipient: account } : null),
  });
}

/* ---------- mined independent rejections (v1 lending, public testnet) ---------- */

export interface MinedRejection {
  market: string;
  controller: `0x${string}`;
  account: `0x${string}`;
  hash: `0x${string}`;
  block: bigint;
  gasUsed: bigint;
  amountRaw: bigint;
  postLtvBps: number;
  /** Decoded custom error of the mined revert. */
  error: "AccountPolicyRejected" | "MarketPolicyRejected";
  /** What each circuit answered for the same context: the independence of the two layers. */
  marketOutput: string;
  accountOutput: string;
  debtUnchanged: boolean;
}

export function parseMinedRejections(json: unknown, file: string | null): Maybe<{ file: string; label: string; rejections: MinedRejection[] }> {
  const root = rec(json);
  // `fork: null` is what makes this a public record. A file that names a fork is not shown as mined on testnet.
  if (!file || !root || root.chainId !== 1952 || root.fork !== null || !Array.isArray(root.rejections)) return unavailable("No mined public testnet rejections in this build");
  const rejections: MinedRejection[] = [];
  for (const item of root.rejections) {
    const r = rec(item);
    const reverted = rec(r?.minedRevert);
    const decisions = Array.isArray(r?.decisions) ? r.decisions.map(rec) : [];
    const market = decisions.find((entry) => entry?.role === "MARKET");
    const account = decisions.find((entry) => entry?.role === "ACCOUNT");
    const h = hash(r?.hash);
    const block = uint(r?.block);
    const gas = uint(r?.gasUsed);
    const amount = uint(r?.amountRaw);
    const ltv = uint(r?.postLtvBps);
    const name = reverted?.name;
    // A row is kept only if it is a reverted, log-less transaction with a decoded policy error and both circuit outputs.
    if (!r || !h || block === null || gas === null || amount === null || ltv === null || r.status !== "reverted" || r.logs !== 0 || (name !== "AccountPolicyRejected" && name !== "MarketPolicyRejected") || typeof market?.output !== "string" || typeof account?.output !== "string" || !address(r.controller) || !address(r.account)) continue;
    // Independence: exactly the layer named by the error said 00, and the other said 01.
    const expected = name === "AccountPolicyRejected" ? ["0x01", "0x00"] : ["0x00", "0x01"];
    if (market.output !== expected[0] || account.output !== expected[1]) continue;
    rejections.push({ market: String(r.market ?? "?"), controller: address(r.controller)!, account: address(r.account)!, hash: h, block, gasUsed: gas, amountRaw: amount, postLtvBps: Number(ltv), error: name, marketOutput: market.output, accountOutput: account.output, debtUnchanged: typeof r.storedDebtBefore === "string" && r.storedDebtBefore === r.storedDebtAfter });
  }
  if (rejections.length === 0) return unavailable("The mined public testnet rejections could not be read");
  return ok({ file, label: typeof root.label === "string" ? root.label : "Public X Layer testnet 1952", rejections });
}

/* ---------- indexed activity snapshot ---------- */

export interface SnapshotEvent {
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: bigint;
  address: `0x${string}`;
  contract: string;
  eventName: string;
  args: Rec;
  timestamp: bigint | null;
}
export interface ActivitySnapshot {
  file: string;
  chainId: 1952;
  updatedAt: string;
  fromBlock: bigint;
  toBlock: bigint;
  /** Hash of the last covered block. The browser re-reads it before the snapshot is called canonical. */
  toBlockHash: `0x${string}`;
  status: string;
  /**
   * The checked segments and the gaps. `fromBlock`/`toBlock` above are only the outer envelope: with more than one
   * segment it is NOT a checked range, and nothing may present it as one.
   */
  coverage: ParsedCoverage;
  confirmations: number | null;
  /** The contracts the indexer followed, each from its own first block. A contract not listed here is not covered. */
  sources: Array<{ address: `0x${string}`; fromBlock: bigint }>;
  events: SnapshotEvent[];
}

export function parseActivitySnapshot(json: unknown, file: string): Maybe<ActivitySnapshot> {
  const root = rec(json);
  const coverage = rec(root?.coverage);
  const from = uint(coverage?.fromBlock);
  const to = uint(coverage?.toBlock);
  const terminal = hash(coverage?.toBlockHash);
  if (!root || root.schemaVersion !== 1 || root.kind !== "indexed-event-snapshot" || root.chainId !== 1952 || typeof root.updatedAt !== "string" || from === null || to === null || to < from || !terminal || !Array.isArray(root.events)) return unavailable("No indexed activity snapshot for X Layer testnet in this build");
  // Segments and gaps (M10-activity-recovery). A legacy file is one configured segment. Contradictory coverage is refused.
  const checked = parseCoverage(root.coverage);
  if (!checked) return unavailable("The indexed activity snapshot states its coverage in a form this app cannot verify");
  const events: SnapshotEvent[] = [];
  for (const item of root.events) {
    const e = rec(item);
    const block = uint(e?.blockNumber);
    const tx = hash(e?.transactionHash);
    const index = uint(e?.logIndex);
    const at = address(e?.address);
    // One malformed or out-of-range event makes the whole snapshot unusable: a partial list would look complete.
    if (!e || block === null || !tx || index === null || !at || typeof e.eventName !== "string" || typeof e.contract !== "string" || block < from || block > to || !inCheckedSegment(checked, block)) return unavailable("The indexed activity snapshot has an event outside its checked block ranges or in an unknown format");
    events.push({ blockNumber: block, transactionHash: tx, logIndex: index, address: at, contract: e.contract, eventName: e.eventName, args: rec(e.args) ?? {}, timestamp: uint(e.timestamp) });
  }
  const sources: ActivitySnapshot["sources"] = [];
  for (const item of Array.isArray(root.sources) ? root.sources : []) {
    const source = rec(item);
    const at = address(source?.address);
    const first = uint(source?.fromBlock);
    if (!at || first === null) return unavailable("The indexed activity snapshot lists a source in an unknown format");
    sources.push({ address: at, fromBlock: first });
  }
  return ok({ file, chainId: 1952, updatedAt: root.updatedAt, fromBlock: from, toBlock: to, toBlockHash: terminal, status: typeof coverage?.status === "string" ? coverage.status : "unknown", coverage: checked, confirmations: typeof coverage?.confirmations === "number" ? coverage.confirmations : null, sources, events });
}

export const EXPANSION = {
  manifest: parseExpansionManifest(RAW_CONFIG.expansion.byChain["1952"], `${RAW_CONFIG.expansion.dir}/1952.json`),
  demo: parseV2Demo(RAW_EVIDENCE.v2Demo.json, RAW_EVIDENCE.v2Demo.file),
  minedRejections: parseMinedRejections(RAW_EVIDENCE.publicRejections.json, RAW_EVIDENCE.publicRejections.file),
  snapshot: parseActivitySnapshot(RAW_CONFIG.activity.byChain["1952"], `${RAW_CONFIG.activity.dir}/1952.json`),
};

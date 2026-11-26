/**
 * Service boundary (INTERFACES v1 + milestone notices M1-M3).
 * Every service has a `fixture` and a `chain` implementation behind these interfaces.
 * All methods are async and all token quantities are bigint in raw units.
 */
import type { RawError } from "../lib/errors.ts";
import type { Maybe } from "../lib/maybe.ts";
import type { AccountPolicySpec, CompiledPolicy, Hex, LocalEvaluation, MarketPolicySpec, OpId, PolicySpec } from "../lib/policy.ts";

export type Address = `0x${string}`;
export type DataSource = "fixture" | "chain";
export type ServiceName = "wallet" | "market" | "account" | "policy" | "activity";

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  address: Maybe<Address>;
  /** Test token without real value. */
  mock: boolean;
}

export interface PriceInfo {
  /** USD per whole token, 1e18-scaled (test feed convention). */
  usdE18: bigint;
  fresh: boolean;
  updatedAt: string;
  feed: string;
}

export interface MarketLimits {
  borrowLtvBps: number;
  liquidationLtvBps: number;
  collateralSupplyCap: bigint;
  debtSupplyCap: bigint;
  borrowCap: bigint;
  minCash: bigint;
}

export type ProcessorKind = "official" | "development-reference" | "self-deployed-reference";

export interface PolicyRegistration {
  policyId: Hex;
  chainId: number;
  processor: Address;
  processorKind: ProcessorKind;
  circuitId: bigint;
  publisher: Address;
}

export interface PolicyRecord<S extends PolicySpec = PolicySpec> {
  /**
   * False when a registered policy's rules could not be recovered: the registry stores hashes only, and rules are
   * shown only if a compiled candidate matches BOTH configHash and netlistHash. `spec` is then a placeholder and
   * must not be displayed.
   */
  identified: boolean;
  spec: S;
  /** Compiled locally with @peridot/circuit-sdk: deterministic config hash, netlist hash and gate count. */
  compiled: Maybe<CompiledPolicy>;
  /** On-chain registry entry. Unavailable until the policy is registered on a deployed registry. */
  registration: Maybe<PolicyRegistration>;
}

export interface Market {
  /** Controller address on chain. Fixture markets use an `example-<n>` id. */
  id: string;
  index: number;
  controller: Maybe<Address>;
  owner: Maybe<Address>;
  ownedByViewer: boolean;
  /** Created markets start inactive. Activation needs seeded liquidity, a valid feed and the owner's activate(). */
  active: boolean;
  createdAt: string;
  limits: MarketLimits;
  policy: PolicyRecord<MarketPolicySpec>;
  collateral: {
    token: TokenInfo;
    pToken: Maybe<Address>;
    totalSupplied: Maybe<bigint>;
    price: Maybe<PriceInfo>;
  };
  debt: {
    token: TokenInfo;
    pToken: Maybe<Address>;
    totalSupplied: Maybe<bigint>;
    totalBorrowed: Maybe<bigint>;
    cash: Maybe<bigint>;
    price: Maybe<PriceInfo>;
    /** Annualised rates in basis points, from the interest model. Display only. */
    supplyAprBps: Maybe<number>;
    borrowAprBps: Maybe<number>;
  };
}

/** `sentinel`: the user's Sentinel account acts. `direct`: the connected wallet calls the market itself. */
export type ActingPath = "sentinel" | "direct";
export type Leg = "collateral" | "debt";

export interface Position {
  marketId: string;
  path: ActingPath;
  holder: Maybe<Address>;
  /** Collateral supplied, in underlying units (chain: shares x exchange rate, accrued book state). */
  collateralSupplied: bigint;
  collateralEntered: boolean;
  /** Debt-asset liquidity lent to the market, in underlying units. */
  lent: bigint;
  debt: bigint;
  /** Funds held by the holder and not supplied: wallet balance, or idle balance of the Sentinel account. */
  idleCollateral: bigint;
  idleDebtAsset: bigint;
}

export interface OperatorGrant {
  operator: Maybe<Address>;
  label: string;
  /** Bit `1 << op`. Sentinel v1 uses borrow (4) and auto-repay (8). */
  opsMask: number;
  /** Budget still available, in raw debt-asset units. On chain this is the authoritative `operators(operator).remaining`. */
  remaining: bigint;
  /** Budget of the latest grant. Unavailable when the grant's OperatorSet event is outside the scanned log window. */
  granted: Maybe<bigint>;
  expiresAt: string;
  expired: boolean;
  revoked: boolean;
}

export interface SentinelAccount {
  marketId: string;
  address: Maybe<Address>;
  owner: Maybe<Address>;
  policy: PolicyRecord<AccountPolicySpec>;
  /** Auto-repay trigger as LTV in bps. 0 disables auto-repay. */
  autoRepayTriggerBps: number;
  operators: OperatorGrant[];
  /**
   * Chain mode: how the operator list was found. Grants live in a mapping, so candidates come from OperatorSet events
   * in the block ranges that were read. `complete` false (or `failed`) means an operator authorised in unread blocks
   * can exist without being listed. Absent in fixture mode.
   */
  operatorDiscovery?: { complete: boolean; failed: boolean; coverage?: LogCoverage };
  position: Position;
}

export interface OperationRequest {
  marketId: string;
  path: ActingPath;
  op: OpId;
  leg: Leg;
  /** Raw underlying units of the leg's token. */
  amount: bigint;
}

export type CheckId = "balance" | "account-policy" | "protocol" | "market-policy";
/** `unknown`: not evaluated, because an earlier check already decided the outcome on chain. */
export type CheckStatus = "pass" | "fail" | "not-applicable" | "unknown";

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  detail: string;
  /** Set on the first failing check in on-chain evaluation order: the error the transaction would revert with. */
  decisive: boolean;
  /**
   * How the status was established. `simulation`: the eth_call of the real entrypoint (chain mode).
   * `local-preview`: the reference evaluator run in the browser on the same inputs; never a chain result.
   */
  basis?: "simulation" | "local-preview" | "none";
  evaluation?: LocalEvaluation;
  error?: RawError;
}

export type RejectionSource = "account-policy" | "market-policy" | "protocol" | "policy-unavailable" | "balance";

export interface OperationPreview {
  source: DataSource;
  /** How this preview was produced. Fixture: "Local preview (reference evaluator)". Chain: previewPolicy + eth_call as the sender. */
  method: string;
  request: OperationRequest;
  /** Whether discretionary policy circuits apply to this operation at all (INTERFACES v1). */
  applies: boolean;
  ltvBeforeBps: Maybe<number>;
  ltvAfterBps: Maybe<number>;
  context: Maybe<{ op: OpId; oracleFresh: boolean; postLtvBps: number; cashOk: boolean; inputs: Hex }>;
  checks: CheckResult[];
  outcome: { status: "allowed" } | { status: "rejected"; by: RejectionSource; error: RawError };
}

export type ActivityEvidence =
  /** eth_call / local evaluation. Nothing was sent. */
  | "simulation"
  | "mined-success"
  /** A transaction that was mined and reverted. Reverts leave no events: evidence is the receipt. */
  | "mined-revert";

export interface ActivityEntry {
  id: string;
  at: string;
  actor: "owner" | "operator";
  /** Proposals are keeper/owner simulations. Executions were submitted. */
  kind: "proposal" | "execution";
  title: string;
  marketId: string;
  amount?: { value: bigint; token: TokenInfo };
  result: "allowed" | "rejected" | "failed";
  evidence: ActivityEvidence;
  error?: RawError;
  detail?: string;
  txHash: Maybe<Hex>;
  /**
   * Chain mode on a target with an indexed snapshot: where this row was read from. "scan" is this page's own log
   * scan, "snapshot" the indexed snapshot shipped with the build, "both" a row found by both (shown once).
   */
  source?: "scan" | "snapshot" | "both";
}

export interface PolicyTemplate {
  templateId: PolicySpec["templateId"];
  kind: PolicySpec["kind"];
  title: string;
  summary: string;
  sample: PolicyRecord;
}

/* ---------- services ---------- */

export interface ServiceMeta {
  readonly source: DataSource;
}

export interface MarketService extends ServiceMeta {
  listMarkets(): Promise<Maybe<Market[]>>;
  /** ok(null): the source answered and there is no such market. */
  getMarket(id: string): Promise<Maybe<Market | null>>;
  /** Position of the connected wallet acting directly. Unavailable when there is nothing to read from. */
  getDirectPosition(marketId: string): Promise<Maybe<Position>>;
  previewOperation(request: OperationRequest): Promise<OperationPreview>;
}

export interface AccountService extends ServiceMeta {
  /** null: the owner has no Sentinel account for this market yet. */
  getAccount(marketId: string): Promise<Maybe<SentinelAccount | null>>;
  listAccounts(): Promise<Maybe<SentinelAccount[]>>;
}

export interface PolicyService extends ServiceMeta {
  listTemplates(): Promise<PolicyTemplate[]>;
  listRegistered(): Promise<Maybe<PolicyRecord[]>>;
}

export interface LogCoverage {
  ranges: Array<{ from: bigint; to: bigint }>;
  complete: boolean;
}

export interface ActivityFeed {
  entries: ActivityEntry[];
  /**
   * Chain mode: the block ranges the events were read from, oldest first. `complete` is false when blocks between
   * the deployment block and the head were not read (see `scanPlan`); the UI must say which.
   */
  coverage?: LogCoverage;
  /** The ranges this page's own scan read, when `coverage` also counts the snapshot's range. */
  scanRanges?: Array<{ from: bigint; to: bigint }>;
  /** Blocks from the deployment block to `head` that no source covers. Empty when `coverage.complete`. */
  gaps?: Array<{ from: bigint; to: bigint }>;
  head?: bigint;
  /**
   * The indexed snapshot's part in this list. "merged": its last block was re-read and matches, its events are in
   * the list and its range counts as read. "events-only": events are in the list, but it does not index every
   * contract of this list, so its range is NOT counted. "not-canonical" / "unverified": nothing of it is used.
   */
  snapshot?: { file: string; fromBlock: bigint; toBlock: bigint; updatedAt: string; state: "merged" | "events-only" | "not-canonical" | "unverified"; added: number; shared: number; skipped: number; unindexed: number };
}

export interface ActivityService extends ServiceMeta {
  list(): Promise<Maybe<ActivityFeed>>;
}

export interface WalletConnectorInfo {
  id: string;
  name: string;
  icon?: string;
}

export type WalletState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; address: Address; chainId: number; connectorName: string };

export interface WalletService extends ServiceMeta {
  getState(): WalletState;
  subscribe(listener: () => void): () => void;
  listConnectors(): WalletConnectorInfo[];
  connect(connectorId: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Only ever targets the write chain (X Layer testnet 1952). */
  switchToWriteChain(): Promise<void>;
}

export interface Services {
  wallet: WalletService;
  market: MarketService;
  account: AccountService;
  policy: PolicyService;
  activity: ActivityService;
}

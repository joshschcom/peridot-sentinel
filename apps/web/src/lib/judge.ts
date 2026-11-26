/**
 * The prepared public judge campaign (docs/JUDGE_DEMO.md, "Read-only UI data"): a fresh owner with two Studio markets,
 * two v1 Sentinel accounts and one v2 account on X Layer testnet 1952, with a repay-only grant and a swap-only grant
 * that both expire on a fixed date. The app shows it READ-ONLY: addresses, the grants as prepared, the grants as the
 * chain reports them now, and the campaign's own scoped activity snapshot.
 *
 * Everything here is parsed from `deployments/session7/1952/<campaign>/manifest.json` and the `activity.json` it
 * points at (synced by scripts/sync-manifests.mjs as an allowlist of fields). A file that does not say what the guide
 * says it must (chain 1952, public-testnet profile, matching campaign, mock label) is unavailable, not repaired.
 * All amounts, block numbers and expiries are decimal strings in the files and bigint here.
 */
import { type Maybe, ok, unavailable } from "./maybe.ts";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null);
type Hex = `0x${string}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9]\d{0,77})$/;
const address = (value: unknown): Hex | null => (typeof value === "string" && ADDRESS.test(value) ? (value as Hex) : null);
const hash = (value: unknown): Hex | null => (typeof value === "string" && HASH.test(value) ? (value as Hex) : null);
const uint = (value: unknown): bigint | null => (typeof value === "string" && UINT.test(value) ? BigInt(value) : null);
const bps = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null);

/** The v1 operator permission mask of a repay-only grant, and the v2 operation id of a swap grant. */
export const JUDGE_REPAY_MASK = 8;
export const JUDGE_SWAP_OP = 5;
export const JUDGE_LABEL = "Prepared public campaign on X Layer testnet 1952 · valueless mock tokens, mock price feed, inventory-backed mock venue, development reference processor";

export interface JudgeMarket {
  key: "A" | "B";
  marketId: string;
  controller: Hex;
  debtMarket: Hex;
  collateralMarket: Hex;
  /** The owner's v1 Sentinel account on this market. */
  account: Hex;
  marketPolicy: Hex;
  marketCapBps: number;
  creationTx: Hex;
  creationBlock: bigint;
}
export interface JudgeActivityEvent {
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  address: Hex;
  contract: string;
  eventName: string;
  timestamp: bigint;
}
export interface JudgeActivity {
  file: string;
  updatedAt: string | null;
  fromBlock: bigint;
  toBlock: bigint;
  toBlockHash: Hex;
  /** Head of the chain when the snapshot was refreshed, if recorded. */
  headAtRefresh: bigint | null;
  confirmations: number | null;
  /** Ranges the snapshot itself says it has not covered. */
  gaps: Array<{ fromBlock: bigint; toBlock: bigint; reason: string }>;
  /** Newest first. */
  events: JudgeActivityEvent[];
  transactions: number;
}
export interface JudgeCampaign {
  file: string;
  campaign: string;
  label: string;
  owner: Hex;
  operator: Hex;
  preparedBlock: bigint;
  preparedBlockHash: Hex;
  setupReceiptCount: number | null;
  markets: JudgeMarket[];
  accountCapBps: number;
  debtAsset: Hex;
  collateralAsset: Hex;
  v2: { account: Hex; swapAdapter: Hex; factory: Hex; inputAsset: Hex; outputAsset: Hex };
  /** The grants as they were at the prepared block. Not the current state. */
  repayGrant: { account: Hex; budgetRaw: bigint; expiry: bigint; receipt: Hex | null };
  swapGrant: { account: Hex; perCallRaw: bigint; remainingRaw: bigint; expiry: bigint; receipt: Hex | null };
  /** Unavailable when the manifest names no snapshot or the snapshot does not belong to this campaign. */
  activity: Maybe<JudgeActivity>;
}

function parseActivity(json: unknown, file: string | null, expected: { campaign: string; kind: unknown; schemaVersion: unknown }): Maybe<JudgeActivity> {
  const root = rec(json);
  if (!root || !file) return unavailable("The campaign's activity snapshot is not in this build");
  // docs/JUDGE_DEMO.md: verify kind, schemaVersion, chainId, profile and campaign before showing anything.
  if (root.kind !== "judge-event-snapshot" || root.kind !== expected.kind || root.schemaVersion !== 1 || root.schemaVersion !== expected.schemaVersion || root.chainId !== 1952 || root.profile !== "public-testnet" || root.campaign !== expected.campaign) return unavailable("The activity snapshot does not belong to this campaign on public testnet 1952");
  const coverage = rec(root.coverage);
  const fromBlock = uint(coverage?.fromBlock);
  const toBlock = uint(coverage?.toBlock);
  const toBlockHash = hash(coverage?.toBlockHash);
  if (!coverage || fromBlock === null || toBlock === null || !toBlockHash || toBlock < fromBlock || !Array.isArray(root.events)) return unavailable("The activity snapshot does not state its coverage");
  const gaps: JudgeActivity["gaps"] = [];
  for (const entry of Array.isArray(coverage.gaps) ? coverage.gaps : []) {
    const gap = rec(entry);
    const from = uint(gap?.fromBlock);
    const to = uint(gap?.toBlock);
    if (!gap || from === null || to === null || to < from) return unavailable("The activity snapshot has a gap this app cannot read");
    gaps.push({ fromBlock: from, toBlock: to, reason: typeof gap.reason === "string" ? gap.reason : "unspecified" });
  }
  const events: JudgeActivityEvent[] = [];
  for (const entry of root.events) {
    const event = rec(entry);
    const blockNumber = uint(event?.blockNumber);
    const transactionHash = hash(event?.transactionHash);
    const logIndex = uint(event?.logIndex);
    const at = address(event?.address);
    const timestamp = uint(event?.timestamp);
    if (!event || blockNumber === null || !transactionHash || logIndex === null || !at || timestamp === null || typeof event.contract !== "string" || typeof event.eventName !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event.eventName) || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event.contract)) return unavailable("The activity snapshot has an event this app cannot read");
    // An event outside the range the snapshot claims to cover would make the stated coverage wrong.
    if (blockNumber < fromBlock || blockNumber > toBlock) return unavailable("The activity snapshot lists an event outside its own coverage");
    events.push({ blockNumber, transactionHash, logIndex: Number(logIndex), address: at, contract: event.contract, eventName: event.eventName, timestamp });
  }
  events.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1));
  return ok({
    file,
    updatedAt: typeof root.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(root.updatedAt) ? root.updatedAt : null,
    fromBlock,
    toBlock,
    toBlockHash,
    headAtRefresh: uint(coverage.headAtRefresh),
    confirmations: typeof coverage.confirmations === "number" && Number.isInteger(coverage.confirmations) ? coverage.confirmations : null,
    gaps,
    events,
    transactions: new Set(events.map((event) => event.transactionHash)).size,
  });
}

export function parseJudgeCampaign(json: unknown, file: string | null, activityJson: unknown, activityFile: string | null): Maybe<JudgeCampaign> {
  const root = rec(json);
  if (!root || !file) return unavailable("No prepared judge campaign is in this build");
  if (root.schemaVersion !== 1 || root.chainId !== 1952 || root.profile !== "public-testnet") return unavailable("The judge campaign manifest is not a public testnet (1952) manifest");
  if (typeof root.campaign !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(root.campaign)) return unavailable("The judge campaign manifest has no usable campaign name");
  if (typeof root.label !== "string" || !/mock/i.test(root.label) || !/development reference/i.test(root.label)) return unavailable("The judge campaign manifest does not label its assets as mocks on the development reference processor");
  const owner = address(root.owner);
  const operator = address(root.operator);
  const preparedBlock = uint(root.preparedBlock);
  const preparedBlockHash = hash(root.preparedBlockHash);
  if (!owner || !operator || preparedBlock === null || !preparedBlockHash) return unavailable("The judge campaign manifest does not state its owner, operator or prepared block");
  if (owner.toLowerCase() === operator.toLowerCase()) return unavailable("The judge campaign manifest names the same address as owner and operator");
  const policies = rec(root.policies);
  const base = rec(root.base);
  const debtAsset = address(base?.MockDebt);
  const collateralAsset = address(base?.MockCollateral);
  const accountCapBps = bps(rec(policies?.account)?.capBps);
  if (!debtAsset || !collateralAsset || accountCapBps === null) return unavailable("The judge campaign manifest does not state its assets or its account policy");
  if (rec(policies?.execution)?.mode !== "development-reference") return unavailable("The judge campaign manifest does not declare the development reference processor");
  const markets: JudgeMarket[] = [];
  for (const key of ["A", "B"] as const) {
    const market = rec(rec(root.markets)?.[key]);
    const cap = bps(rec(policies?.[key])?.capBps);
    const parsed = market && {
      controller: address(market.controller),
      debtMarket: address(market.debtMarket),
      collateralMarket: address(market.collateralMarket),
      account: address(market.account),
      marketPolicy: hash(market.marketPolicy),
      creationTx: hash(market.creationTx),
      creationBlock: uint(market.creationBlock),
    };
    if (!market || !parsed || cap === null || typeof market.marketId !== "string" || !UINT.test(market.marketId) || !parsed.controller || !parsed.debtMarket || !parsed.collateralMarket || !parsed.account || !parsed.marketPolicy || !parsed.creationTx || parsed.creationBlock === null) return unavailable(`The judge campaign manifest does not describe market ${key}`);
    if (rec(policies?.[key])?.policyId !== market.marketPolicy) return unavailable(`The judge campaign manifest names two different policies for market ${key}`);
    markets.push({ key, marketId: market.marketId, controller: parsed.controller, debtMarket: parsed.debtMarket, collateralMarket: parsed.collateralMarket, account: parsed.account, marketPolicy: parsed.marketPolicy, marketCapBps: cap, creationTx: parsed.creationTx, creationBlock: parsed.creationBlock });
  }
  const contracts = rec(root.contracts);
  const v2 = { account: address(contracts?.account), swapAdapter: address(contracts?.swap), factory: address(contracts?.factory), inputAsset: address(contracts?.mockWokb), outputAsset: address(contracts?.mockUsdc) };
  if (!v2.account || !v2.swapAdapter || !v2.factory || !v2.inputAsset || !v2.outputAsset) return unavailable("The judge campaign manifest does not describe its v2 account");
  const grants = rec(root.grants);
  const repay = rec(grants?.repay);
  const swap = rec(grants?.swap);
  const receipts = rec(root.grantReceipts);
  const repayGrant = { account: address(repay?.account), budgetRaw: uint(repay?.budgetRaw), expiry: uint(repay?.expiry), receipt: hash(receipts?.repay) };
  const swapGrant = { account: address(swap?.account), perCallRaw: uint(swap?.perCallRaw), remainingRaw: uint(swap?.remainingRaw), expiry: uint(swap?.expiry), receipt: hash(receipts?.swap) };
  if (!repayGrant.account || repayGrant.budgetRaw === null || repayGrant.expiry === null || !swapGrant.account || swapGrant.perCallRaw === null || swapGrant.remainingRaw === null || swapGrant.expiry === null) return unavailable("The judge campaign manifest does not state its two grants");
  // The guide: the repay grant is on the market A borrower, the swap grant on the v2 account.
  if (repayGrant.account.toLowerCase() !== markets[0]!.account.toLowerCase() || swapGrant.account.toLowerCase() !== v2.account.toLowerCase()) return unavailable("The judge campaign manifest's grants are not on the accounts it lists");
  const activityRef = rec(root.activity);
  return ok({
    file,
    campaign: root.campaign,
    label: root.label,
    owner,
    operator,
    preparedBlock,
    preparedBlockHash,
    setupReceiptCount: typeof root.setupReceiptCount === "number" ? root.setupReceiptCount : null,
    markets,
    accountCapBps,
    debtAsset,
    collateralAsset,
    v2: { account: v2.account, swapAdapter: v2.swapAdapter, factory: v2.factory, inputAsset: v2.inputAsset, outputAsset: v2.outputAsset },
    repayGrant: { account: repayGrant.account, budgetRaw: repayGrant.budgetRaw, expiry: repayGrant.expiry, receipt: repayGrant.receipt },
    swapGrant: { account: swapGrant.account, perCallRaw: swapGrant.perCallRaw, remainingRaw: swapGrant.remainingRaw, expiry: swapGrant.expiry, receipt: swapGrant.receipt },
    activity: activityRef ? parseActivity(activityJson, activityFile, { campaign: root.campaign, kind: activityRef.kind, schemaVersion: activityRef.schemaVersion }) : unavailable("The campaign manifest names no activity snapshot"),
  });
}

/** What a grant means for the operator at a given block time. Pure. An expiry equal to the block time has passed. */
export type JudgeGrantState = "ready" | "spent" | "expired" | "revoked" | "unexpected";
export function repayGrantState(grant: { opsMask: number; remaining: bigint; expiry: bigint }, nowSeconds: bigint): JudgeGrantState {
  if (grant.opsMask === 0) return "revoked";
  if (grant.opsMask !== JUDGE_REPAY_MASK) return "unexpected";
  if (grant.expiry <= nowSeconds) return "expired";
  return grant.remaining === 0n ? "spent" : "ready";
}
export function swapGrantState(grant: { maxPerCall: bigint; remaining: bigint; expiry: bigint }, nowSeconds: bigint): JudgeGrantState {
  if (grant.maxPerCall === 0n && grant.remaining === 0n && grant.expiry === 0n) return "revoked";
  if (grant.expiry <= nowSeconds) return "expired";
  return grant.remaining === 0n || grant.maxPerCall === 0n ? "spent" : "ready";
}
export const JUDGE_GRANT_STATE_LABEL: Record<JudgeGrantState, string> = {
  ready: "Usable now",
  spent: "Budget spent",
  expired: "Expired",
  revoked: "Revoked",
  unexpected: "Not the prepared grant",
};

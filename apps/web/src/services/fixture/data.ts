/**
 * FIXTURE / EXAMPLE DATA. Nothing in this file is read from a chain.
 * - Shapes follow INTERFACES v1 and the M2/M3 milestone notices.
 * - Policies are the two sample policies Astra published in packages/circuit-sdk/fixtures/policies-v1.json,
 *   compiled here with the real SDK compiler (config hash, netlist hash and gate count are genuine compiler output).
 * - There are deliberately no addresses and no transaction hashes: fixture records never link to an explorer.
 * - Dates are fixed so screenshots are reproducible.
 */
import { type Maybe, ok, unavailable } from "../../lib/maybe.ts";
import { Op, accountPolicySpec, compileSpec, marketPolicySpec } from "../../lib/policy.ts";
import type { ActivityEntry, Market, PolicyRecord, PolicyTemplate, Position, SentinelAccount, TokenInfo } from "../types.ts";

const NO_ADDRESS = "Example data has no on-chain address";
const NO_TX = "Example entry: no transaction exists";
const NOT_REGISTERED = "Not registered on chain: no registry is deployed";
const none = <T>(reason = NO_ADDRESS): Maybe<T> => unavailable(reason);

const E18 = 10n ** 18n;
const usdc = (whole: bigint, micro = 0n) => whole * 1_000_000n + micro;
const weth = (milli: bigint) => milli * 10n ** 15n;

export const T_WETH: TokenInfo = { symbol: "tWETH", name: "Test Wrapped Ether", decimals: 18, address: none(), mock: true };
export const T_USDC: TokenInfo = { symbol: "tUSDC", name: "Test USD Coin", decimals: 6, address: none(), mock: true };

const FEED = "Test price feed (mock, owner-set)";
const wethPrice = { usdE18: 2_000n * E18, fresh: true, updatedAt: "2026-11-25T09:58:00Z", feed: FEED };
const usdcPrice = { usdE18: 1n * E18, fresh: true, updatedAt: "2026-11-25T09:58:00Z", feed: FEED };

function record<S extends Parameters<typeof compileSpec>[0]>(spec: S): PolicyRecord<S> {
  return { spec, compiled: compileSpec(spec), registration: none(NOT_REGISTERED) };
}

export const MARKET_POLICY_STANDARD = record(marketPolicySpec(6500, true, "Standard market guard"));
export const MARKET_POLICY_CONSERVATIVE = record(marketPolicySpec(4000, true, "Conservative market guard"));
export const ACCOUNT_POLICY = record(accountPolicySpec(5500, [Op.SUPPLY, Op.REDEEM, Op.BORROW, Op.EXIT_COLLATERAL], "My guard"));

function market(partial: Pick<Market, "id" | "index" | "active" | "ownedByViewer" | "createdAt" | "limits" | "policy"> & {
  collateralSupplied: bigint;
  debtSupplied: bigint;
  borrowed: bigint;
  supplyAprBps: Maybe<number>;
  borrowAprBps: Maybe<number>;
}): Market {
  const { collateralSupplied, debtSupplied, borrowed, supplyAprBps, borrowAprBps, ...rest } = partial;
  return {
    ...rest,
    controller: none(),
    owner: none(),
    collateral: { token: T_WETH, pToken: none(), totalSupplied: ok(collateralSupplied), price: ok(wethPrice) },
    debt: {
      token: T_USDC,
      pToken: none(),
      totalSupplied: ok(debtSupplied),
      totalBorrowed: ok(borrowed),
      cash: ok(debtSupplied - borrowed),
      price: ok(usdcPrice),
      supplyAprBps,
      borrowAprBps,
    },
  };
}

export const MARKETS: Market[] = [
  market({
    id: "example-0",
    index: 0,
    active: true,
    ownedByViewer: true,
    createdAt: "2026-11-24T10:12:00Z",
    limits: { borrowLtvBps: 7000, liquidationLtvBps: 8000, collateralSupplyCap: weth(5_000_000n), debtSupplyCap: usdc(5_000_000n), borrowCap: usdc(2_000_000n), minCash: usdc(50_000n) },
    policy: MARKET_POLICY_STANDARD,
    collateralSupplied: weth(412_500n),
    debtSupplied: usdc(600_000n),
    borrowed: usdc(240_000n),
    supplyAprBps: ok(212),
    borrowAprBps: ok(561),
  }),
  market({
    id: "example-1",
    index: 1,
    active: true,
    ownedByViewer: false,
    createdAt: "2026-11-24T14:40:00Z",
    limits: { borrowLtvBps: 5000, liquidationLtvBps: 6500, collateralSupplyCap: weth(1_000_000n), debtSupplyCap: usdc(1_000_000n), borrowCap: usdc(300_000n), minCash: usdc(20_000n) },
    policy: MARKET_POLICY_CONSERVATIVE,
    collateralSupplied: weth(96_000n),
    debtSupplied: usdc(150_000n),
    borrowed: usdc(31_500n),
    supplyAprBps: ok(88),
    borrowAprBps: ok(402),
  }),
  market({
    id: "example-2",
    index: 2,
    active: false,
    ownedByViewer: true,
    createdAt: "2026-11-25T08:05:00Z",
    limits: { borrowLtvBps: 6000, liquidationLtvBps: 7500, collateralSupplyCap: weth(500_000n), debtSupplyCap: usdc(500_000n), borrowCap: usdc(150_000n), minCash: usdc(10_000n) },
    policy: record(marketPolicySpec(5500, false, "Draft guard")),
    collateralSupplied: 0n,
    debtSupplied: 0n,
    borrowed: 0n,
    supplyAprBps: unavailable("No liquidity yet"),
    borrowAprBps: unavailable("No liquidity yet"),
  }),
];

/** Example Sentinel account on market example-0: 2.5 tWETH collateral ($5,000 at the example price), 1,500 tUSDC debt: 30% LTV. */
const SENTINEL_POSITION: Position = {
  marketId: "example-0",
  path: "sentinel",
  holder: none(),
  collateralSupplied: weth(2_500n),
  collateralEntered: true,
  lent: 0n,
  debt: usdc(1_500n),
  idleCollateral: weth(250n),
  idleDebtAsset: usdc(400n),
};

export const SENTINEL_ACCOUNTS: SentinelAccount[] = [
  {
    marketId: "example-0",
    address: none(),
    owner: none(),
    policy: ACCOUNT_POLICY,
    autoRepayTriggerBps: 5000,
    operators: [
      {
        operator: none(),
        label: "Peridot keeper (example)",
        opsMask: 1 << Op.REPAY,
        budget: usdc(1_000n),
        spent: usdc(150n),
        expiresAt: "2026-12-08T00:00:00Z",
        revoked: false,
      },
    ],
    position: SENTINEL_POSITION,
  },
];

/** Example wallet acting directly (no Sentinel policy in the path). */
export const DIRECT_POSITIONS: Position[] = [
  { marketId: "example-0", path: "direct", holder: none(), collateralSupplied: weth(1_000n), collateralEntered: true, lent: usdc(500n), debt: usdc(400n), idleCollateral: weth(1_200n), idleDebtAsset: usdc(2_000n) },
  { marketId: "example-1", path: "direct", holder: none(), collateralSupplied: 0n, collateralEntered: false, lent: 0n, debt: 0n, idleCollateral: weth(1_200n), idleDebtAsset: usdc(2_000n) },
  { marketId: "example-2", path: "direct", holder: none(), collateralSupplied: 0n, collateralEntered: false, lent: 0n, debt: 0n, idleCollateral: weth(1_200n), idleDebtAsset: usdc(2_000n) },
];

const POLICY_ID_PLACEHOLDER = "policyId unavailable in fixture mode";

export const ACTIVITY: ActivityEntry[] = [
  {
    id: "a7",
    at: "2026-11-25T09:41:00Z",
    actor: "operator",
    kind: "execution",
    title: "Auto-repay",
    marketId: "example-0",
    amount: { value: usdc(150n), token: T_USDC },
    result: "allowed",
    evidence: "mined-success",
    detail: "Loan-to-value 51.2% → 46.6% after a labelled mock price move. Paid from idle funds in the account.",
    txHash: none(NO_TX),
  },
  {
    id: "a6",
    at: "2026-11-25T09:40:00Z",
    actor: "operator",
    kind: "proposal",
    title: "Borrow attempt by operator",
    marketId: "example-0",
    amount: { value: usdc(300n), token: T_USDC },
    result: "rejected",
    evidence: "simulation",
    error: { name: "OperatorNotAuthorized", args: ["operator address unavailable in fixture mode", Op.BORROW] },
    detail: "The keeper is only granted auto-repay. Nothing was sent.",
    txHash: none(NO_TX),
  },
  {
    id: "a5",
    at: "2026-11-24T16:22:00Z",
    actor: "owner",
    kind: "execution",
    title: "Borrow",
    marketId: "example-0",
    amount: { value: usdc(960n), token: T_USDC },
    result: "rejected",
    evidence: "mined-revert",
    error: { name: "MarketPolicyRejected", args: [POLICY_ID_PLACEHOLDER, 1] },
    detail: "Sent directly from the wallet. Post-borrow loan-to-value 68% exceeds the market policy cap of 65%.",
    txHash: none(NO_TX),
  },
  {
    id: "a4",
    at: "2026-11-24T16:15:00Z",
    actor: "owner",
    kind: "proposal",
    title: "Borrow",
    marketId: "example-0",
    amount: { value: usdc(1_400n), token: T_USDC },
    result: "rejected",
    evidence: "simulation",
    error: { name: "AccountPolicyRejected", args: [POLICY_ID_PLACEHOLDER, 1] },
    detail: "Post-borrow loan-to-value 61% exceeds your Sentinel cap of 55%. The market would have allowed up to 65%.",
    txHash: none(NO_TX),
  },
  {
    id: "a3",
    at: "2026-11-24T15:58:00Z",
    actor: "owner",
    kind: "execution",
    title: "Borrow",
    marketId: "example-0",
    amount: { value: usdc(1_650n), token: T_USDC },
    result: "allowed",
    evidence: "mined-success",
    detail: "Both policies allowed. Loan-to-value 0% → 33%.",
    txHash: none(NO_TX),
  },
  {
    id: "a2",
    at: "2026-11-24T15:51:00Z",
    actor: "owner",
    kind: "execution",
    title: "Supply and enable collateral",
    marketId: "example-0",
    amount: { value: weth(2_500n), token: T_WETH },
    result: "allowed",
    evidence: "mined-success",
    txHash: none(NO_TX),
  },
  {
    id: "a1",
    at: "2026-11-24T15:44:00Z",
    actor: "owner",
    kind: "execution",
    title: "Sentinel account created",
    marketId: "example-0",
    result: "allowed",
    evidence: "mined-success",
    detail: "One account per owner and market. Personal policy attached at creation.",
    txHash: none(NO_TX),
  },
];

export const TEMPLATES: PolicyTemplate[] = [
  {
    templateId: "market-max-ltv-v0",
    kind: "MARKET",
    title: "Market max LTV",
    summary: "Denies risk-increasing operations above a loan-to-value cap, while prices are stale, or when a borrow would breach the cash reserve.",
    sample: MARKET_POLICY_STANDARD,
  },
  {
    templateId: "account-guard-v0",
    kind: "ACCOUNT",
    title: "Account guard",
    summary: "A personal, usually stricter loan-to-value cap plus a list of actions the account may take.",
    sample: ACCOUNT_POLICY,
  },
];

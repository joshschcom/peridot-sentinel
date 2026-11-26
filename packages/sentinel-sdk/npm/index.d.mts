export type Address = `0x${string}`;
export interface BlockObservation {
  number: bigint;
  hash: Address;
  timestamp: bigint;
  confirmations: bigint;
}
export interface Confirmed<T> {
  scope: string;
  chainId: 1952;
  deploymentCommit: string;
  block: BlockObservation;
  data: T;
}
export interface Position {
  kind: 'collateral' | 'debt';
  asset: Address;
  book: Address;
  symbol: string;
  decimals: number;
  idleRaw: bigint;
  bookSharesRaw: bigint;
  suppliedRaw: bigint;
  borrowedStoredRaw: bigint;
  exchangeRateStoredWad: bigint;
}
export interface Portfolio {
  account: Address;
  owner: Address;
  netUsdWad: bigint;
  accounting: string;
  amounts: Array<{
    asset: Address;
    priceUsdWad: bigint;
    idleUsdWad: bigint;
    suppliedUsdWad: bigint;
    debtUsdWad: bigint;
  }>;
}
export interface Market {
  controller: Address;
  collateralMarket: Address;
  debtMarket: Address;
  active: boolean;
  owner: Address;
  policyId: Address;
  debtCashRaw: bigint;
  totalDebtRaw: bigint;
  borrowLtvBps: number;
  liquidationLtvBps: number;
  collateralSupplyCapRaw: bigint;
  debtSupplyCapRaw: bigint;
  borrowCapRaw: bigint;
  minDebtCashRaw: bigint;
}
export interface Rate {
  book: Address;
  model: Address;
  blocksPerYear: bigint;
  borrowRatePerBlockWad: bigint;
  supplyRatePerBlockWad: bigint;
  simpleBorrowAprWad: bigint;
  simpleSupplyAprWad: bigint;
}
export interface Policy {
  layer: 'account' | 'market';
  id: Address;
  registry: Address;
  entry: Record<string, Address | bigint | number | boolean> | null;
}
export interface Strategy {
  name: 'v1-auto-repay';
  account: Address;
  operator: Address;
  triggerBps: number;
  opMask: number;
  remainingDebtRaw: bigint;
  expiry: bigint;
  repayOnly: boolean;
  grantLive: boolean;
}
export type RepaySimulation =
  | { eligible: true; amountRaw: bigint; asset: Address; grant: Strategy }
  | { eligible: false; reason: string; grant: Strategy };
export interface BorrowSimulation {
  method: 'eth_call';
  operation: 'borrow';
  amountRaw: bigint;
  account: Address;
  operator: Address;
  rejected: boolean;
  error?: string;
  args?: ReadonlyArray<Address | number | bigint>;
  revertData?: Address | null;
}
export interface ReadResults {
  sentinel_get_portfolio: Portfolio;
  sentinel_get_positions: Position[];
  sentinel_get_markets: Market[];
  sentinel_get_rates: Rate[];
  sentinel_get_policies: Policy[];
  sentinel_get_strategies: Strategy;
  sentinel_simulate_auto_repay: RepaySimulation;
  sentinel_simulate_operator_borrow: BorrowSimulation;
}
export type ReadTool = keyof ReadResults;
export type ToolName =
  | ReadTool
  | 'sentinel_propose_auto_repay'
  | 'sentinel_execute_auto_repay'
  | 'sentinel_quote'
  | 'sentinel_get_execution_receipt';
export const TOOL_NAMES: ReadonlyArray<ToolName>;
export const profile: Readonly<{
  chainId: 1952;
  account: Address;
  operator: Address;
  owner: Address;
  factory: Address;
  controller: Address;
  debtMarket: Address;
  collateralMarket: Address;
  debtAsset: Address;
  collateralAsset: Address;
  deploymentCommit: string;
  selector: Address;
}>;
export class ConnectError extends Error {
  code: string;
}
export function readTool<K extends ReadTool>(tool: K): Promise<Confirmed<ReadResults[K]>>;
export function jsonSafe(data: unknown): unknown;

/** JSON-RPC decimal strings preserve all bigint precision on the wire. */
export type Wire<T> = T extends bigint
  ? string
  : T extends ReadonlyArray<infer U>
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export interface Proposal {
  id: Address;
  chainId: 1952;
  account: Address;
  operator: Address;
  commit: string;
  selector: Address;
  valueWei: 0;
  amountRaw: string;
  grant: Wire<Strategy>;
  block: Wire<BlockObservation>;
  validUntil: string;
  settlement: string;
}
export type QuoteResult = {
  provider: 'OKX OnchainOS';
  kind: string;
  chainId: 196;
  from: 'USDC' | 'WOKB';
  amountRaw: string;
} & (
  | {
      status: 'blocked';
      code: 'OKX_CREDENTIALS_UNAVAILABLE' | 'OKX_QUOTE_UNAVAILABLE';
      quote: null;
    }
  | {
      status: 'quoted';
      quote: {
        source: 'OKX OnchainOS';
        chainId: 196;
        tokenIn: Address;
        amountIn: string;
        tokenOut: Address;
        amountOut: string;
        observedAt: string;
      };
    }
);
export interface Receipt {
  hash: Address;
  blockNumber: string;
  blockHash: Address;
  gasUsed: string;
  status: 'success' | 'reverted';
  from: Address;
  to: Address;
  nonce: number;
  selector: Address;
  valueWei: string;
  explorer: string;
}
export interface AccountState {
  debtStoredRaw: string;
  walletDebtAssetRaw: string;
  remainingGrantRaw: string;
}
export type ExecutionResult =
  | {
      state: 'pending_or_unknown' | 'awaiting_confirmation' | 'submission_unknown';
      proposalId: Address;
      hash: Address;
      nonce: number;
      instruction?: string;
    }
  | {
      state: 'reverted';
      proposalId: Address;
      receipt: Receipt;
      confirmations: string;
      chainId: 1952;
    }
  | {
      state: 'confirmed';
      proposalId: Address;
      receipt: Receipt;
      confirmations: string;
      chainId: 1952;
      actual: { operator: Address; amount: string; ltvBeforeBps: string; ltvAfterBps: string };
      repayBookEvent: {
        payer: Address;
        borrower: Address;
        repayAmount: string;
        accountBorrows: string;
        totalBorrows: string;
      };
      before: AccountState;
      after: AccountState;
      beforeBlock: Wire<BlockObservation>;
      afterBlock: { number: string; hash: Address };
      stateScope: string;
    };
export type ConnectResults = { [K in ReadTool]: Wire<Confirmed<ReadResults[K]>> } & {
  sentinel_quote: QuoteResult;
  sentinel_propose_auto_repay: Wire<Confirmed<RepaySimulation>> & { proposal: Proposal | null };
  sentinel_execute_auto_repay: ExecutionResult;
  sentinel_get_execution_receipt:
    | (ExecutionResult & { source: string })
    | {
        state: 'not_submitted';
        proposalId: Address;
        invalidReason: 'PROPOSAL_EXPIRED' | 'PROPOSAL_CHANGED' | null;
      };
};
export interface ConnectInputs {
  sentinel_quote: { from: 'USDC' | 'WOKB'; amountRaw: string };
  sentinel_get_execution_receipt: { proposalId: Address };
  sentinel_execute_auto_repay: { proposalId: Address };
}
export interface ConnectClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}
export function callConnectTool<K extends ToolName>(
  client: ConnectClient,
  tool: K,
  ...args: K extends keyof ConnectInputs
    ? [input: ConnectInputs[K]]
    : [input?: Record<string, never>]
): Promise<ConnectResults[K]>;

/**
 * Contract-error mapper: custom error names (INTERFACES v1 + milestone notices M1/M2) to friendly text.
 * The raw error is always preserved for the advanced view. Unknown errors fall through with raw details.
 * Names only: decoding uses the generated ABIs from @peridot/chain-config once that package is published.
 */

export type ErrorCategory =
  | "market-policy" // the MARKET circuit returned deny
  | "account-policy" // the user's Sentinel (ACCOUNT) circuit returned deny
  | "policy-unavailable" // a policy could not be evaluated: neither rejection, fails closed
  | "protocol" // protocol safety limits: solvency, caps, liquidity, oracle, lifecycle
  | "operator" // delegated automation permissions
  | "wallet" // user or wallet level
  | "network"
  | "unknown";

export interface RawError {
  name?: string;
  args?: readonly unknown[];
  data?: string;
  message?: string;
}

export interface FriendlyError {
  category: ErrorCategory;
  title: string;
  message: string;
  hint?: string;
  raw: RawError;
}

type Entry = Pick<FriendlyError, "category" | "title" | "message" | "hint">;

const TABLE: Record<string, Entry> = {
  MarketPolicyRejected: {
    category: "market-policy",
    title: "Blocked by the market's policy",
    message: "This market's policy circuit denied the operation. The rule is set by the market owner and applies to everyone using this market.",
    hint: "Try a smaller amount, add collateral or repay debt first.",
  },
  AccountPolicyRejected: {
    category: "account-policy",
    title: "Stopped by your Sentinel policy",
    message: "Your own policy circuit denied the operation. The market would not have been asked: your personal limit is stricter here.",
    hint: "Lower the amount, or review your policy if this limit is no longer what you want.",
  },
  PolicyEvaluationFailed: {
    category: "policy-unavailable",
    title: "Policy could not be evaluated",
    message: "The policy processor did not return a valid answer, so the operation was refused to stay safe. This is not a policy decision.",
    hint: "Repayment and safe exits keep working. Try again later.",
  },
  UnavailablePolicy: {
    category: "policy-unavailable",
    title: "Policy is not usable",
    message: "The policy is not registered, or its processor is no longer trusted by the registry. New risk is refused until this is resolved.",
    hint: "Repayment and safe exits keep working.",
  },
  InvalidContext: {
    category: "protocol",
    title: "Risk is outside the supported range",
    message: "The resulting loan-to-value cannot be represented (above 100%), so the operation is refused before any policy is consulted.",
  },
  InvalidOracle: {
    category: "protocol",
    title: "Price feed is not valid",
    message: "The market's price is missing, not positive or stale. Risk-increasing operations are refused until the feed is fresh.",
  },
  Inactive: {
    category: "protocol",
    title: "Market is not active",
    message: "This market has been created but not activated by its owner. Borrowing opens only after liquidity is seeded and the market is activated.",
  },
  InsufficientLiquidity: {
    category: "protocol",
    title: "Exceeds the market's borrowing limit",
    message: "Your collateral does not cover this amount at the market's borrowing limit, or the market does not hold enough available cash above its reserve. This protocol limit applies regardless of any policy.",
    hint: "Try a smaller amount, add collateral or repay debt first.",
  },
  BorrowCapExceeded: {
    category: "protocol",
    title: "Borrow cap reached",
    message: "This amount would exceed the market's total borrow cap.",
    hint: "Try a smaller amount.",
  },
  SupplyCapExceeded: {
    category: "protocol",
    title: "Supply cap reached",
    message: "This amount would exceed the market's supply cap.",
    hint: "Try a smaller amount.",
  },
  InvalidTemplateProof: {
    category: "protocol",
    title: "Template proof rejected",
    message: "The registry did not accept this policy as one of the committed Studio templates. The app's compiler and the deployed registry may be on different versions.",
  },
  InvalidLimits: {
    category: "protocol",
    title: "Risk parameters are not valid",
    message: "The borrowing limit must be below the liquidation threshold, and both must be within the factory's allowed range.",
  },
  Unauthorized: {
    category: "protocol",
    title: "Not authorized",
    message: "Only the market owner can perform this action.",
  },
  OwnerOnly: {
    category: "operator",
    title: "Owner only",
    message: "Only the account owner can perform this action. Operators can never withdraw or change permissions: an operator's withdrawal attempt reverts with this error.",
  },
  AccountPolicyMissing: {
    category: "account-policy",
    title: "No Sentinel policy set",
    message: "This account has no personal policy, so risk-increasing actions are refused. Set a policy first.",
  },
  OperatorNotAuthorized: {
    category: "operator",
    title: "Automation is not authorized for this action",
    message: "The operator tried an action outside the permissions you granted.",
  },
  OperatorExpired: {
    category: "operator",
    title: "Automation authorization expired",
    message: "The operator's permission has passed its expiry time.",
    hint: "Grant a new authorization if you still want automation.",
  },
  ExceedsOperatorLimit: {
    category: "operator",
    title: "Automation budget exceeded",
    message: "The operator tried to use more than the cumulative budget you granted.",
  },
  TriggerNotMet: {
    category: "operator",
    title: "Auto-repay trigger not met",
    message: "The position's loan-to-value is below your auto-repay trigger, so the repayment was not executed.",
  },
  InvalidTrigger: {
    category: "operator",
    title: "Auto-repay trigger is not valid",
    message: "The trigger must be a loan-to-value between 0 and 100%. Zero disables auto-repay.",
  },
  AccountAlreadyExists: {
    category: "protocol",
    title: "Account already exists",
    message: "You already have a Sentinel account for this market. Each owner has one account per market.",
  },
  ReviewMismatch: {
    category: "wallet",
    title: "This is not the transaction you reviewed",
    message: "The transaction, or the connected wallet, no longer matches the plan that was shown. Nothing was sent.",
    hint: "Build the review again and check it before signing.",
  },
  UserRejectedRequestError: {
    category: "wallet",
    title: "Request rejected in wallet",
    message: "You declined the request in your wallet. Nothing was sent.",
  },
  ChainMismatchError: {
    category: "network",
    title: "Wrong network",
    message: "Your wallet is on a different network. Switch to X Layer testnet to continue.",
  },
  InsufficientFundsError: {
    category: "wallet",
    title: "Not enough OKB for gas",
    message: "Your wallet does not hold enough testnet OKB to pay for this transaction.",
  },
  /* ---- Sentinel v2: account, swap adapter, execution policy, vault account and adapter (expansion ABIs) ---- */
  ExecutionPolicyDenied: {
    category: "protocol",
    title: "Stopped by the execution policy",
    message: "The execution policy circuit of this Sentinel v2 account denied the swap: the loss against the reference price is larger than the circuit allows. This is a third rule, separate from the market's and the account's lending policies.",
    hint: "Ask for a higher minimum output, or swap a smaller amount.",
  },
  ExecutionEvaluationFailed: {
    category: "policy-unavailable",
    title: "Execution policy could not be evaluated",
    message: "The execution policy's processor is not the recorded one, or it did not return a valid answer, so the operation was refused to stay safe. This is not a policy decision.",
  },
  BudgetExceeded: {
    category: "operator",
    title: "Outside the operator's grant",
    message: "The amount is larger than the grant's limit per call, or larger than what is left of its total budget.",
    hint: "The owner can replace the grant with a new one.",
  },
  InvalidGrant: {
    category: "operator",
    title: "Grant not accepted",
    message: "The account refused this grant: its operation, asset, limits or expiry are not a combination it accepts.",
    hint: "Check that the limit per call is not above the total and that the expiry is in the future.",
  },
  DeadlineExpired: {
    category: "protocol",
    title: "Deadline passed",
    message: "The transaction carried a deadline and was mined after it, so the contract refused it. Nothing moved.",
    hint: "Review it again and sign the new transaction.",
  },
  InsufficientInput: {
    category: "protocol",
    title: "Not enough in the account",
    message: "The account holds less of the input token than this operation needs.",
  },
  PriceUnavailable: {
    category: "protocol",
    title: "Reference price unavailable",
    message: "The account could not get a usable reference price for this swap, so it refused. A swap is never sent without one.",
  },
  SlippageExceeded: {
    category: "protocol",
    title: "Minimum output not acceptable",
    message: "The minimum output is zero or below the floor the account derives from the reference price, or the loss would be above the contract's hard limit of 5%.",
    hint: "Set a higher minimum output.",
  },
  SlippageLimit: {
    category: "protocol",
    title: "Minimum output below the adapter's floor",
    message: "The swap adapter only accepts a minimum output at or above its own floor for the current price.",
    hint: "Set a higher minimum output.",
  },
  QuoteExpired: {
    category: "protocol",
    title: "Price quote no longer valid",
    message: "The swap adapter's price source is out of date or not usable, so it refused to swap.",
    hint: "Try again once the price feed has been refreshed.",
  },
  SettlementMismatch: {
    category: "protocol",
    title: "Settlement check failed",
    message: "After the swap, the amounts or approvals did not match what the adapter requires, so everything was reverted.",
  },
  UnexpectedSettlement: {
    category: "protocol",
    title: "Settlement check failed",
    message: "After the operation, the account's balances, shares or approvals did not match what the contract requires, so everything was reverted.",
  },
  InsufficientOutput: {
    category: "protocol",
    title: "Venue would pay less than the minimum",
    message: "The testnet venue's output for this swap is below the minimum output, so the swap was refused.",
  },
  AdapterChanged: {
    category: "protocol",
    title: "Adapter code changed",
    message: "The code at an adapter's address is not the code this account was created with. The account refuses to use it.",
  },
  MarketOperationFailed: {
    category: "protocol",
    title: "Lending market refused the operation",
    message: "The lending book answered with an error code, so the account reverted the whole operation.",
  },
  TokenOperationFailed: {
    category: "protocol",
    title: "Token transfer or approval failed",
    message: "A token call inside the operation did not succeed, so everything was reverted.",
  },
  TransferFailed: {
    category: "protocol",
    title: "Token transfer failed",
    message: "A token transfer inside the vault did not succeed, so everything was reverted.",
  },
  InvalidAmount: {
    category: "protocol",
    title: "Amount not accepted",
    message: "The amount is zero or outside what this contract accepts.",
  },
  InvalidAsset: {
    category: "protocol",
    title: "Token not supported",
    message: "This account or adapter does not handle that token. A v2 account swaps between two fixed tokens only.",
  },
  InvalidOperation: {
    category: "protocol",
    title: "Operation not supported",
    message: "The lending adapter does not support this operation.",
  },
  UnknownMarket: {
    category: "protocol",
    title: "Unknown lending market",
    message: "The lending adapter is bound to one market and was asked about another.",
  },
  ReentrantOperation: {
    category: "protocol",
    title: "Operation blocked while another is running",
    message: "The account refuses a call that re-enters it during an operation.",
  },
  Reentered: {
    category: "protocol",
    title: "Operation blocked while another is running",
    message: "The swap adapter refuses a call that re-enters it during a swap.",
  },
  // Strategy registry (packages/chain-config/expansion/abi/StrategyRegistry.json). This app does not call the
  // registry: no public deployment exists. The names are mapped so that the ABI coverage test stays total.
  EmptyIdentity: {
    category: "protocol",
    title: "Publication is missing an identity",
    message: "The strategy registry needs a series, an adapter version and a policy key for every publication.",
  },
  InvalidJsonLength: {
    category: "protocol",
    title: "Strategy text has the wrong size",
    message: "The strategy registry only stores a strategy whose text is within its size limit.",
  },
  UnexpectedVersion: {
    category: "protocol",
    title: "Version is not the next one",
    message: "The strategy registry only accepts the version that follows the latest published one. Versions are immutable.",
    hint: "Read the latest version again and publish the next one.",
  },
  MissingVersion: {
    category: "protocol",
    title: "No such published version",
    message: "The strategy registry has no publication for that creator, series and version.",
  },
  VaultCapacity: {
    category: "protocol",
    title: "Vault limit reached",
    message: "The vault does not accept or release that much for this account right now (its own deposit, withdrawal or redemption maximum).",
    hint: "Try a smaller amount.",
  },
  VaultQuote: {
    category: "protocol",
    title: "Vault preview is zero",
    message: "The vault's preview for this amount is zero shares or zero assets, so the operation was refused.",
  },
  VaultBounds: {
    category: "protocol",
    title: "Bound cannot be met",
    message: "The minimum or maximum you set is zero, is tighter than the vault's current preview, or is below the account's own floor of shares per asset.",
    hint: "Read the quote again and use the bound it shows.",
  },
  VaultDepositLimit: {
    category: "protocol",
    title: "Above this account's vault cap",
    message: "The deposit would take the position above the cap the owner set on this vault account.",
    hint: "Deposit less, or raise the cap as the owner.",
  },
  VaultLimit: {
    category: "protocol",
    title: "Refused by the vault",
    message: "The testnet vault's own limit does not allow this amount.",
  },
  ERC20InsufficientBalance: {
    category: "protocol",
    title: "Not enough tokens",
    message: "The sender holds fewer tokens than the transfer needs.",
  },
  ERC20InsufficientAllowance: {
    category: "protocol",
    title: "Allowance too low",
    message: "The token allowance is lower than the amount being moved.",
  },
  ERC20InvalidApprover: { category: "protocol", title: "Token approval refused", message: "The token contract refused the approving address." },
  ERC20InvalidReceiver: { category: "protocol", title: "Token transfer refused", message: "The token contract refused the receiving address." },
  ERC20InvalidSender: { category: "protocol", title: "Token transfer refused", message: "The token contract refused the sending address." },
  ERC20InvalidSpender: { category: "protocol", title: "Token approval refused", message: "The token contract refused the spender address." },
  /* Deployment-time checks. A user action should never meet these on a verified deployment. */
  UnsupportedChain: { category: "protocol", title: "Wrong chain for this contract", message: "This contract only works on the chain it was deployed for." },
  TestnetOnly: { category: "protocol", title: "Testnet-only contract", message: "This contract is a test fixture and refuses to run on another network." },
  InvalidConfiguration: { category: "protocol", title: "Deployment configuration refused", message: "The contract was given a configuration it does not accept. This points at the deployment, not at your action." },
  InvalidCircuit: { category: "protocol", title: "Execution circuit not accepted", message: "The execution policy was given a circuit it does not accept. This points at the deployment, not at your action." },
  InvalidVaultIdentity: { category: "protocol", title: "Vault not the recorded one", message: "The vault adapter is bound to one vault and found something else at that address." },
  InvalidRoute: { category: "protocol", title: "Swap route not supported", message: "The testnet venue only swaps its two fixed tokens." },
  UnsupportedUnit: { category: "protocol", title: "Token units not supported", message: "The contract does not support this token's decimals." },
};

export const KNOWN_ERROR_NAMES = Object.keys(TABLE);

export function mapContractError(input: unknown): FriendlyError {
  const raw = extractRaw(input);
  const entry = raw.name ? TABLE[raw.name] : undefined;
  if (entry) return { ...entry, raw };
  return {
    category: "unknown",
    title: "Transaction failed",
    message: raw.name
      ? `The contract reverted with ${raw.name}. This error is not mapped yet; the raw details are below.`
      : "The operation failed for a reason this app does not recognise. The raw details are below.",
    raw,
  };
}

/** Accepts `{ name, args }`, an Error, or a viem error (walks the `cause` chain for decoded revert data). */
export function extractRaw(input: unknown): RawError {
  if (typeof input === "string") return { message: input };
  if (!isRecord(input)) return { message: String(input) };
  let fallback: RawError = {
    name: typeof input.name === "string" ? input.name : undefined,
    args: Array.isArray(input.args) ? input.args : undefined,
    data: typeof input.data === "string" ? input.data : undefined,
    message: typeof input.shortMessage === "string" ? input.shortMessage : typeof input.message === "string" ? input.message : undefined,
  };
  let cursor: unknown = input;
  for (let depth = 0; depth < 8 && isRecord(cursor); depth++) {
    const data = cursor.data;
    if (isRecord(data) && typeof data.errorName === "string") {
      return { name: data.errorName, args: Array.isArray(data.args) ? data.args : undefined, data: typeof cursor.raw === "string" ? cursor.raw : undefined, message: fallback.message };
    }
    if (typeof cursor.name === "string" && cursor.name in TABLE) {
      fallback = { ...fallback, name: cursor.name };
    }
    cursor = cursor.cause;
  }
  return fallback;
}

/** JSON for the advanced view; bigint-safe. */
export function rawErrorText(raw: RawError): string {
  return JSON.stringify(raw, (_key, value) => (typeof value === "bigint" ? `${value}n` : value), 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

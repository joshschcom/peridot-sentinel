/**
 * Keeper read API (INTERFACES v1.2, "Keeper reads"): parsing, scope checks and row presentation.
 * Everything the keeper reports is untrusted input: fields are whitelisted and validated here, the scope is
 * compared with the manifest and the chain before a single row is shown, and a "success" row is only called
 * confirmed once its receipt has been read from the chain by the browser.
 * Dependency-free so the server route, the client and node tests share it.
 */
export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export interface KeeperScope {
  schemaVersion: 1;
  environment: "anvil" | "anvil-fork" | "xlayer-testnet";
  /** Anvil instance id on local chains, null on testnet. */
  instanceId: string | null;
  chainId: number;
  factory: Address;
  account: Address;
  operator: Address;
}

export interface KeeperStatus {
  execute: boolean;
  intervalMs: number;
  phase: string;
  cycles: number;
  startedAt: string | null;
  lastAt: string | null;
  lastOutcome: string | null;
  nextAt: string | null;
}

export interface KeeperItem {
  at: string;
  state: string;
  /** Raw debt-asset units, decimal string. */
  amount?: string;
  /** bps */
  trigger?: number;
  /** bps, decimal string */
  ltv?: string;
  /** wei, decimal string */
  fee?: string;
  balance?: string;
  reason?: string;
  hash?: Hash;
  block?: string;
  gas?: string;
  outcomes?: Array<{ operator: Address; amount: string; ltvBeforeBps: string; ltvAfterBps: string }>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^\d{1,78}$/;
const NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, pattern: RegExp): string | undefined => (typeof value === "string" && pattern.test(value) ? value : undefined);
const decimal = (value: unknown): string | undefined => text(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value, DECIMAL);

export function parseKeeperScope(json: unknown): KeeperScope | null {
  if (!isRecord(json) || json.schemaVersion !== 1) return null;
  const { environment, instanceId, chainId, factory, account, operator } = json;
  if (environment !== "anvil" && environment !== "anvil-fork" && environment !== "xlayer-testnet") return null;
  if (instanceId !== null && text(instanceId, HASH) === undefined) return null;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId)) return null;
  if (!text(factory, ADDRESS) || !text(account, ADDRESS) || !text(operator, ADDRESS)) return null;
  return { schemaVersion: 1, environment, instanceId: instanceId as string | null, chainId, factory: factory as Address, account: account as Address, operator: operator as Address };
}

export function parseKeeperStatus(json: unknown): KeeperStatus | null {
  if (!isRecord(json) || typeof json.execute !== "boolean") return null;
  const time = (value: unknown) => text(value, ISO) ?? null;
  return {
    execute: json.execute,
    intervalMs: typeof json.intervalMs === "number" && Number.isFinite(json.intervalMs) ? json.intervalMs : 0,
    phase: text(json.phase, NAME) ?? "unknown",
    cycles: typeof json.cycles === "number" && Number.isSafeInteger(json.cycles) ? json.cycles : 0,
    startedAt: time(json.startedAt),
    lastAt: time(json.lastAt),
    lastOutcome: text(json.lastOutcome, NAME) ?? null,
    nextAt: time(json.nextAt),
  };
}

/** Whitelists every field. Rows without a valid timestamp and state are dropped, unknown fields never pass through. */
export function parseKeeperItems(json: unknown, limit = 100): { items: KeeperItem[]; truncated: boolean } | null {
  if (!isRecord(json) || !Array.isArray(json.items)) return null;
  const items: KeeperItem[] = [];
  for (const row of json.items.slice(0, limit)) {
    if (!isRecord(row)) continue;
    const at = text(row.at, ISO);
    const state = text(row.state, NAME);
    if (!at || !state) continue;
    const outcomes = Array.isArray(row.outcomes)
      ? row.outcomes.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const operator = text(entry.operator, ADDRESS);
          const amount = decimal(entry.amount);
          const before = decimal(entry.ltvBeforeBps);
          const after = decimal(entry.ltvAfterBps);
          return operator && amount && before && after ? [{ operator: operator as Address, amount, ltvBeforeBps: before, ltvAfterBps: after }] : [];
        })
      : undefined;
    items.push({
      at,
      state,
      amount: decimal(row.amount),
      trigger: typeof row.trigger === "number" && Number.isSafeInteger(row.trigger) && row.trigger >= 0 && row.trigger <= 10_000 ? row.trigger : undefined,
      ltv: decimal(row.ltv),
      fee: decimal(row.fee),
      balance: decimal(row.balance),
      reason: text(row.reason, NAME),
      hash: text(row.hash, HASH) as Hash | undefined,
      block: decimal(row.block),
      gas: decimal(row.gas),
      outcomes: outcomes && outcomes.length ? outcomes : undefined,
    });
  }
  return { items, truncated: json.truncated === true || json.items.length > limit };
}

/* ---------- scope ---------- */

/** What the app knows independently of the keeper: the manifest, the node, and reads of the claimed account. */
export interface ScopeFacts {
  target: "local" | "testnet";
  chainId: number;
  /** SentinelAccountFactory from the validated manifest. */
  factory: Address;
  /** `anvil_metadata.instanceId` of the node the app reads from (local target). null: could not be read. */
  nodeInstanceId: string | null;
  /** factory.accountOf(account.owner(), account.controller()) == account. null: the reads failed. */
  accountFromFactory: boolean | null;
  /** operators(operator).opsMask on the account. null: the read failed. */
  operatorMask: number | null;
}

export interface ScopeCheck {
  ok: boolean;
  /** Any problem withholds every row. */
  problems: string[];
  /** Shown next to the rows; does not withhold them. */
  warnings: string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const REPAY_BIT = 1 << 3;

export function checkKeeperScope(scope: KeeperScope, facts: ScopeFacts): ScopeCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (scope.chainId !== facts.chainId) problems.push(`The keeper works on chain ${scope.chainId}; this app targets chain ${facts.chainId}.`);
  if (!same(scope.factory, facts.factory)) problems.push("The keeper's Sentinel factory is not the one in this deployment's manifest.");
  if (facts.target === "local") {
    if (scope.environment !== "anvil" && scope.environment !== "anvil-fork") problems.push(`The keeper reports environment "${scope.environment}", which is not a local chain.`);
    if (scope.instanceId === null) problems.push("The keeper did not report a local node instance.");
    else if (facts.nodeInstanceId === null) problems.push("The local node's instance id could not be read, so the keeper's node cannot be matched.");
    else if (!same(scope.instanceId, facts.nodeInstanceId)) problems.push("The keeper is attached to a different local node instance (the node was restarted or redeployed).");
  } else {
    if (scope.environment !== "xlayer-testnet") problems.push(`The keeper reports environment "${scope.environment}", not X Layer testnet.`);
    if (scope.instanceId !== null) problems.push("The keeper reports a local node instance on a public network.");
  }
  if (facts.accountFromFactory === null) problems.push("The keeper's account could not be verified on chain.");
  else if (!facts.accountFromFactory) problems.push("The keeper's account is not a Sentinel account created by this deployment's factory.");
  if (facts.operatorMask === null) warnings.push("The operator's current permission could not be read.");
  else if ((facts.operatorMask & REPAY_BIT) === 0) warnings.push("This operator currently has no repay permission on the account. Its attempts will fail until the owner authorises it.");
  return { ok: problems.length === 0, problems, warnings };
}

/* ---------- presentation ---------- */

export type KeeperTone = "neutral" | "success" | "warning" | "danger";
export interface KeeperRowView {
  /** Short state label. Off-chain states always say that nothing was sent. */
  label: string;
  tone: KeeperTone;
  /** True once a transaction exists (submitted, success, reverted). */
  sent: boolean;
  /** True when the keeper claims a mined receipt. The browser still has to confirm it on chain. */
  mined: boolean;
  summary: string;
}

const VIEWS: Record<string, Omit<KeeperRowView, "summary"> & { summary: (item: KeeperItem) => string }> = {
  disabled: { label: "Automation off · nothing sent", tone: "neutral", sent: false, mined: false, summary: () => "Auto-repay is disabled for this account (trigger 0 or no grant)." },
  simulated: { label: "Simulated · not sent", tone: "neutral", sent: false, mined: false, summary: () => "The keeper simulated an auto-repay and it would succeed. Nothing was sent in this step." },
  "simulation-failed": { label: "Simulation failed · not sent", tone: "warning", sent: false, mined: false, summary: (item) => `The repay simulation reverted${item.reason ? ` with ${item.reason}` : ""}. An automation attempt, not a mined transaction.` },
  "gas-budget": { label: "Skipped · gas budget", tone: "warning", sent: false, mined: false, summary: () => "The estimated network fee is above the keeper's gas budget or balance, so it did not send." },
  "another-transaction-pending": { label: "Waiting · earlier transaction pending", tone: "neutral", sent: false, mined: false, summary: () => "An earlier keeper transaction is still pending. Nothing new was sent." },
  "awaiting-confirmation": { label: "Waiting · awaiting confirmation", tone: "neutral", sent: false, mined: false, summary: () => "The keeper is waiting for an earlier transaction to confirm." },
  submitted: { label: "Submitted · awaiting receipt", tone: "neutral", sent: true, mined: false, summary: () => "The keeper sent an auto-repay transaction. It is not confirmed yet." },
  success: { label: "Mined", tone: "success", sent: true, mined: true, summary: () => "The keeper reports a mined auto-repay." },
  reverted: { label: "Mined revert", tone: "danger", sent: true, mined: true, summary: (item) => `The keeper reports that its transaction was mined and reverted${item.reason ? ` (${item.reason})` : ""}.` },
  "tick-failed": { label: "Keeper error · nothing sent", tone: "warning", sent: false, mined: false, summary: () => "The keeper could not complete its check (read, configuration or transport error)." },
};

export function keeperRowView(item: KeeperItem): KeeperRowView {
  const view = VIEWS[item.state];
  if (!view) return { label: `Unrecognised state "${item.state}"`, tone: "neutral", sent: item.hash !== undefined, mined: false, summary: "This app does not know this keeper state. It is shown as reported." };
  return { ...view, summary: view.summary(item) };
}

export interface KeeperGroup {
  item: KeeperItem;
  /** Consecutive identical off-chain rows collapsed into this one. */
  count: number;
  /** Timestamp of the oldest row in the group. */
  since: string;
}

/** Items arrive newest first. Consecutive rows that differ only in time collapse; rows with a hash never do. */
export function groupKeeperItems(items: readonly KeeperItem[]): KeeperGroup[] {
  const signature = (item: KeeperItem) => (item.hash ? null : [item.state, item.amount, item.trigger, item.ltv, item.reason].join("|"));
  const groups: KeeperGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    const sig = signature(item);
    if (last && sig !== null && signature(last.item) === sig) {
      last.count += 1;
      last.since = item.at;
    } else {
      groups.push({ item, count: 1, since: item.at });
    }
  }
  return groups;
}

/** Shape returned by the app's own /api/keeper route. */
export type KeeperFeed =
  | { state: "not-configured" }
  | { state: "unavailable"; reason: string }
  | { state: "scope-mismatch"; scope: KeeperScope; check: ScopeCheck }
  | { state: "ok"; scope: KeeperScope; check: ScopeCheck; status: KeeperStatus | null; items: KeeperItem[]; truncated: boolean; accountOwner: Address | null; accountController: Address | null };

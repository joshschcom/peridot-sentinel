"use client";
/**
 * On-chain reads (INTERFACES v1.2). Amounts stay bigint end to end. A failed read becomes `unavailable`,
 * never a zero and never fixture data.
 */
import { type Hex, parseEventLogs, zeroAddress } from "viem";
import { formatBps } from "../../lib/amount.ts";
import { type RawError, extractRaw } from "../../lib/errors.ts";
import { type Maybe, ok, unavailable } from "../../lib/maybe.ts";
import { type AccountPolicySpec, LOCAL_PREVIEW_LABEL, type MarketPolicySpec, Op, OP_LABEL, type OpId, type PolicySpec, accountPolicySpec, compileSpec, evaluateLocally, marketPolicySpec, studioTemplateByConfigHash } from "../../lib/policy.ts";
import type { Address, CheckResult, Market, OperationPreview, OperationRequest, OperatorGrant, PolicyRecord, Position, RejectionSource, SentinelAccount, TokenInfo } from "../types.ts";
import { WRITE_CHAIN_ID } from "../../lib/chains.ts";
import { rememberedOperators } from "../../lib/local-memory.ts";
import { ABI, client, contract, feedLabel, isMockToken, manifest, scanLogs, withErrors } from "./client.ts";

const WAD = 10n ** 18n;
const ZERO_ID = `0x${"0".repeat(64)}` as Hex;
const safe = async <T>(read: Promise<T>, what: string): Promise<Maybe<T>> => {
  try {
    return ok(await read);
  } catch (error) {
    return unavailable(`${what} could not be read: ${error instanceof Error ? error.message.split("\n")[0] : "RPC error"}`);
  }
};

/* ---------- policies ---------- */

export function invalidateChainCaches(): void {
  tokens.clear();
}

/** Operator addresses learned outside the log window (for example the keeper service's configured operator). */
const hintedOperators = new Map<string, Set<Address>>();
export function hintOperator(account: Address, operator: Address): void {
  const set = hintedOperators.get(account.toLowerCase()) ?? new Set<Address>();
  set.add(operator);
  hintedOperators.set(account.toLowerCase(), set);
}

/** Shipped sample policies (packages/circuit-sdk/fixtures/policies-v1.json) used as identification candidates. */
const KNOWN_CANDIDATES: PolicySpec[] = [marketPolicySpec(6500, true), accountPolicySpec(5500, [Op.SUPPLY, Op.REDEEM, Op.BORROW, Op.EXIT_COLLATERAL])];

/**
 * Readable rules are shown only if a compiled candidate matches BOTH the registry's configHash and netlistHash.
 * Otherwise the record is `identified: false` and the UI shows "Rules unavailable" with the real hashes.
 */
export async function readPolicy<K extends "MARKET" | "ACCOUNT">(policyId: Hex, kind: K): Promise<PolicyRecord<K extends "MARKET" ? MarketPolicySpec : AccountPolicySpec>> {
  type Spec = K extends "MARKET" ? MarketPolicySpec : AccountPolicySpec;
  const placeholder = (kind === "MARKET" ? marketPolicySpec(0, false) : accountPolicySpec(0, [])) as Spec;
  if (policyId === ZERO_ID) return { identified: false, spec: placeholder, compiled: unavailable("No policy is set"), registration: unavailable("No policy is set (policy ID is zero)") };
  const entry = await client().readContract({ address: contract("PolicyRegistry"), abi: ABI.registry, functionName: "getPolicy", args: [policyId] });
  const mode = manifest().tapeout.mode;
  const registration = ok({
    policyId,
    chainId: Number(entry.chainId),
    processor: entry.processor,
    processorKind: mode === "official" ? ("official" as const) : mode === "self-deployed-reference" ? ("self-deployed-reference" as const) : ("development-reference" as const),
    circuitId: entry.circuitId,
    publisher: entry.publisher,
  });
  const candidates: PolicySpec[] = [...KNOWN_CANDIDATES];
  if (kind === "MARKET" && !candidates.some((spec) => spec.kind === "MARKET" && compileSpec(spec).status === "ok" && (compileSpec(spec) as { value: { configHash: string } }).value.configHash.toLowerCase() === entry.configHash.toLowerCase())) {
    // Studio policies: recover the committed template leaf from the config hash (no log query), then verify below.
    const template = studioTemplateByConfigHash(entry.configHash);
    if (template) candidates.unshift(marketPolicySpec(template.maxLtvBps, template.requireCashReserve));
  }
  for (const spec of candidates) {
    if (spec.kind !== kind) continue;
    const compiled = compileSpec(spec);
    if (compiled.status === "ok" && compiled.value.configHash.toLowerCase() === entry.configHash.toLowerCase() && compiled.value.netlistHash.toLowerCase() === entry.netlistHash.toLowerCase()) {
      return { identified: true, spec: spec as Spec, compiled, registration };
    }
  }
  return {
    identified: false,
    spec: placeholder,
    compiled: ok({ configHash: entry.configHash, netlist: "0x", netlistHash: entry.netlistHash, nIn: 20, nOut: 1, nState: 0, gateCount: entry.gateCount }),
    registration,
  };
}

/* ---------- markets ---------- */

const tokens = new Map<string, Promise<TokenInfo>>();
function readToken(address: Address): Promise<TokenInfo> {
  const key = address.toLowerCase();
  if (!tokens.has(key)) {
    const rpc = client();
    tokens.set(
      key,
      Promise.all([
        rpc.readContract({ address, abi: ABI.token, functionName: "symbol" }),
        rpc.readContract({ address, abi: ABI.token, functionName: "name" }),
        rpc.readContract({ address, abi: ABI.token, functionName: "decimals" }),
      ]).then(([symbol, name, decimals]) => ({ symbol, name, decimals, address: ok(address), mock: isMockToken(address) })),
    );
  }
  return tokens.get(key)!;
}

export async function listControllers(): Promise<Address[]> {
  const rpc = client();
  const factory = contract("MarketFactory");
  const count = await rpc.readContract({ address: factory, abi: ABI.factory, functionName: "marketCount" });
  return Promise.all(Array.from({ length: Number(count) }, (_, index) => rpc.readContract({ address: factory, abi: ABI.factory, functionName: "marketAt", args: [BigInt(index)] })));
}

export async function readMarket(controller: Address, index: number, viewer: Address | null): Promise<Market> {
  const rpc = client();
  const c = { address: controller, abi: ABI.controller } as const;
  const [owner, active, policyId, limits, collateralMarket, debtMarket, collateralAsset, debtAsset, oracle] = await Promise.all([
    rpc.readContract({ ...c, functionName: "owner" }),
    rpc.readContract({ ...c, functionName: "active" }),
    rpc.readContract({ ...c, functionName: "policyId" }),
    rpc.readContract({ ...c, functionName: "limits" }),
    rpc.readContract({ ...c, functionName: "collateralMarket" }),
    rpc.readContract({ ...c, functionName: "debtMarket" }),
    rpc.readContract({ ...c, functionName: "collateralAsset" }),
    rpc.readContract({ ...c, functionName: "debtAsset" }),
    rpc.readContract({ ...c, functionName: "oracle" }),
  ]);
  const book = async (pToken: Address) => {
    const p = { address: pToken, abi: ABI.pToken } as const;
    const [cash, borrows, reserves] = await Promise.all([rpc.readContract({ ...p, functionName: "getCash" }), rpc.readContract({ ...p, functionName: "totalBorrows" }), rpc.readContract({ ...p, functionName: "totalReserves" })]);
    return { cash, borrows, supplied: cash + borrows - reserves };
  };
  const price = async (asset: Address) => {
    const [usdE18, fresh] = await rpc.readContract({ address: oracle, abi: ABI.oracle, functionName: "price", args: [asset] });
    const [, updatedAt] = await rpc.readContract({ address: oracle, abi: ABI.oracle, functionName: "quotes", args: [asset] });
    return { usdE18, fresh, updatedAt: new Date(Number(updatedAt) * 1000).toISOString(), feed: feedLabel() };
  };
  // Simple APR = per-block WAD rate x blocksPerYear (Astra, M4-testnet-preflight-and-frontend-reads). Display only.
  const apr = async (which: "supplyRatePerBlock" | "borrowRatePerBlock") => {
    const [rate, model] = await Promise.all([rpc.readContract({ address: debtMarket, abi: ABI.pToken, functionName: which }), rpc.readContract({ address: debtMarket, abi: ABI.pToken, functionName: "interestRateModel" })]);
    const blocksPerYear = await rpc.readContract({ address: model, abi: ABI.rateModel, functionName: "blocksPerYear" });
    return Number((rate * blocksPerYear * 10_000n) / WAD);
  };
  const [collateralToken, debtToken, policy, collateralBook, debtBook, collateralPrice, debtPrice, supplyAprBps, borrowAprBps] = await Promise.all([
    readToken(collateralAsset),
    readToken(debtAsset),
    readPolicy(policyId, "MARKET"),
    safe(book(collateralMarket), "Collateral book"),
    safe(book(debtMarket), "Debt book"),
    safe(price(collateralAsset), "Collateral price"),
    safe(price(debtAsset), "Debt price"),
    safe(apr("supplyRatePerBlock"), "Supply rate"),
    safe(apr("borrowRatePerBlock"), "Borrow rate"),
  ]);
  const pick = <T, U>(m: Maybe<T>, fn: (value: T) => U): Maybe<U> => (m.status === "ok" ? ok(fn(m.value)) : m);
  return {
    id: controller,
    index,
    controller: ok(controller),
    owner: ok(owner),
    ownedByViewer: viewer !== null && owner.toLowerCase() === viewer.toLowerCase(),
    active,
    createdAt: "",
    limits: { borrowLtvBps: limits[0], liquidationLtvBps: limits[1], collateralSupplyCap: limits[2], debtSupplyCap: limits[3], borrowCap: limits[4], minCash: limits[5] },
    policy,
    collateral: { token: collateralToken, pToken: ok(collateralMarket), totalSupplied: pick(collateralBook, (b) => b.supplied), price: collateralPrice },
    debt: {
      token: debtToken,
      pToken: ok(debtMarket),
      totalSupplied: pick(debtBook, (b) => b.supplied),
      totalBorrowed: pick(debtBook, (b) => b.borrows),
      cash: pick(debtBook, (b) => b.cash),
      price: debtPrice,
      supplyAprBps,
      borrowAprBps,
    },
  };
}

export async function readMarketById(id: string, viewer: Address | null): Promise<Market | null> {
  const controllers = await listControllers();
  const index = controllers.findIndex((controller) => controller.toLowerCase() === id.toLowerCase());
  return index < 0 ? null : readMarket(controllers[index]!, index, viewer);
}

/* ---------- positions and accounts ---------- */

const addr = (m: Maybe<Address>): Address => {
  if (m.status !== "ok") throw new Error(m.reason);
  return m.value;
};

export async function readPosition(market: Market, holder: Address, path: Position["path"]): Promise<Position> {
  const rpc = client();
  const collateralPToken = addr(market.collateral.pToken);
  const debtPToken = addr(market.debt.pToken);
  const [collateralShares, collateralRate, lentShares, debtRate, debt, entered, idleCollateral, idleDebtAsset] = await Promise.all([
    rpc.readContract({ address: collateralPToken, abi: ABI.pToken, functionName: "balanceOf", args: [holder] }),
    rpc.readContract({ address: collateralPToken, abi: ABI.pToken, functionName: "exchangeRateStored" }),
    rpc.readContract({ address: debtPToken, abi: ABI.pToken, functionName: "balanceOf", args: [holder] }),
    rpc.readContract({ address: debtPToken, abi: ABI.pToken, functionName: "exchangeRateStored" }),
    rpc.readContract({ address: debtPToken, abi: ABI.pToken, functionName: "borrowBalanceStored", args: [holder] }),
    rpc.readContract({ address: addr(market.controller), abi: ABI.controller, functionName: "collateralEntered", args: [holder] }),
    rpc.readContract({ address: addr(market.collateral.token.address), abi: ABI.token, functionName: "balanceOf", args: [holder] }),
    rpc.readContract({ address: addr(market.debt.token.address), abi: ABI.token, functionName: "balanceOf", args: [holder] }),
  ]);
  return {
    marketId: market.id,
    path,
    holder: ok(holder),
    collateralSupplied: (collateralShares * collateralRate) / WAD,
    collateralEntered: entered,
    lent: (lentShares * debtRate) / WAD,
    debt,
    idleCollateral,
    idleDebtAsset,
  };
}

export async function accountOf(owner: Address, controller: Address): Promise<Address | null> {
  const account = await client().readContract({ address: contract("SentinelAccountFactory"), abi: ABI.sentinelFactory, functionName: "accountOf", args: [owner, controller] });
  return account === zeroAddress ? null : account;
}

export async function readAccount(market: Market, owner: Address): Promise<SentinelAccount | null> {
  const account = await accountOf(owner, addr(market.controller));
  if (!account) return null;
  const rpc = client();
  const [policyId, trigger, position, grants, block] = await Promise.all([
    rpc.readContract({ address: account, abi: ABI.sentinel, functionName: "policyId" }),
    rpc.readContract({ address: account, abi: ABI.sentinel, functionName: "autoRepayTriggerBps" }),
    readPosition(market, account, "sentinel"),
    // Grants live in a mapping, so candidates come from OperatorSet logs in the scanned window, from this browser's
    // memory of grants it made, and from hints (the keeper's configured operator). The chain read below decides.
    scanLogs(`operator-set:${account}`, (fromBlock, toBlock) => rpc.getContractEvents({ address: account, abi: ABI.sentinel, eventName: "OperatorSet", fromBlock, toBlock, strict: true }))
      .then((scan) => scan.logs)
      .catch(() => []),
    rpc.getBlock(),
  ]);
  const candidates = new Map<string, Address>();
  for (const operator of [...grants.map((log) => log.args.operator), ...rememberedOperators(WRITE_CHAIN_ID, account), ...(hintedOperators.get(account.toLowerCase()) ?? [])]) candidates.set(operator.toLowerCase(), operator);
  const operators: OperatorGrant[] = await Promise.all(
    [...candidates.values()].map(async (operator) => {
      const [mask, remaining, expiry] = await rpc.readContract({ address: account, abi: ABI.sentinel, functionName: "operators", args: [operator] });
      const lastGrant = grants.filter((log) => log.args.operator.toLowerCase() === operator.toLowerCase()).at(-1);
      return {
        operator: ok(operator),
        label: "Operator",
        opsMask: mask,
        remaining,
        granted: lastGrant && mask !== 0 ? ok(lastGrant.args.maxAmount) : unavailable<bigint>("The grant's event is outside the scanned block range"),
        expiresAt: new Date(Number(expiry) * 1000).toISOString(),
        expired: mask !== 0 && expiry <= block.timestamp,
        revoked: mask === 0,
      };
    }),
  );
  return { marketId: market.id, address: ok(account), owner: ok(owner), policy: await readPolicy(policyId, "ACCOUNT"), autoRepayTriggerBps: trigger, operators, position };
}

/* ---------- what an operator can and cannot do ---------- */

export interface OperatorProbe {
  id: "withdraw" | "set-policy" | "set-operator" | "auto-repay";
  call: string;
  title: string;
  outcome: "reverts" | "would-succeed";
  /** Decoded revert, when the call reverts. */
  error?: RawError;
  note: string;
}

/**
 * Read-only proof of the operator's limits: each call is an eth_call of the real account entrypoint with the
 * operator as the sender. Nothing is signed or sent, and the operator's key is never involved.
 */
export async function probeOperator(market: Market, account: Address, operator: Address): Promise<OperatorProbe[]> {
  const rpc = client();
  const abi = withErrors(ABI.sentinel);
  const debtAsset = addr(market.debt.token.address);
  const run = async (id: OperatorProbe["id"], title: string, call: string, simulate: () => Promise<unknown>, okNote: (result: unknown) => string): Promise<OperatorProbe> => {
    try {
      return { id, title, call, outcome: "would-succeed", note: okNote(await simulate()) };
    } catch (error) {
      const raw = extractRaw(error);
      return { id, title, call, outcome: "reverts", error: raw, note: raw.name ? `Reverts with ${raw.name}().` : "Reverts." };
    }
  };
  const base = { account: operator, address: account, abi } as const;
  return Promise.all([
    run("withdraw", "Withdraw funds", `withdraw(${market.debt.token.symbol}, 1)`, () => rpc.simulateContract({ ...base, functionName: "withdraw", args: [debtAsset, 1n] }), () => "The call would succeed. This is unexpected: do not rely on this account."),
    run("set-policy", "Change or remove your policy", "setPolicy(0x0)", () => rpc.simulateContract({ ...base, functionName: "setPolicy", args: [ZERO_ID] }), () => "The call would succeed. This is unexpected."),
    run("set-operator", "Give itself more permissions", "setOperator(self, borrow+repay, max, never)", () => rpc.simulateContract({ ...base, functionName: "setOperator", args: [operator, 12, 2n ** 255n, 2n ** 63n] }), () => "The call would succeed. This is unexpected."),
    run("auto-repay", "Repay debt from the account's idle funds", "autoRepay()", () => rpc.simulateContract({ ...base, functionName: "autoRepay", args: [] }).then((simulation) => simulation.result), (result) => `Would repay ${typeof result === "bigint" ? result.toString() : "?"} raw ${market.debt.token.symbol} units right now.`),
  ]);
}

/* ---------- keeper-reported transactions, checked against the chain ---------- */

export interface AutoRepayFact {
  hash: Hex;
  blockNumber: bigint;
  operator: Address;
  amount: bigint;
  ltvBeforeBps: bigint;
  ltvAfterBps: bigint;
}
export type ReceiptFact = { found: false } | { found: true; status: "success" | "reverted"; blockNumber: bigint; gasUsed: bigint; autoRepay: AutoRepayFact | null };

/** Reads each reported hash's receipt and looks for AutoRepayExecuted emitted by the keeper's account itself. */
export async function verifyKeeperReceipts(account: Address, hashes: readonly Hex[]): Promise<Record<string, ReceiptFact>> {
  const rpc = client();
  const entries = await Promise.all(
    hashes.map(async (hash): Promise<[string, ReceiptFact]> => {
      try {
        const receipt = await rpc.getTransactionReceipt({ hash });
        const event = parseEventLogs({ abi: ABI.sentinel, eventName: "AutoRepayExecuted", logs: receipt.logs.filter((log) => log.address.toLowerCase() === account.toLowerCase()) }).at(0);
        return [hash.toLowerCase(), { found: true, status: receipt.status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, autoRepay: event ? { hash, blockNumber: receipt.blockNumber, ...event.args } : null }];
      } catch {
        return [hash.toLowerCase(), { found: false }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** AutoRepayExecuted events of one account in the scanned block range, newest first. */
export async function readAutoRepays(account: Address): Promise<{ events: AutoRepayFact[]; fromBlock: bigint; complete: boolean }> {
  const rpc = client();
  const scan = await scanLogs(`auto-repays:${account}`, (fromBlock, toBlock) => rpc.getContractEvents({ address: account, abi: ABI.sentinel, eventName: "AutoRepayExecuted", fromBlock, toBlock, strict: true }));
  return { events: scan.logs.map((log) => ({ hash: log.transactionHash, blockNumber: log.blockNumber, ...log.args })).reverse(), fromBlock: scan.fromBlock, complete: scan.complete };
}

/* ---------- operation preview ---------- */

export interface PreparedCall {
  title: string;
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  /** Compound-style entrypoints return an error code instead of reverting for some failures. */
  returnsCode: boolean;
}

export function sharesFor(amount: bigint, exchangeRate: bigint): bigint {
  return (amount * WAD + exchangeRate - 1n) / exchangeRate; // exact underlying redemption rounds shares up
}

/** The exact entrypoint the wallet will call for a request. Used for both simulation and the real transaction. */
export async function operationCall(market: Market, request: OperationRequest, sentinel: Address | null): Promise<PreparedCall> {
  const { op, leg, amount } = request;
  const token = leg === "collateral" ? market.collateral.token : market.debt.token;
  const title = `${OP_LABEL[op]} ${token.symbol}`;
  if (request.path === "sentinel") {
    if (!sentinel) throw new Error("No Sentinel account for this market");
    const base = { title, address: sentinel, abi: withErrors(ABI.sentinel), returnsCode: false };
    if (op === Op.SUPPLY) return { ...base, functionName: "supply", args: [amount] };
    if (op === Op.BORROW) return { ...base, functionName: "borrow", args: [amount] };
    if (op === Op.REPAY) return { ...base, functionName: "repay", args: [amount] };
    if (op === Op.REDEEM) {
      const rate = await client().readContract({ address: addr(market.collateral.pToken), abi: ABI.pToken, functionName: "exchangeRateStored" });
      return { ...base, functionName: "redeem", args: [sharesFor(amount, rate)] };
    }
    throw new Error(`${OP_LABEL[op]} is not available from a Sentinel account`);
  }
  const pToken = leg === "collateral" ? addr(market.collateral.pToken) : addr(market.debt.pToken);
  const base = { title, address: pToken, abi: withErrors(ABI.pToken), returnsCode: true };
  if (op === Op.SUPPLY) return { ...base, functionName: "mint", args: [amount] };
  if (op === Op.BORROW) return { ...base, functionName: "borrow", args: [amount] };
  if (op === Op.REPAY) return { ...base, functionName: "repayBorrow", args: [amount] };
  if (op === Op.REDEEM) return { ...base, functionName: "redeemUnderlying", args: [amount] };
  throw new Error(`${OP_LABEL[op]} is not available here`);
}

/** Token allowance the wallet must grant before a direct supply or repay. Null when none is needed. */
export async function requiredApproval(market: Market, request: OperationRequest, wallet: Address): Promise<{ token: TokenInfo; spender: Address; amount: bigint } | null> {
  if (request.path !== "direct" || (request.op !== Op.SUPPLY && request.op !== Op.REPAY)) return null;
  const leg = request.leg === "collateral" ? market.collateral : market.debt;
  const spender = addr(leg.pToken);
  const allowance = await client().readContract({ address: addr(leg.token.address), abi: ABI.token, functionName: "allowance", args: [wallet, spender] });
  return allowance >= request.amount ? null : { token: leg.token, spender, amount: request.amount };
}

export async function previewOnChain(request: OperationRequest, wallet: Address): Promise<OperationPreview> {
  const rpc = client();
  const market = await readMarketById(request.marketId, wallet);
  if (!market) throw new Error("Market not found on chain");
  const controller = addr(market.controller);
  const sentinel = request.path === "sentinel" ? await readAccount(market, wallet) : null;
  if (request.path === "sentinel" && !sentinel) throw new Error("You have no Sentinel account for this market yet");
  const holder = sentinel ? addr(sentinel.address) : wallet;
  const position = sentinel ? sentinel.position : await readPosition(market, wallet, "direct");
  const { op, leg, amount } = request;
  const token = leg === "collateral" ? market.collateral.token : market.debt.token;
  const pToken = leg === "collateral" ? addr(market.collateral.pToken) : addr(market.debt.pToken);

  // 1. The controller's own preview: the authoritative context both circuits will see.
  let applies = false;
  let context: { op: OpId; oracleFresh: boolean; postLtvBps: number; cashOk: boolean } | null = null;
  if (op === Op.SUPPLY || op === Op.BORROW || op === Op.REDEEM) {
    const policyAmount = op === Op.REDEEM ? sharesFor(amount, await rpc.readContract({ address: pToken, abi: ABI.pToken, functionName: "exchangeRateStored" })) : amount;
    const preview = await safe(rpc.readContract({ address: controller, abi: ABI.controller, functionName: "previewPolicy", args: [holder, op, pToken, policyAmount] }), "previewPolicy");
    if (preview.status === "ok") {
      applies = preview.value[0];
      if (applies && preview.value[2] <= 10_000n) context = { op, oracleFresh: preview.value[1], postLtvBps: Number(preview.value[2]), cashOk: preview.value[3] };
    }
  }
  const ltvBefore = await safe(rpc.readContract({ address: controller, abi: ABI.controller, functionName: "currentLtvBps", args: [holder] }), "Loan-to-value");

  // 2. The decisive answer: eth_call of the real entrypoint as the real sender.
  const approval = await requiredApproval(market, request, wallet);
  // A Sentinel supply first moves the tokens from the wallet into the account (a plain transfer), so the
  // supply itself can only be simulated once the account is funded.
  const needsFunding = sentinel !== null && op === Op.SUPPLY && position.idleCollateral < amount;
  const walletCollateral = needsFunding ? await rpc.readContract({ address: addr(market.collateral.token.address), abi: ABI.token, functionName: "balanceOf", args: [wallet] }) : 0n;
  let simulated = false;
  let failure: RawError | null = null;
  if (!approval && !needsFunding) {
    simulated = true;
    try {
      const call = await operationCall(market, request, sentinel ? addr(sentinel.address) : null);
      const { result } = await rpc.simulateContract({ account: wallet, address: call.address, abi: call.abi as typeof ABI.pToken, functionName: call.functionName as "mint", args: call.args as [bigint] });
      if (call.returnsCode && typeof result === "bigint" && result !== 0n) failure = { name: "MarketOperationFailed", args: [result] };
    } catch (error) {
      failure = extractRaw(error);
    }
  }

  // 2b. For a circuit layer the simulation never reached, ask the deployed circuit directly: adapter.enforce is a
  // public view that evaluates one policy on given inputs. This is a separate eth_call, not part of the transaction path.
  const deployedVerdict = async (record: PolicyRecord | undefined, kind: 0 | 1): Promise<"allow" | "deny" | null> => {
    if (!context || !record || record.registration.status !== "ok") return null;
    try {
      await rpc.simulateContract({ account: wallet, address: contract("TapeOutPolicyAdapter"), abi: withErrors(ABI.adapter), functionName: "enforce", args: [record.registration.value.policyId, kind, context.op, context.oracleFresh, BigInt(context.postLtvBps), context.cashOk] });
      return "allow";
    } catch (error) {
      const name = extractRaw(error).name;
      return name === "MarketPolicyRejected" || name === "AccountPolicyRejected" ? "deny" : null;
    }
  };
  const marketVerdict = failure?.name === "AccountPolicyRejected" ? await deployedVerdict(market.policy, 0) : null;

  // 3. Explain it layer by layer. Statuses follow the simulation; local circuit runs only add detail.
  const available = op === Op.SUPPLY ? (leg === "collateral" ? position.idleCollateral + walletCollateral : position.idleDebtAsset) : op === Op.REPAY ? position.idleDebtAsset : op === Op.REDEEM ? (leg === "collateral" ? position.collateralSupplied : position.lent) : null;
  const order: CheckResult["id"][] = [...(available !== null ? (["balance"] as const) : []), ...(request.path === "sentinel" ? (["account-policy"] as const) : []), "protocol", "market-policy"];
  const failedId: CheckResult["id"] | null = !failure
    ? null
    : failure.name === "AccountPolicyRejected" || failure.name === "AccountPolicyMissing"
      ? "account-policy"
      : failure.name === "MarketPolicyRejected"
        ? "market-policy"
        : /^ERC20Insufficient|^TokenOperationFailed|^InvalidAmount/.test(failure.name ?? "") || (available !== null && amount > available)
          ? "balance"
          : "protocol";
  const failedIndex = failedId ? order.indexOf(failedId) : -1;
  const circuit = (record: PolicyRecord | undefined) => (record?.identified && record.compiled.status === "ok" && context ? evaluateLocally(record.compiled.value, context) : null);
  const titles: Record<CheckResult["id"], string> = { balance: "Available funds", "account-policy": "Your Sentinel policy", protocol: "Protocol safety limits", "market-policy": "Market policy" };
  const checks: CheckResult[] = order.map((id, index): CheckResult => {
    const base = { id, title: titles[id], decisive: false };
    const isCircuit = id === "account-policy" || id === "market-policy";
    if (isCircuit && !applies && index !== failedIndex) return { ...base, status: "not-applicable", basis: "none", detail: `${OP_LABEL[op]} is never gated by a policy circuit here.` };
    const record = id === "account-policy" ? sentinel?.policy : id === "market-policy" ? market.policy : undefined;
    const local = isCircuit ? circuit(record) : null;
    const evaluation = local?.status === "ok" ? local.value : undefined;
    const ltvText = context ? `Loan-to-value after: ${formatBps(context.postLtvBps)}` : "Loan-to-value after: not available";
    const capDetail = record?.identified ? `${ltvText}, cap ${formatBps(record.spec.params.maxLtvBps)}.` : `${ltvText}.`;
    if (index === failedIndex) {
      const detail = id === "balance" && available !== null ? `Only ${available} raw ${token.symbol} units available.` : isCircuit ? `The circuit denied this operation in the simulation. ${capDetail}` : `Reverted with ${failure?.name ?? "an unknown error"}. ${ltvText}, borrowing limit ${formatBps(market.limits.borrowLtvBps)}.`;
      return { ...base, status: "fail", basis: "simulation", decisive: true, detail, evaluation, error: failure ?? undefined };
    }
    if (failedIndex >= 0 && index > failedIndex) {
      // A later layer never ran on chain. A circuit can still be run locally on the same inputs; that is a preview, not a chain result.
      const stoppedBy = { balance: "the funds check", "account-policy": "your Sentinel policy", protocol: "a protocol safety limit", "market-policy": "the market policy" }[order[failedIndex]!];
      if (evaluation) {
        return {
          ...base,
          status: evaluation.allow ? "pass" : "fail",
          basis: "local-preview",
          detail: `${evaluation.allow ? "Would allow" : "Would also deny"}. Not reached on chain, because ${stoppedBy} rejected first. ${LOCAL_PREVIEW_LABEL} of the same circuit on the same inputs: ${evaluation.allow ? "allow" : "deny"}. ${capDetail}${id === "market-policy" && marketVerdict ? ` A separate eth_call of the deployed circuit on these inputs returns ${marketVerdict}.` : ""}`,
          evaluation,
        };
      }
      return { ...base, status: "unknown", basis: "none", detail: `Not reached: ${stoppedBy} already rejected the operation.` };
    }
    if (!simulated) {
      if (evaluation) return { ...base, status: evaluation.allow ? "pass" : "fail", basis: "local-preview", detail: `${LOCAL_PREVIEW_LABEL} of the circuit: ${evaluation.allow ? "allow" : "deny"}. ${capDetail}`, evaluation };
      if (id === "balance" && available !== null) return { ...base, status: amount <= available ? "pass" : "fail", basis: "none", detail: amount <= available ? "Enough funds available." : "Not enough funds available." };
      return { ...base, status: "unknown", basis: "none", detail: needsFunding ? "Checked by simulation once the account is funded." : "Checked by simulation once the token approval is in place." };
    }
    // The simulation got past this layer: for a circuit that means it really ran inside the eth_call and allowed.
    const ran = failedIndex >= 0 ? "Allowed in the simulation: this circuit ran inside the same eth_call and passed." : "Allowed in the simulation.";
    const detail = id === "balance" ? "Enough funds available." : isCircuit ? `${ran} ${capDetail}` : applies ? `${ltvText}, borrowing limit ${formatBps(market.limits.borrowLtvBps)}, liquidation at ${formatBps(market.limits.liquidationLtvBps)}.` : "Solvency, cash and authentication passed. No risk increase.";
    return { ...base, status: "pass", basis: "simulation", detail, evaluation };
  });

  const localFailure = !simulated ? checks.find((check) => check.status === "fail") : undefined;
  if (localFailure) localFailure.decisive = true;
  const by = (id: CheckResult["id"]): RejectionSource => (id === "balance" ? "balance" : id === "protocol" ? "protocol" : id);
  const outcome: OperationPreview["outcome"] = failure && failedId
    ? { status: "rejected", by: failure.name === "PolicyEvaluationFailed" || failure.name === "UnavailablePolicy" ? "policy-unavailable" : by(failedId), error: failure }
    : localFailure
      ? { status: "rejected", by: by(localFailure.id), error: localFailure.id === "balance" ? { name: "InsufficientBalance" } : { name: localFailure.id === "account-policy" ? "AccountPolicyRejected" : "MarketPolicyRejected", message: "Local circuit run; not yet simulated on chain" } }
      : { status: "allowed" };
  const inputs = checks.find((check) => check.evaluation)?.evaluation?.inputs;
  return {
    source: "chain",
    method: simulated ? "controller.previewPolicy + eth_call of the real entrypoint as your wallet" : needsFunding ? "controller.previewPolicy; full simulation runs after the account is funded" : "controller.previewPolicy; full simulation runs after the token approval",
    request,
    applies,
    ltvBeforeBps: ltvBefore.status === "ok" ? ok(Number(ltvBefore.value)) : ltvBefore,
    ltvAfterBps: context ? ok(context.postLtvBps) : unavailable(applies ? "Above the representable range" : "Unchanged or not computed for this operation"),
    context: context ? ok({ ...context, inputs: (inputs ?? "0x") as Hex }) : unavailable(applies ? "Loan-to-value cannot be encoded" : "No policy context: this operation is not gated"),
    checks,
    outcome,
  };
}

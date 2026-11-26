/**
 * Sentinel Connect (MCP): what the app knows about it, all from recorded evidence, none of it retyped.
 *   evidence/session5-mcp/tools.json          the tool catalogue the server announced to an external MCP client
 *   evidence/session5-mcp/flagship-1952.json  that client's seven-step run on public X Layer testnet 1952
 * Fields are picked defensively: a missing or malformed field makes the whole bundle unavailable, never a guess.
 *
 * Wording rule: this is AGENT-DIRECTED EXECUTION. The server acts only when its MCP host calls a tool. Nothing in
 * it watches an account on its own, so the app never calls it autonomous or monitoring.
 */
import { RAW_EVIDENCE } from "../generated/evidence.ts";
import { type Maybe, ok, unavailable } from "./maybe.ts";

export const CONNECT_STATUS_LABEL = "Available on testnet (agent-directed)";
export const CONNECT_SCOPE_LABEL = "X Layer testnet 1952: mock tokens, owner-set mock price feed, development reference processor (not TapeOut)";
/** The keyless command an MCP host starts over stdio (services/mcp/README.md). The path is the reader's own checkout. */
export const CONNECT_STDIO_COMMAND = "node /absolute/path/to/peridot-sentinel/services/mcp/server.mjs";
export const CONNECT_SETUP_COMMANDS = [
  "npm ci",
  "npm ci --prefix services/mcp/runtime --workspaces=false --ignore-scripts --no-audit --no-fund",
  "npm run build -w @peridot/chain-config",
  "node services/mcp/client.mjs list",
] as const;
/** Environment of the MCP HOST process that enables the single signing tool. Never entered in this app. */
export const CONNECT_EXECUTE_ENV = ["SENTINEL_ENABLE_EXECUTE=1", "SENTINEL_OPERATOR_KEY=<operator key, from the host's own secret store>"] as const;

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : typeof value === "number" ? String(value) : null);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^\d+$/;
const uint = (value: unknown): bigint | null => {
  const text = str(value);
  return text !== null && UINT.test(text) ? BigInt(text) : null;
};

/* ---------- tools ---------- */

/** read: eth_call / RPC reads only. proposal: writes a local five-minute proposal, no transaction. execute: may send. */
export type ConnectToolKind = "read" | "proposal" | "execute";
export interface ConnectTool {
  name: string;
  description: string;
  kind: ConnectToolKind;
  /** Property names of the input schema; empty for tools that take `{}`. */
  inputs: string[];
}

export function parseConnectTools(json: unknown): Maybe<{ server: string; version: string; tools: ConnectTool[] }> {
  const root = rec(json);
  const server = rec(root?.server);
  const list = Array.isArray(root?.tools) ? root.tools : null;
  if (!root || !server || !list || !str(server.name)) return unavailable("The Sentinel Connect tool catalogue is not available in this build");
  const tools: ConnectTool[] = [];
  for (const entry of list) {
    const tool = rec(entry);
    const annotations = rec(tool?.annotations);
    const name = str(tool?.name);
    const description = str(tool?.description);
    // The kind comes from the server's own annotations. A tool without them is not classified by guessing.
    if (!tool || !name || !description || !annotations || typeof annotations.readOnlyHint !== "boolean" || typeof annotations.destructiveHint !== "boolean") return unavailable("The Sentinel Connect tool catalogue has an entry this app cannot classify");
    const kind: ConnectToolKind = annotations.destructiveHint ? "execute" : annotations.readOnlyHint ? "read" : "proposal";
    tools.push({ name, description, kind, inputs: Object.keys(rec(rec(tool.inputSchema)?.properties) ?? {}) });
  }
  return ok({ server: str(server.name)!, version: str(server.version) ?? "?", tools });
}

/* ---------- the recorded seven-step run ---------- */

export interface ConnectBlock {
  number: string;
  hash: string;
}
export interface ConnectGrantRecord {
  account: string;
  operator: string;
  triggerBps: number;
  opMask: number;
  remainingRaw: bigint;
  expiry: bigint;
  repayOnly: boolean;
}
export interface ConnectTranscript {
  file: string;
  transport: string;
  chainId: 1952;
  account: string;
  owner: string;
  operator: string;
  /** The debt asset the operator may repay, from the positions the agent read in step 1. */
  debt: { symbol: string; decimals: number; address: string };
  step1: { block: ConnectBlock; positionsBlock: ConnectBlock; debtStoredRaw: bigint; idleDebtAssetRaw: bigint; collateral: { symbol: string; decimals: number; suppliedRaw: bigint } | null };
  step2: { block: ConnectBlock; policies: Array<{ layer: string; id: string; netlistHash: string | null; gateCount: string | null }>; grant: ConnectGrantRecord; grantBlock: ConnectBlock };
  /** Step 3. `quote` is null unless the record carries a complete OKX quote; then there is no number at all. */
  step3: { provider: string; chainId: number; status: string; code: string | null; requested: { from: string | null; amountRaw: bigint | null }; quote: ConnectQuote | null };
  step4: { block: ConnectBlock; eligible: boolean; amountRaw: bigint; proposalId: string; proposalBlock: ConnectBlock; selector: string; validUntil: bigint };
  step5: { hash: string; block: ConnectBlock; gasUsed: string; from: string; to: string; selector: string; valueWei: string; amountRaw: bigint; ltvBeforeBps: number; ltvAfterBps: number; debtBeforeRaw: bigint; debtAfterRaw: bigint; grantBeforeRaw: bigint; grantAfterRaw: bigint };
  /** Step 6 is a read-only eth_call simulation of the real entrypoint as the operator. No transaction exists for it. */
  step6: { block: ConnectBlock; method: string; operation: string; amountRaw: bigint; rejected: boolean; error: string; args: string[]; revertData: string };
  step7: { block: ConnectBlock; grant: ConnectGrantRecord; confirmations: string };
}

/**
 * The only pair the quote tool serves (services/onchainos/quote.mjs): WOKB and native USDC on X Layer mainnet 196.
 * A quote naming any other token, chain or source is not shown.
 */
export const QUOTE_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0xe538905cf8410324e03a5a23c1c177a474d59b2b": { symbol: "WOKB", decimals: 18 },
  "0xb6ceceab302e2e4948951ee7843fc24e92933061": { symbol: "USDC", decimals: 6 },
};
export const QUOTE_SOURCE = "OKX OnchainOS";
export interface ConnectQuote {
  source: typeof QUOTE_SOURCE;
  chainId: 196;
  tokenIn: { address: string; symbol: string; decimals: number };
  tokenOut: { address: string; symbol: string; decimals: number };
  amountInRaw: bigint;
  amountOutRaw: bigint;
  /** ISO timestamp the provider request was signed at. A quote is a price indication at that moment, nothing more. */
  observedAt: string;
}
/** Strict: every field the UI prints must be present and from the expected provider, chain and pair. Otherwise null. */
export function parseConnectQuote(value: unknown): ConnectQuote | null {
  const q = rec(value);
  const tokenIn = str(q?.tokenIn)?.toLowerCase();
  const tokenOut = str(q?.tokenOut)?.toLowerCase();
  const amountIn = uint(q?.amountIn);
  const amountOut = uint(q?.amountOut);
  const observedAt = str(q?.observedAt);
  if (!q || q.source !== QUOTE_SOURCE || q.chainId !== 196 || !tokenIn || !tokenOut || tokenIn === tokenOut || !QUOTE_TOKENS[tokenIn] || !QUOTE_TOKENS[tokenOut] || amountIn === null || amountOut === null || amountIn === 0n || amountOut === 0n || !observedAt || Number.isNaN(Date.parse(observedAt))) return null;
  return { source: QUOTE_SOURCE, chainId: 196, tokenIn: { address: tokenIn, ...QUOTE_TOKENS[tokenIn]! }, tokenOut: { address: tokenOut, ...QUOTE_TOKENS[tokenOut]! }, amountInRaw: amountIn, amountOutRaw: amountOut, observedAt };
}

const block = (value: unknown): ConnectBlock | null => {
  const b = rec(value);
  const number = str(b?.number);
  const hash = str(b?.hash);
  return number && UINT.test(number) && hash && HASH.test(hash) ? { number, hash } : null;
};
const grant = (value: unknown): ConnectGrantRecord | null => {
  const g = rec(value);
  const account = str(g?.account);
  const operator = str(g?.operator);
  const remaining = uint(g?.remainingDebtRaw);
  const expiry = uint(g?.expiry);
  if (!g || !account || !ADDRESS.test(account) || !operator || !ADDRESS.test(operator) || remaining === null || expiry === null || typeof g.triggerBps !== "number" || typeof g.opMask !== "number" || typeof g.repayOnly !== "boolean") return null;
  return { account, operator, triggerBps: g.triggerBps, opMask: g.opMask, remainingRaw: remaining, expiry, repayOnly: g.repayOnly };
};

export function parseConnectTranscript(json: unknown, file: string | null): Maybe<ConnectTranscript> {
  const fail = (what: string) => unavailable<ConnectTranscript>(`The recorded Sentinel Connect run is not usable in this build (${what})`);
  const root = rec(json);
  const steps = rec(root?.steps);
  if (!file || !root || !steps) return fail("file missing");
  if (root.chainId !== 1952) return fail("not chain 1952");

  const s1a = rec(rec(steps["1"])?.account);
  const s1p = rec(rec(steps["1"])?.positions);
  const accountData = rec(s1a?.data);
  const positions = Array.isArray(s1p?.data) ? s1p.data.map(rec) : [];
  const debtPosition = positions.find((position) => position?.kind === "debt") ?? null;
  const collateralPosition = positions.find((position) => position?.kind === "collateral") ?? null;
  const b1 = block(s1a?.block);
  const b1p = block(s1p?.block);
  const account = str(accountData?.account);
  const owner = str(accountData?.owner);
  const debtStored = uint(debtPosition?.borrowedStoredRaw);
  const idle = uint(debtPosition?.idleRaw);
  if (!b1 || !b1p || !account || !ADDRESS.test(account) || !owner || !ADDRESS.test(owner) || !debtPosition || typeof debtPosition.decimals !== "number" || !str(debtPosition.symbol) || !str(debtPosition.asset) || debtStored === null || idle === null) return fail("step 1");
  const collateralSupplied = uint(collateralPosition?.suppliedRaw);

  const s2 = rec(steps["2"]);
  const s2policies = rec(s2?.policies);
  const s2auth = rec(s2?.authorization);
  const b2 = block(s2policies?.block);
  const b2g = block(s2auth?.block);
  const g2 = grant(s2auth?.data);
  if (!b2 || !b2g || !g2 || !Array.isArray(s2policies?.data)) return fail("step 2");
  const policies = s2policies.data.flatMap((entry) => {
    const policy = rec(entry);
    const id = str(policy?.id);
    const layer = str(policy?.layer);
    const registryEntry = rec(policy?.entry);
    return id && layer ? [{ layer, id, netlistHash: str(registryEntry?.netlistHash), gateCount: str(registryEntry?.gateCount) }] : [];
  });

  const s3 = rec(steps["3"]);
  const status3 = str(s3?.status);
  if (!s3 || !status3 || typeof s3.chainId !== "number") return fail("step 3");
  // A quote is shown only when the record carries a complete one from the expected provider. No number otherwise.
  const quote3 = status3 === "blocked" ? null : parseConnectQuote(s3.quote);

  const s4 = rec(steps["4"]);
  const simulation = rec(s4?.simulation);
  const proposed = rec(s4?.proposed);
  const proposal = rec(proposed?.proposal);
  const simData = rec(simulation?.data);
  const b4 = block(simulation?.block);
  const b4p = block(proposed?.block);
  const amount4 = uint(simData?.amountRaw);
  const proposalId = str(proposal?.id);
  const validUntil = uint(proposal?.validUntil);
  if (!b4 || !b4p || !simData || typeof simData.eligible !== "boolean" || amount4 === null || !proposalId || !HASH.test(proposalId) || !str(proposal?.selector) || validUntil === null) return fail("step 4");

  const s5 = rec(steps["5"]);
  const receipt = rec(s5?.receipt);
  const actual = rec(s5?.actual);
  const before = rec(s5?.before);
  const after = rec(s5?.after);
  const hash = str(receipt?.hash);
  const b5 = block({ number: receipt?.blockNumber, hash: receipt?.blockHash });
  const amount5 = uint(actual?.amount);
  const ltvBefore = uint(actual?.ltvBeforeBps);
  const ltvAfter = uint(actual?.ltvAfterBps);
  const debtBefore = uint(before?.debtStoredRaw);
  const debtAfter = uint(after?.debtStoredRaw);
  const grantBefore = uint(before?.remainingGrantRaw);
  const grantAfter = uint(after?.remainingGrantRaw);
  if (!s5 || s5.state !== "confirmed" || s5.chainId !== 1952 || !receipt || receipt.status !== "success" || !hash || !HASH.test(hash) || !b5 || amount5 === null || ltvBefore === null || ltvAfter === null || debtBefore === null || debtAfter === null || grantBefore === null || grantAfter === null || !str(receipt.from) || !str(receipt.to) || !str(receipt.selector)) return fail("step 5");
  // The transaction must be the proposed one, sent by the granted operator to the account. Anything else is not this run.
  if (str(s5.proposalId) !== proposalId || str(receipt.from)!.toLowerCase() !== g2.operator.toLowerCase() || str(receipt.to)!.toLowerCase() !== account.toLowerCase()) return fail("step 5 does not match the proposal");

  const s6 = rec(steps["6"]);
  const d6 = rec(s6?.data);
  const b6 = block(s6?.block);
  const amount6 = uint(d6?.amountRaw);
  if (!b6 || !d6 || typeof d6.rejected !== "boolean" || !str(d6.error) || !str(d6.method) || !str(d6.operation) || amount6 === null || !str(d6.revertData)) return fail("step 6");

  const s7 = rec(steps["7"]);
  const s7tx = rec(s7?.transaction);
  const s7auth = rec(s7?.updatedAuthorization);
  const b7 = block(s7auth?.block);
  const g7 = grant(s7auth?.data);
  if (!b7 || !g7 || str(rec(s7tx?.receipt)?.hash) !== hash) return fail("step 7");

  return ok({
    file,
    transport: str(root.transport) ?? "MCP stdio",
    chainId: 1952,
    account,
    owner,
    operator: g2.operator,
    debt: { symbol: str(debtPosition.symbol)!, decimals: debtPosition.decimals, address: str(debtPosition.asset)! },
    step1: {
      block: b1,
      positionsBlock: b1p,
      debtStoredRaw: debtStored,
      idleDebtAssetRaw: idle,
      collateral: collateralPosition && typeof collateralPosition.decimals === "number" && str(collateralPosition.symbol) && collateralSupplied !== null ? { symbol: str(collateralPosition.symbol)!, decimals: collateralPosition.decimals, suppliedRaw: collateralSupplied } : null,
    },
    step2: { block: b2, policies, grant: g2, grantBlock: b2g },
    step3: { provider: str(s3.provider) ?? "External quote provider", chainId: s3.chainId, status: status3, code: str(s3.code), requested: { from: str(s3.from), amountRaw: uint(s3.amountRaw) }, quote: quote3 },
    step4: { block: b4, eligible: simData.eligible, amountRaw: amount4, proposalId, proposalBlock: b4p, selector: str(proposal?.selector)!, validUntil },
    step5: { hash, block: b5, gasUsed: str(receipt.gasUsed) ?? "?", from: str(receipt.from)!, to: str(receipt.to)!, selector: str(receipt.selector)!, valueWei: str(receipt.valueWei) ?? "?", amountRaw: amount5, ltvBeforeBps: Number(ltvBefore), ltvAfterBps: Number(ltvAfter), debtBeforeRaw: debtBefore, debtAfterRaw: debtAfter, grantBeforeRaw: grantBefore, grantAfterRaw: grantAfter },
    step6: { block: b6, method: str(d6.method)!, operation: str(d6.operation)!, amountRaw: amount6, rejected: d6.rejected, error: str(d6.error)!, args: Array.isArray(d6.args) ? d6.args.map(String) : [], revertData: str(d6.revertData)! },
    step7: { block: b7, grant: g7, confirmations: str(s7tx?.confirmations) ?? "?" },
  });
}

/* ---------- the LLM-directed session ---------- */

export const LLM_SESSION_LABEL = "LLM-directed single session (Claude via MCP), not continuous autonomous monitoring";
export const LLM_SESSION_SCOPE = "mock venue / mock tokens / mock feed / development reference processor";
interface SessionReceipt {
  hash: string;
  block: string;
  gasUsed: string;
}
export interface LlmSession {
  file: string;
  model: string;
  account: string;
  operator: string;
  tokenIn: { decimals: number };
  tokenOut: { decimals: number };
  /** What the model chose, as recorded in its proposal. */
  chosen: { amountInRaw: bigint; minOutRaw: bigint; proposalId: string };
  venue: { expectedOutRaw: bigint; policyMinimumOutRaw: bigint; hardMinimumOutRaw: bigint } | null;
  /** The OKX quote the session asked for. Null = unavailable; then no number is shown. */
  quote: ConnectQuote | null;
  quoteReason: string | null;
  swap: SessionReceipt & { simulatedOutRaw: bigint | null; spentRaw: bigint; gainedRaw: bigint; grantChargedRaw: bigint; grantBeforeRaw: bigint; grantAfterRaw: bigint; idleInBeforeRaw: bigint; idleInAfterRaw: bigint; idleOutBeforeRaw: bigint; idleOutAfterRaw: bigint; deltasMatch: boolean };
  /** The refused borrow: first a SIMULATED denial (eth_call), then a MINED revert (a transaction that reverted). */
  rejection: { proposalId: string; simulatedError: string; mined: SessionReceipt; minedError: string; statePreserved: boolean };
  transcript: { file: string; result: string; turns: number | null } | null;
}

export function parseLlmSession(json: unknown, file: string | null): Maybe<LlmSession> {
  const fail = (what: string) => unavailable<LlmSession>(`No verified LLM-directed session in this build (${what})`);
  const root = rec(json);
  const swap = rec(root?.swap);
  const rejection = rec(root?.rejection);
  const account = str(root?.account);
  const operator = str(root?.operator);
  if (!file || !root || !swap || !rejection || root.chainId !== 1952 || !account || !ADDRESS.test(account) || !operator || !ADDRESS.test(operator)) return fail("file missing or not chain 1952");
  const receiptOf = (value: unknown, status: string): SessionReceipt | null => {
    const r = rec(value);
    const hash = str(r?.hash);
    const block = str(r?.blockNumber);
    // Each receipt must have been sent by the operator to the account, with the status its row claims.
    if (!r || !hash || !HASH.test(hash) || !block || !UINT.test(block) || r.status !== status || str(r.from)?.toLowerCase() !== operator.toLowerCase() || str(r.to)?.toLowerCase() !== account.toLowerCase()) return null;
    return { hash, block, gasUsed: str(r.gasUsed) ?? "?" };
  };
  const swapReceipt = receiptOf(swap.receipt, "success");
  const chosen = rec(swap.chosenArgs);
  const amountIn = uint(chosen?.amountInRaw);
  const minOut = uint(chosen?.minOutRaw);
  const before = rec(swap.before);
  const after = rec(swap.after);
  const values = [uint(swap.inputBalanceSpentRaw), uint(swap.outputBalanceGainedRaw), uint(swap.grantChargedRaw), uint(rec(before?.swapGrant)?.remainingRaw), uint(rec(after?.swapGrant)?.remainingRaw), uint(rec(before?.idle)?.inputRaw), uint(rec(after?.idle)?.inputRaw), uint(rec(before?.idle)?.outputRaw), uint(rec(after?.idle)?.outputRaw)];
  const pair = rec(root.pair);
  const proposalId = str(swap.proposalId);
  const model = str(swap.model);
  if (swap.status !== "confirmed-swap" || !swapReceipt || amountIn === null || minOut === null || values.some((value) => value === null) || typeof pair?.inputDecimals !== "number" || typeof pair.outputDecimals !== "number" || !proposalId || !model) return fail("swap record incomplete");
  const [spent, gained, charged, grantBefore, grantAfter, inBefore, inAfter, outBefore, outAfter] = values as bigint[];
  // The recorded deltas must add up on their own: what left, what arrived and what the grant was charged.
  const deltasMatch = swap.budgetAndBalancesMatch === true && inBefore! - inAfter! === spent && outAfter! - outBefore! === gained && grantBefore! - grantAfter! === charged && spent === amountIn && gained! >= minOut;
  const simulated = rec(rejection.simulation);
  const replay = rec(rejection.replay);
  const mined = receiptOf(rejection.receipt, "reverted");
  const rejectionId = str(rejection.proposalId);
  if (rejection.status !== "mined-revert" || !mined || simulated?.status !== "simulated-rejection" || !str(simulated.error) || !str(replay?.error) || !rejectionId) return fail("rejection record incomplete");
  const venue = rec(root.venue);
  const venueValues = [uint(venue?.expectedOutRaw), uint(venue?.policyMinimumOutRaw), uint(venue?.hardMinimumOutRaw)];
  const quoteRecord = rec(root.quote);
  const transcript = rec(root.transcript);
  return ok({
    file,
    model,
    account,
    operator,
    tokenIn: { decimals: pair.inputDecimals },
    tokenOut: { decimals: pair.outputDecimals },
    chosen: { amountInRaw: amountIn, minOutRaw: minOut, proposalId },
    venue: venueValues.every((value) => value !== null) ? { expectedOutRaw: venueValues[0]!, policyMinimumOutRaw: venueValues[1]!, hardMinimumOutRaw: venueValues[2]! } : null,
    quote: quoteRecord && quoteRecord.status !== "unavailable" && quoteRecord.status !== "blocked" ? parseConnectQuote(quoteRecord.quote) : null,
    quoteReason: str(quoteRecord?.reason),
    swap: { ...swapReceipt, simulatedOutRaw: uint(rec(swap.simulation)?.amountOutRaw), spentRaw: spent!, gainedRaw: gained!, grantChargedRaw: charged!, grantBeforeRaw: grantBefore!, grantAfterRaw: grantAfter!, idleInBeforeRaw: inBefore!, idleInAfterRaw: inAfter!, idleOutBeforeRaw: outBefore!, idleOutAfterRaw: outAfter!, deltasMatch },
    rejection: { proposalId: rejectionId, simulatedError: str(simulated.error)!, mined, minedError: str(replay?.error)!, statePreserved: rejection.preservedState === true },
    transcript: transcript && typeof transcript.result === "string" && transcript.result.length > 0 && transcript.isError !== true && str(transcript.file) ? { file: str(transcript.file)!, result: transcript.result, turns: typeof transcript.turns === "number" ? transcript.turns : null } : null,
  });
}

export const CONNECT = {
  llm: parseLlmSession(RAW_EVIDENCE.llmSession.json, RAW_EVIDENCE.llmSession.file),
  tools: parseConnectTools(RAW_EVIDENCE.connectTools.json),
  toolsFile: RAW_EVIDENCE.connectTools.file,
  transcript: parseConnectTranscript(RAW_EVIDENCE.connectTranscript.json, RAW_EVIDENCE.connectTranscript.file),
};

/**
 * Connect is advertised as available only while BOTH recorded facts hold in this build: a confirmed public testnet
 * execute, and a catalogue with exactly one tool that can send a transaction. Otherwise it falls back to "development".
 */
export function connectVerified(tools = CONNECT.tools, transcript = CONNECT.transcript): boolean {
  return tools.status === "ok" && transcript.status === "ok" && tools.value.tools.filter((tool) => tool.kind === "execute").length === 1 && transcript.value.step6.rejected;
}

/** What the grant state means for an agent right now. Pure, so it can be tested without a chain. */
export type GrantReadiness = "ready" | "spent" | "expired" | "revoked" | "not-repay-only";
export function grantReadiness(grantState: { opsMask: number; remaining: bigint; expiry: bigint }, nowSeconds: bigint, repayBit: number): GrantReadiness {
  if (grantState.opsMask === 0) return "revoked";
  if (grantState.opsMask !== 1 << repayBit) return "not-repay-only";
  if (grantState.expiry <= nowSeconds) return "expired";
  if (grantState.remaining === 0n) return "spent";
  return "ready";
}

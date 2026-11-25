/**
 * Read-only proxy for the keeper's read API (INTERFACES v1.2, "Keeper reads").
 *
 *   - GET only (no other method is exported, so Next answers 405 for the rest).
 *   - The upstream base URL comes from the server-only env var KEEPER_API_URL. It is never sent to the browser,
 *     and there is no NEXT_PUBLIC_ variant. No credential of any kind is read or forwarded.
 *   - Not an open proxy: exactly two fixed upstream paths, a validated integer `limit`, no redirects, a timeout.
 *   - The response is rebuilt from whitelisted, validated fields (src/lib/keeper.ts).
 *   - Rows are withheld unless the keeper's scope matches this deployment: chain id and Sentinel factory from the
 *     validated manifest, the local node's instance id, and an on-chain round trip proving that the keeper's
 *     account was created by that factory.
 */
import { SentinelAccountAbi, SentinelAccountFactoryAbi } from "@peridot/chain-config";
import { createPublicClient, http } from "viem";
import { TARGET_KIND, WRITE_CHAIN, WRITE_CHAIN_ID } from "@/lib/chains";
import { type Address, type KeeperFeed, type KeeperScope, type ScopeFacts, checkKeeperScope, parseKeeperItems, parseKeeperScope, parseKeeperStatus } from "@/lib/keeper";
import { RUNTIME } from "@/services/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 4000;
const reply = (feed: KeeperFeed | { error: string }, status = 200) => Response.json(feed, { status, headers: { "cache-control": "no-store" } });

function upstreamBase(): URL | null {
  const raw = process.env.KEEPER_API_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

async function upstream(base: URL, path: "/v1/status" | `/v1/activity?limit=${number}`): Promise<unknown> {
  const response = await fetch(new URL(path, base), { method: "GET", cache: "no-store", redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

const sameScope = (a: KeeperScope, b: KeeperScope) => (["environment", "instanceId", "chainId", "factory", "account", "operator"] as const).every((key) => String(a[key]).toLowerCase() === String(b[key]).toLowerCase());

async function nodeInstanceId(rpcUrl: string): Promise<string | null> {
  try {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_metadata", params: [] }), cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const instanceId: unknown = (await response.json())?.result?.instanceId;
    return typeof instanceId === "string" && /^0x[0-9a-fA-F]{64}$/.test(instanceId) ? instanceId : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const limitText = new URL(request.url).searchParams.get("limit") ?? "50";
  if (!/^\d{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 100) return reply({ error: "limit must be an integer from 1 to 100" }, 400);
  const limit = Number(limitText);

  // A build on example data never talks to a keeper.
  const base = upstreamBase();
  if (RUNTIME.manifest.state !== "deployed" || RUNTIME.modes.activity.source !== "chain" || !base) return reply({ state: "not-configured" });
  const factory = RUNTIME.manifest.manifest.contracts.SentinelAccountFactory as Address;

  let statusJson: unknown;
  let activityJson: unknown;
  try {
    [statusJson, activityJson] = await Promise.all([upstream(base, "/v1/status"), upstream(base, `/v1/activity?limit=${limit}`)]);
  } catch {
    return reply({ state: "unavailable", reason: "The keeper service did not answer. This says nothing about on-chain activity." });
  }
  const scope = parseKeeperScope(statusJson);
  const activityScope = parseKeeperScope(activityJson);
  const parsed = parseKeeperItems(activityJson, limit);
  if (!scope || !activityScope || !parsed) return reply({ state: "unavailable", reason: "The keeper service answered in a format this app does not accept (schemaVersion 1 expected)." });
  if (!sameScope(scope, activityScope)) return reply({ state: "unavailable", reason: "The keeper's status and activity describe different scopes." });

  const rpcUrl = WRITE_CHAIN.rpcUrls.default.http[0]!;
  const chain = createPublicClient({ transport: http(rpcUrl, { timeout: TIMEOUT_MS }) });
  let accountOwner: Address | null = null;
  let accountController: Address | null = null;
  let accountFromFactory: boolean | null = null;
  let operatorMask: number | null = null;
  try {
    [accountOwner, accountController] = await Promise.all([
      chain.readContract({ address: scope.account, abi: SentinelAccountAbi, functionName: "owner" }),
      chain.readContract({ address: scope.account, abi: SentinelAccountAbi, functionName: "controller" }),
    ]);
    const roundTrip = await chain.readContract({ address: factory, abi: SentinelAccountFactoryAbi, functionName: "accountOf", args: [accountOwner, accountController] });
    accountFromFactory = roundTrip.toLowerCase() === scope.account.toLowerCase();
  } catch {
    // An address that is not a Sentinel account makes these reads revert: the account does not belong to this deployment.
    accountFromFactory = (await chain.getChainId().catch(() => null)) === null ? null : false;
  }
  try {
    operatorMask = (await chain.readContract({ address: scope.account, abi: SentinelAccountAbi, functionName: "operators", args: [scope.operator] }))[0];
  } catch {
    operatorMask = null;
  }
  const facts: ScopeFacts = {
    target: TARGET_KIND,
    chainId: WRITE_CHAIN_ID,
    factory,
    nodeInstanceId: TARGET_KIND === "local" ? await nodeInstanceId(rpcUrl) : null,
    accountFromFactory,
    operatorMask,
  };
  const check = checkKeeperScope(scope, facts);
  if (!check.ok) return reply({ state: "scope-mismatch", scope, check });
  return reply({ state: "ok", scope, check, status: parseKeeperStatus(statusJson), items: parsed.items, truncated: parsed.truncated, accountOwner, accountController });
}

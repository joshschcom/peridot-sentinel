"use client";
/**
 * Chain implementations (INTERFACES v1.2, generated ABIs). They never return fixture data: a failed or
 * impossible read is `unavailable` with a reason. Every read first requires the deployment check
 * (chain id, bytecode at manifest addresses, template root) to pass.
 */
import { coverageCheckpoint, earlierSegments } from "../../lib/activity-coverage.ts";
import { type SnapshotAutoRepay, type SnapshotPolicyAllowed, activityKey, mergedCoverage, snapshotActivity, unindexedEmitters } from "../../lib/activity-merge.ts";
import { WRITE_CHAIN_ID } from "../../lib/chains.ts";
import { EXPANSION } from "../../lib/expansion.ts";
import { type Maybe, ok, unavailable } from "../../lib/maybe.ts";
import { OP_LABEL, type OpId } from "../../lib/policy.ts";
import { formatBps } from "../../lib/amount.ts";
import { retryRead } from "../../lib/retry.ts";
import { TEMPLATES } from "../fixture/data.ts";
import type { AccountService, ActivityEntry, ActivityFeed, ActivityService, Address, MarketService, PolicyService, SentinelAccount } from "../types.ts";
import { ABI, DEPLOYMENT_BLOCK, client, manifest, scanLogs, verifyDeployment } from "./client.ts";
import { listControllers, previewOnChain, readAccount, readMarket, readMarketById, readPolicy, readPosition } from "./reads.ts";
import { chainWalletService } from "./wallet.ts";

const viewer = (): Address | null => {
  const state = chainWalletService.getState();
  return state.status === "connected" ? state.address : null;
};

async function guarded<T>(read: () => Promise<T>): Promise<Maybe<T>> {
  const check = await verifyDeployment();
  if (!check.ok) return unavailable(`Deployment could not be verified: ${check.reason}`);
  try {
    // One bounded retry round for transient RPC failures (reads only).
    return ok(await retryRead(read, { attempts: 3, baseDelayMs: 500 }));
  } catch (error) {
    return unavailable(error instanceof Error ? error.message.split("\n")[0]! : "On-chain read failed");
  }
}

const allMarkets = async () => {
  const controllers = await listControllers();
  return Promise.all(controllers.map((controller, index) => readMarket(controller, index, viewer())));
};

export const chainMarketService: MarketService = {
  source: "chain",
  listMarkets: () => guarded(allMarkets),
  getMarket: (id) => guarded(() => readMarketById(id, viewer())),
  getDirectPosition: async (marketId) => {
    const wallet = viewer();
    if (!wallet) return unavailable("Connect a wallet to see your position");
    return guarded(async () => {
      const market = await readMarketById(marketId, wallet);
      if (!market) throw new Error("Market not found on chain");
      return readPosition(market, wallet, "direct");
    });
  },
  previewOperation: async (request) => {
    const wallet = viewer();
    if (!wallet) throw new Error("Connect a wallet to preview this operation");
    const check = await verifyDeployment();
    if (!check.ok) throw new Error(`Deployment could not be verified: ${check.reason}`);
    return previewOnChain(request, wallet);
  },
};

const accountsOf = async (wallet: Address): Promise<SentinelAccount[]> => {
  const markets = await allMarkets();
  const accounts = await Promise.all(markets.map((market) => readAccount(market, wallet)));
  return accounts.filter((account): account is SentinelAccount => account !== null);
};

export const chainAccountService: AccountService = {
  source: "chain",
  getAccount: async (marketId) => {
    const wallet = viewer();
    if (!wallet) return unavailable("Connect a wallet to see your Sentinel account");
    return guarded(async () => {
      const market = await readMarketById(marketId, wallet);
      return market ? readAccount(market, wallet) : null;
    });
  },
  listAccounts: async () => {
    const wallet = viewer();
    if (!wallet) return unavailable("Connect a wallet to see your Sentinel accounts");
    return guarded(() => accountsOf(wallet));
  },
};

export const chainPolicyService: PolicyService = {
  source: "chain",
  // Compiler samples, labelled "Sample" in the UI. They are not chain data and carry no registration.
  listTemplates: async () => TEMPLATES,
  listRegistered: () => guarded(() => Promise.all(manifest().tapeout.circuits.map((circuit) => readPolicy(circuit.policyId, circuit.kind)))),
};

/**
 * Settled decisions only: PolicyAllowed (emitted by the Sentinel account and by the controller after their
 * own checks) and AutoRepayExecuted, each tied to its transaction hash. Reverted transactions leave no events.
 *
 * Two sources, one list (see lib/activity-merge.ts): this page's paged log scan, and on X Layer testnet the indexed
 * snapshot shipped with the build. The snapshot is used only after its last block was re-read from the chain and
 * matches. Rows are de-duplicated by transaction hash and log index, and each row says where it was read from.
 */
export const chainActivityService: ActivityService = {
  source: "chain",
  list: async () => {
    const wallet = viewer();
    if (!wallet) return unavailable("Connect a wallet to see your activity");
    return guarded(async (): Promise<ActivityFeed> => {
      const rpc = client();
      const markets = await allMarkets();
      const accounts = await accountsOf(wallet);
      const sentinels = accounts.flatMap((account) => (account.address.status === "ok" ? [account.address.value] : []));
      const holders = [wallet, ...sentinels];
      const controllers = markets.flatMap((market) => (market.controller.status === "ok" ? [market.controller.value] : []));
      // Paged from the deployment block (or as far back as the page budget reaches): see scanLogs.
      const key = [...controllers, ...sentinels, wallet].join(",").toLowerCase();
      const [allowedScan, repayScan] = await Promise.all([
        scanLogs(`allowed:${key}`, (fromBlock, toBlock) => rpc.getContractEvents({ address: [...controllers, ...sentinels], abi: ABI.controller, eventName: "PolicyAllowed", args: { account: holders }, fromBlock, toBlock, strict: true })),
        sentinels.length ? scanLogs(`repays:${key}`, (fromBlock, toBlock) => rpc.getContractEvents({ address: sentinels, abi: ABI.sentinel, eventName: "AutoRepayExecuted", fromBlock, toBlock, strict: true })) : Promise.resolve(null),
      ]);
      const allowed = allowedScan.logs;
      const repays = repayScan?.logs ?? [];
      // The indexed snapshot (public testnet only). It joins this list only when the chain's block at its checkpoint
      // matches, and then only its LAST checked segment counts as read. On a conflict, or when the checkpoint cannot be
      // read, the merge is withheld: the snapshot's own card still shows its events as previously verified evidence.
      const shipped = WRITE_CHAIN_ID === 1952 && EXPANSION.snapshot.status === "ok" ? EXPANSION.snapshot.value : null;
      let snapshotEvents: Array<SnapshotPolicyAllowed | SnapshotAutoRepay> = [];
      let snapshot: ActivityFeed["snapshot"];
      if (shipped) {
        const tail = shipped.coverage.segments.at(-1)!;
        const info = {
          file: shipped.file,
          fromBlock: tail.from,
          toBlock: tail.to,
          updatedAt: shipped.updatedAt,
          added: 0,
          shared: 0,
          skipped: 0,
          unindexed: 0,
          earlier: earlierSegments(shipped.coverage).map((segment) => ({ from: segment.from, to: segment.to })),
          historyGaps: shipped.coverage.gaps.filter((gap) => gap.permanent).map((gap) => ({ from: gap.from, to: gap.to })),
          knownEmittersOnly: tail.sourceCoverage === "known-emitters",
        };
        try {
          const terminal = await retryRead(() => rpc.getBlock({ blockNumber: shipped.toBlock }));
          if (coverageCheckpoint(shipped.coverage, terminal.hash).checkpoint !== "matches") snapshot = { ...info, state: "not-canonical" };
          else {
            const found = snapshotActivity(shipped, { controllers, sentinels, holders });
            snapshotEvents = found.events;
            // A contract of this list that the snapshot does not index counts as covered only if it did not exist yet
            // at the snapshot's last block. If that cannot be shown, the snapshot's range is not counted as read.
            const missing = unindexedEmitters(shipped, [...controllers, ...sentinels]);
            let existed = 0;
            if (missing.length > 0) {
              try {
                const codes = await Promise.all(missing.map((address) => retryRead(() => rpc.getCode({ address: address as Address, blockNumber: shipped.toBlock }), { attempts: 2 })));
                existed = codes.filter((code) => code && code !== "0x").length;
              } catch {
                existed = missing.length;
              }
            }
            snapshot = { ...info, state: existed === 0 ? "merged" : "events-only", skipped: found.skipped, unindexed: existed };
          }
        } catch {
          snapshot = { ...info, state: "unverified" };
        }
      }
      const scanned = new Set([...allowed, ...repays].map((log) => activityKey(log.transactionHash, log.logIndex)));
      const onlyInSnapshot = snapshotEvents.filter((event) => !scanned.has(event.key));
      const inBoth = new Set(snapshotEvents.filter((event) => scanned.has(event.key)).map((event) => event.key));
      if (snapshot) snapshot = { ...snapshot, added: onlyInSnapshot.length, shared: inBoth.size };
      const sourceOf = (transactionHash: string, logIndex: number | bigint): ActivityEntry["source"] => (shipped ? (inBoth.has(activityKey(transactionHash, logIndex)) ? "both" : "scan") : undefined);
      const blockNumbers = [...new Set([...allowed, ...repays, ...onlyInSnapshot.filter((event) => event.timestamp === null)].map((log) => log.blockNumber))];
      const times = new Map(await Promise.all(blockNumbers.map(async (number) => [number, new Date(Number((await rpc.getBlock({ blockNumber: number })).timestamp) * 1000).toISOString()] as const)));
      const timeOf = (event: { blockNumber: bigint; timestamp: bigint | null }) => (event.timestamp !== null ? new Date(Number(event.timestamp) * 1000).toISOString() : (times.get(event.blockNumber) ?? ""));
      const marketOf = (emitter: Address, account: Address) =>
        markets.find((market) => market.controller.status === "ok" && market.controller.value.toLowerCase() === emitter.toLowerCase()) ??
        markets.find((market) => accounts.some((entry) => entry.marketId === market.id && entry.address.status === "ok" && [emitter.toLowerCase(), account.toLowerCase()].includes(entry.address.value.toLowerCase())));
      // Newest first by block and log position (block timestamps can tie).
      const position = new Map<string, bigint>([...allowed, ...repays, ...onlyInSnapshot].map((log) => [`${log.transactionHash}-${log.logIndex}`, log.blockNumber * 100_000n + BigInt(log.logIndex)]));
      // One builder per event kind, used for both sources, so a row reads the same wherever it was found.
      const allowedEntry = (log: { transactionHash: `0x${string}`; logIndex: number | bigint; blockNumber: bigint; address: Address }, args: { account: Address; op: number; postLtvBps: bigint | number; oracleFresh: boolean }, at: string, source: ActivityEntry["source"]): ActivityEntry => {
        const byController = controllers.some((controller) => controller.toLowerCase() === log.address.toLowerCase());
        const viaSentinel = sentinels.some((sentinel) => sentinel.toLowerCase() === args.account.toLowerCase());
        return {
          id: `${log.transactionHash}-${log.logIndex}`,
          at,
          actor: "owner",
          kind: "execution",
          title: `${OP_LABEL[args.op as OpId] ?? `Operation ${args.op}`} · allowed by ${byController ? "the market policy" : "your Sentinel policy"}`,
          marketId: marketOf(log.address, args.account)?.id ?? "",
          result: "allowed",
          evidence: "mined-success",
          detail: `PolicyAllowed from ${byController ? "the market controller" : "the Sentinel account"}${viaSentinel ? " for your Sentinel account" : " for your wallet"}: loan-to-value after ${formatBps(Number(args.postLtvBps))}, price feed ${args.oracleFresh ? "fresh" : "stale"}, block ${log.blockNumber}.`,
          txHash: ok(log.transactionHash),
          source,
        };
      };
      const repayEntry = (log: { transactionHash: `0x${string}`; logIndex: number | bigint; blockNumber: bigint; address: Address }, args: { amount: bigint; ltvBeforeBps: bigint | number; ltvAfterBps: bigint | number }, at: string, source: ActivityEntry["source"]): ActivityEntry => {
        const market = marketOf(log.address, log.address);
        return {
          id: `${log.transactionHash}-${log.logIndex}`,
          at,
          actor: "operator",
          kind: "execution",
          title: "Auto-repay",
          marketId: market?.id ?? "",
          amount: market ? { value: args.amount, token: market.debt.token } : undefined,
          result: "allowed",
          evidence: "mined-success",
          detail: `AutoRepayExecuted: loan-to-value ${formatBps(Number(args.ltvBeforeBps))} → ${formatBps(Number(args.ltvAfterBps))}, block ${log.blockNumber}.`,
          txHash: ok(log.transactionHash),
          source,
        };
      };
      const entries: ActivityEntry[] = [
        ...allowed.map((log) => allowedEntry(log, log.args, times.get(log.blockNumber) ?? "", sourceOf(log.transactionHash, log.logIndex))),
        ...repays.map((log) => repayEntry(log, log.args, times.get(log.blockNumber) ?? "", sourceOf(log.transactionHash, log.logIndex))),
        ...onlyInSnapshot.map((event) => (event.kind === "PolicyAllowed" ? allowedEntry(event, event, timeOf(event), "snapshot") : repayEntry(event, event, timeOf(event), "snapshot"))),
      ];
      entries.sort((a, b) => ((position.get(b.id) ?? 0n) > (position.get(a.id) ?? 0n) ? 1 : -1));
      // Coverage is the union of what was really read. The snapshot's range counts only in state "merged".
      // Segment by segment, never the snapshot's outer envelope: a history gap between two segments stays a gap.
      const counted = snapshot?.state === "merged";
      const merged = mergedCoverage(counted ? [...allowedScan.ranges, ...snapshot!.earlier] : allowedScan.ranges, counted ? { from: snapshot!.fromBlock, to: snapshot!.toBlock } : null, DEPLOYMENT_BLOCK(), allowedScan.toBlock);
      return { entries, coverage: { ranges: merged.ranges, complete: merged.complete }, scanRanges: allowedScan.ranges, gaps: merged.gaps, head: allowedScan.toBlock, snapshot };
    });
  },
};

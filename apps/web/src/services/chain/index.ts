"use client";
/**
 * Chain implementations (INTERFACES v1.2, generated ABIs). They never return fixture data: a failed or
 * impossible read is `unavailable` with a reason. Every read first requires the deployment check
 * (chain id, bytecode at manifest addresses, template root) to pass.
 */
import { type Maybe, ok, unavailable } from "../../lib/maybe.ts";
import { OP_LABEL, type OpId } from "../../lib/policy.ts";
import { formatBps } from "../../lib/amount.ts";
import { TEMPLATES } from "../fixture/data.ts";
import type { AccountService, ActivityEntry, ActivityFeed, ActivityService, Address, MarketService, PolicyService, SentinelAccount } from "../types.ts";
import { ABI, client, manifest, scanLogs, verifyDeployment } from "./client.ts";
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
    return ok(await read());
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
      const blockNumbers = [...new Set([...allowed, ...repays].map((log) => log.blockNumber))];
      const times = new Map(await Promise.all(blockNumbers.map(async (number) => [number, new Date(Number((await rpc.getBlock({ blockNumber: number })).timestamp) * 1000).toISOString()] as const)));
      const marketOf = (emitter: Address, account: Address) =>
        markets.find((market) => market.controller.status === "ok" && market.controller.value.toLowerCase() === emitter.toLowerCase()) ??
        markets.find((market) => accounts.some((entry) => entry.marketId === market.id && entry.address.status === "ok" && [emitter.toLowerCase(), account.toLowerCase()].includes(entry.address.value.toLowerCase())));
      // Newest first by block and log position (block timestamps can tie).
      const position = new Map<string, bigint>([...allowed, ...repays].map((log) => [`${log.transactionHash}-${log.logIndex}`, log.blockNumber * 100_000n + BigInt(log.logIndex)]));
      const entries: ActivityEntry[] = [
        ...allowed.map((log): ActivityEntry => {
          const byController = controllers.some((controller) => controller.toLowerCase() === log.address.toLowerCase());
          const viaSentinel = sentinels.some((sentinel) => sentinel.toLowerCase() === log.args.account.toLowerCase());
          return {
            id: `${log.transactionHash}-${log.logIndex}`,
            at: times.get(log.blockNumber) ?? "",
            actor: "owner",
            kind: "execution",
            title: `${OP_LABEL[log.args.op as OpId] ?? `Operation ${log.args.op}`} · allowed by ${byController ? "the market policy" : "your Sentinel policy"}`,
            marketId: marketOf(log.address, log.args.account)?.id ?? "",
            result: "allowed",
            evidence: "mined-success",
            detail: `PolicyAllowed from ${byController ? "the market controller" : "the Sentinel account"}${viaSentinel ? " for your Sentinel account" : " for your wallet"}: loan-to-value after ${formatBps(Number(log.args.postLtvBps))}, price feed ${log.args.oracleFresh ? "fresh" : "stale"}, block ${log.blockNumber}.`,
            txHash: ok(log.transactionHash),
          };
        }),
        ...repays.map((log): ActivityEntry => ({
          id: `${log.transactionHash}-${log.logIndex}`,
          at: times.get(log.blockNumber) ?? "",
          actor: "operator",
          kind: "execution",
          title: "Auto-repay",
          marketId: marketOf(log.address, log.address)?.id ?? "",
          amount: (() => {
            const market = marketOf(log.address, log.address);
            return market ? { value: log.args.amount, token: market.debt.token } : undefined;
          })(),
          result: "allowed",
          evidence: "mined-success",
          detail: `AutoRepayExecuted: loan-to-value ${formatBps(Number(log.args.ltvBeforeBps))} → ${formatBps(Number(log.args.ltvAfterBps))}, block ${log.blockNumber}.`,
          txHash: ok(log.transactionHash),
        })),
      ];
      entries.sort((a, b) => ((position.get(b.id) ?? 0n) > (position.get(a.id) ?? 0n) ? 1 : -1));
      return { entries, coverage: { fromBlock: allowedScan.fromBlock, toBlock: allowedScan.toBlock, complete: allowedScan.complete } };
    });
  },
};

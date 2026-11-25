import { type Maybe, ok, unavailable } from "../../lib/maybe.ts";
import type { AccountService, ActivityService, MarketService, PolicyService, WalletService, WalletState } from "../types.ts";
import { ACCOUNT_POLICY, ACTIVITY, DIRECT_POSITIONS, MARKETS, MARKET_POLICY_CONSERVATIVE, MARKET_POLICY_STANDARD, SENTINEL_ACCOUNTS, TEMPLATES } from "./data.ts";
import { simulateOperation } from "./preview.ts";

/** Small delay so loading states are exercised; fixture reads never touch the network. */
const settle = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), 60));

export const fixtureMarketService: MarketService = {
  source: "fixture",
  listMarkets: () => settle(ok(MARKETS)),
  getMarket: (id) => settle(ok(MARKETS.find((market) => market.id === id) ?? null)),
  getDirectPosition: (marketId) => {
    const position = DIRECT_POSITIONS.find((entry) => entry.marketId === marketId);
    return settle(position ? ok(position) : unavailable("No example position for this market"));
  },
  previewOperation: (request) => {
    const market = MARKETS.find((entry) => entry.id === request.marketId);
    if (!market) return Promise.reject(new Error(`Unknown fixture market ${request.marketId}`));
    const account = SENTINEL_ACCOUNTS.find((entry) => entry.marketId === request.marketId);
    const position = request.path === "sentinel" ? account?.position : DIRECT_POSITIONS.find((entry) => entry.marketId === request.marketId);
    if (!position) return Promise.reject(new Error("No example position to preview against"));
    return settle(simulateOperation(market, position, request.path === "sentinel" ? (account?.policy ?? null) : null, request));
  },
};

export const fixtureAccountService: AccountService = {
  source: "fixture",
  getAccount: (marketId) => settle(ok(SENTINEL_ACCOUNTS.find((account) => account.marketId === marketId) ?? null)),
  listAccounts: () => settle(ok(SENTINEL_ACCOUNTS)),
};

export const fixturePolicyService: PolicyService = {
  source: "fixture",
  listTemplates: () => settle(TEMPLATES),
  listRegistered: () => settle(ok([MARKET_POLICY_STANDARD, MARKET_POLICY_CONSERVATIVE, ACCOUNT_POLICY])),
};

export const fixtureActivityService: ActivityService = {
  source: "fixture",
  list: () => settle(ok(ACTIVITY)),
};

/**
 * In-memory wallet for tests and screenshots (NEXT_PUBLIC_WALLET_FIXTURE=connected|wrong-network).
 * It never talks to a provider and can never sign. The address is a non-routable placeholder.
 */
export function createFixtureWalletService(initial: "disconnected" | "connected" | "wrong-network", writeChainId: number): WalletService {
  const placeholder = "0x00000000000000000000000000000000000000E1" as const;
  const stateFor = (mode: typeof initial): WalletState =>
    mode === "disconnected" ? { status: "disconnected" } : { status: "connected", address: placeholder, chainId: mode === "connected" ? writeChainId : 1, connectorName: "Example wallet" };
  let state = stateFor(initial);
  const listeners = new Set<() => void>();
  const set = (next: WalletState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    source: "fixture",
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listConnectors: () => [{ id: "example", name: "Example wallet" }],
    connect: async () => set(stateFor("connected")),
    disconnect: async () => set({ status: "disconnected" }),
    switchToWriteChain: async () => set(stateFor("connected")),
  };
}

export type { Maybe };

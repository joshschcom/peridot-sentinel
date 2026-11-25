"use client";
import { useQuery } from "@tanstack/react-query";
import type { KeeperFeed } from "@/lib/keeper";
import { services } from "@/services";
import { hintOperator, readAutoRepays, verifyKeeperReceipts } from "@/services/chain/reads";

/** The app's own read-only route. Chain mode only: an example-data build never asks a keeper. */
export function useKeeper() {
  return useQuery({
    queryKey: ["keeper", "feed"],
    queryFn: async (): Promise<KeeperFeed> => {
      const response = await fetch("/api/keeper?limit=50", { cache: "no-store" });
      if (!response.ok) return { state: "unavailable", reason: `The app's keeper route answered HTTP ${response.status}.` };
      const feed = (await response.json()) as KeeperFeed;
      // The keeper's operator becomes a candidate when that account's grants are read. The chain read decides.
      if (feed.state === "ok") hintOperator(feed.scope.account, feed.scope.operator);
      return feed;
    },
    enabled: services.activity.source === "chain",
    refetchInterval: 15_000,
    retry: false,
  });
}

/** What the chain itself says about the keeper's account: receipts for the hashes it reported, and AutoRepayExecuted events. */
export function useKeeperChainFacts(feed: KeeperFeed | undefined) {
  const account = feed?.state === "ok" ? feed.scope.account : null;
  const hashes = feed?.state === "ok" ? [...new Set(feed.items.flatMap((item) => (item.hash ? [item.hash] : [])))] : [];
  return useQuery({
    queryKey: ["keeper", "chain", account, hashes.join(",")],
    queryFn: async () => {
      const [receipts, repays] = await Promise.all([verifyKeeperReceipts(account!, hashes), readAutoRepays(account!)]);
      return { receipts, repays };
    },
    enabled: account !== null,
    refetchInterval: 15_000,
    retry: false,
  });
}

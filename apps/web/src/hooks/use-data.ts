"use client";
import { useQuery } from "@tanstack/react-query";
import { services } from "@/services";
import type { OperationRequest } from "@/services/types";

import { useWallet } from "./use-wallet";

/**
 * Query keys start with the data source, so a fixture result can never be served from cache as chain data,
 * and include the connected address and chain, so nothing read for one wallet is shown to another.
 */
function useKey() {
  const wallet = useWallet();
  const who = wallet.status === "connected" ? `${wallet.address}:${wallet.chainId}` : "nobody";
  return (service: "market" | "account" | "policy" | "activity", ...rest: Array<string | number>) => [service, services[service].source, who, ...rest];
}

export const useMarkets = () => { const key = useKey(); return useQuery({ queryKey: key("market", "list"), queryFn: () => services.market.listMarkets() }); };
export const useMarket = (id: string) => { const key = useKey(); return useQuery({ queryKey: key("market", "one", id), queryFn: () => services.market.getMarket(id) }); };
export const useDirectPosition = (marketId: string) => { const key = useKey(); return useQuery({ queryKey: key("market", "direct-position", marketId), queryFn: () => services.market.getDirectPosition(marketId) }); };
export const useAccounts = () => { const key = useKey(); return useQuery({ queryKey: key("account", "list"), queryFn: () => services.account.listAccounts() }); };
export const useAccount = (marketId: string) => { const key = useKey(); return useQuery({ queryKey: key("account", "one", marketId), queryFn: () => services.account.getAccount(marketId) }); };
export const useTemplates = () => { const key = useKey(); return useQuery({ queryKey: key("policy", "templates"), queryFn: () => services.policy.listTemplates() }); };
export const useRegisteredPolicies = () => { const key = useKey(); return useQuery({ queryKey: key("policy", "registered"), queryFn: () => services.policy.listRegistered() }); };
export const useActivity = () => { const key = useKey(); return useQuery({ queryKey: key("activity", "list"), queryFn: () => services.activity.list() }); };

export function useOperationPreview(request: OperationRequest | null) {
  const key = useKey();
  return useQuery({
    // bigint is not JSON-serialisable: the amount goes into the key as a decimal string.
    queryKey: key("market", "preview", request?.marketId ?? "", request?.path ?? "", request?.op ?? -1, request?.leg ?? "", request?.amount.toString() ?? ""),
    queryFn: () => services.market.previewOperation(request!),
    enabled: request !== null,
    staleTime: 0,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

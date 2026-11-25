"use client";
import { useQuery } from "@tanstack/react-query";
import { services } from "@/services";
import type { OperationRequest } from "@/services/types";

/** Query keys start with the data source so a fixture result can never be served from cache as chain data. */
const key = (service: "market" | "account" | "policy" | "activity", ...rest: Array<string | number>) => [service, services[service].source, ...rest];

export const useMarkets = () => useQuery({ queryKey: key("market", "list"), queryFn: () => services.market.listMarkets() });
export const useMarket = (id: string) => useQuery({ queryKey: key("market", "one", id), queryFn: () => services.market.getMarket(id) });
export const useDirectPosition = (marketId: string) => useQuery({ queryKey: key("market", "direct-position", marketId), queryFn: () => services.market.getDirectPosition(marketId) });
export const useAccounts = () => useQuery({ queryKey: key("account", "list"), queryFn: () => services.account.listAccounts() });
export const useAccount = (marketId: string) => useQuery({ queryKey: key("account", "one", marketId), queryFn: () => services.account.getAccount(marketId) });
export const useTemplates = () => useQuery({ queryKey: key("policy", "templates"), queryFn: () => services.policy.listTemplates() });
export const useRegisteredPolicies = () => useQuery({ queryKey: key("policy", "registered"), queryFn: () => services.policy.listRegistered() });
export const useActivity = () => useQuery({ queryKey: key("activity", "list"), queryFn: () => services.activity.list() });

export function useOperationPreview(request: OperationRequest | null) {
  return useQuery({
    // bigint is not JSON-serialisable: the amount goes into the key as a decimal string.
    queryKey: key("market", "preview", request?.marketId ?? "", request?.path ?? "", request?.op ?? -1, request?.leg ?? "", request?.amount.toString() ?? ""),
    queryFn: () => services.market.previewOperation(request!),
    enabled: request !== null,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

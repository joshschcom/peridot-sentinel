"use client";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { WRITE_CHAIN, WRITE_CHAIN_ID } from "@/lib/chains";
import { RUNTIME, services } from "@/services";
import { verifyDeployment } from "@/services/chain/client";
import type { ServiceName, WalletState } from "@/services/types";

const DISCONNECTED: WalletState = { status: "disconnected" };

export function useWallet(): WalletState {
  return useSyncExternalStore(services.wallet.subscribe, services.wallet.getState, () => DISCONNECTED);
}

export type WriteGate =
  | { allowed: true }
  | { allowed: false; reason: "fixture" | "disconnected" | "connecting" | "wrong-network" | "unverified"; message: string };

/** Chain id, bytecode at every manifest address and the template root, checked against the RPC. */
export function useDeploymentCheck() {
  const enabled = !RUNTIME.fixture || Object.values(RUNTIME.modes).some((mode) => mode.source === "chain");
  return useQuery({ queryKey: ["deployment-check"], queryFn: verifyDeployment, enabled, staleTime: 60_000, retry: false });
}

/**
 * Single source of truth for "may this screen send a transaction?".
 * Order matters: fixture mode blocks writes regardless of the wallet, then connection, then network.
 * Only the target chain passes (testnet 1952 by default); mainnet 196 is always a wrong network for writes.
 */
export function useWriteGate(service: Exclude<ServiceName, "wallet">): WriteGate {
  const wallet = useWallet();
  const check = useDeploymentCheck();
  const mode = RUNTIME.modes[service];
  if (mode.source === "fixture") {
    return { allowed: false, reason: "fixture", message: "Writes are disabled: this screen shows example data, not a deployed contract." };
  }
  if (wallet.status === "connecting") return { allowed: false, reason: "connecting", message: "Connecting wallet…" };
  if (wallet.status !== "connected") return { allowed: false, reason: "disconnected", message: "Connect a wallet to continue." };
  if (wallet.chainId !== WRITE_CHAIN_ID) return { allowed: false, reason: "wrong-network", message: `Switch your wallet to ${WRITE_CHAIN.name} to continue.` };
  if (check.isPending) return { allowed: false, reason: "unverified", message: "Verifying the deployment…" };
  if (!check.data?.ok) return { allowed: false, reason: "unverified", message: `Writes are blocked: ${check.data && !check.data.ok ? check.data.reason : "the deployment could not be verified"}.` };
  return { allowed: true };
}

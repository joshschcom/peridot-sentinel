"use client";
import { useSyncExternalStore } from "react";
import { WRITE_CHAIN, WRITE_CHAIN_ID } from "@/lib/chains";
import { RUNTIME, services } from "@/services";
import type { ServiceName, WalletState } from "@/services/types";

const DISCONNECTED: WalletState = { status: "disconnected" };

export function useWallet(): WalletState {
  return useSyncExternalStore(services.wallet.subscribe, services.wallet.getState, () => DISCONNECTED);
}

export type WriteGate =
  | { allowed: true }
  | { allowed: false; reason: "fixture" | "disconnected" | "connecting" | "wrong-network"; message: string };

/**
 * Single source of truth for "may this screen send a transaction?".
 * Order matters: fixture mode blocks writes regardless of the wallet, then connection, then network.
 * Only the target chain passes (testnet 1952 by default); mainnet 196 is always a wrong network for writes.
 */
export function useWriteGate(service: Exclude<ServiceName, "wallet">): WriteGate {
  const wallet = useWallet();
  const mode = RUNTIME.modes[service];
  if (mode.source === "fixture") {
    return { allowed: false, reason: "fixture", message: "Writes are disabled: this screen shows example data, not a deployed contract." };
  }
  if (wallet.status === "connecting") return { allowed: false, reason: "connecting", message: "Connecting wallet…" };
  if (wallet.status !== "connected") return { allowed: false, reason: "disconnected", message: "Connect a wallet to continue." };
  if (wallet.chainId !== WRITE_CHAIN_ID) return { allowed: false, reason: "wrong-network", message: `Switch your wallet to ${WRITE_CHAIN.name} to continue.` };
  return { allowed: true };
}

"use client";
/**
 * Real wallet implementation on wagmi core actions (injected / EIP-6963: OKX Wallet, MetaMask, ...).
 * No WalletConnect: it needs a project id, and nothing secret or account-bound belongs in this frontend.
 */
import { connect, disconnect, getConnection, getConnectors, switchChain, watchConnection, watchConnectors } from "wagmi/actions";
import { WRITE_CHAIN } from "../../lib/chains.ts";
import type { WalletService, WalletState } from "../types.ts";
import { wagmiConfig } from "./wagmi.ts";

function read(): WalletState {
  const connection = getConnection(wagmiConfig);
  if (connection.status === "connected" && connection.address && connection.chainId !== undefined) {
    return { status: "connected", address: connection.address, chainId: connection.chainId, connectorName: connection.connector?.name ?? "Wallet" };
  }
  if (connection.status === "connecting" || connection.status === "reconnecting") return { status: "connecting" };
  return { status: "disconnected" };
}

let cached: WalletState = { status: "disconnected" };
let cachedKey = "disconnected";
function snapshot(): WalletState {
  const next = read();
  const key = next.status === "connected" ? `${next.address}:${next.chainId}:${next.connectorName}` : next.status;
  if (key !== cachedKey) {
    cached = next;
    cachedKey = key;
  }
  return cached;
}

export const chainWalletService: WalletService = {
  source: "chain",
  getState: snapshot,
  subscribe: (listener) => {
    const stopConnection = watchConnection(wagmiConfig, { onChange: listener });
    const stopConnectors = watchConnectors(wagmiConfig, { onChange: listener });
    return () => {
      stopConnection();
      stopConnectors();
    };
  },
  listConnectors: () => {
    const connectors = getConnectors(wagmiConfig);
    // Prefer announced EIP-6963 wallets; keep the generic injected connector only as a fallback.
    const announced = connectors.filter((connector) => connector.id !== "injected");
    return (announced.length > 0 ? announced : connectors).map((connector) => ({ id: connector.uid, name: connector.name, icon: connector.icon }));
  },
  connect: async (connectorId) => {
    const connector = getConnectors(wagmiConfig).find((entry) => entry.uid === connectorId);
    if (!connector) throw new Error("Wallet not found");
    await connect(wagmiConfig, { connector });
  },
  disconnect: async () => {
    await disconnect(wagmiConfig);
  },
  switchToWriteChain: async () => {
    await switchChain(wagmiConfig, { chainId: WRITE_CHAIN.id });
  },
};

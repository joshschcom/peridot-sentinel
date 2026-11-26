"use client";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { TARGET_KIND, localDevChain, xLayerMainnet, xLayerTestnet } from "../../lib/chains.ts";

/**
 * Testnet 1952 is the write chain. Mainnet 196 is configured for read-only RPC calls only:
 * the app never requests a switch to it and blocks writes while a wallet is on it.
 */
export const wagmiConfig = createConfig({
  chains: TARGET_KIND === "local" ? [localDevChain, xLayerTestnet, xLayerMainnet] : [xLayerTestnet, xLayerMainnet, localDevChain],
  connectors: [injected()],
  transports: {
    [xLayerTestnet.id]: http(xLayerTestnet.rpcUrls.default.http[0], { retryCount: 4, retryDelay: 300, timeout: 20_000 }),
    [xLayerMainnet.id]: http(),
    [localDevChain.id]: http(),
  },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

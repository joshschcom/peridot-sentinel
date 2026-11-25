/**
 * Service registry. Components reach data only through `services` (or the hooks in src/hooks),
 * never by importing fixture or chain modules directly. Swapping fixture -> chain is per service:
 * implement it in src/services/chain and flip its flag in runtime.ts.
 */
import { chainAccountService, chainActivityService, chainMarketService, chainPolicyService } from "./chain/index.ts";
import { chainWalletService } from "./chain/wallet.ts";
import { createFixtureWalletService, fixtureAccountService, fixtureActivityService, fixtureMarketService, fixturePolicyService } from "./fixture/index.ts";
import { RUNTIME } from "./runtime.ts";
import type { Services, WalletService } from "./types.ts";

const walletFixture = process.env.NEXT_PUBLIC_WALLET_FIXTURE;
const wallet: WalletService =
  walletFixture === "connected" || walletFixture === "wrong-network" || walletFixture === "disconnected"
    ? createFixtureWalletService(walletFixture, RUNTIME.writeChainId)
    : chainWalletService;

export const services: Services = {
  wallet,
  market: RUNTIME.modes.market.source === "chain" ? chainMarketService : fixtureMarketService,
  account: RUNTIME.modes.account.source === "chain" ? chainAccountService : fixtureAccountService,
  policy: RUNTIME.modes.policy.source === "chain" ? chainPolicyService : fixturePolicyService,
  activity: RUNTIME.modes.activity.source === "chain" ? chainActivityService : fixtureActivityService,
};

export { RUNTIME };

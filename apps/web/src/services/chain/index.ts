/**
 * Chain implementations: STUBS for M0.
 * They never return fixture data. Reads answer "unavailable" with a reason, so if a service is ever
 * switched to chain mode before its implementation lands the UI shows an honest empty state.
 *
 * Integration plan per service (INTERFACES v1; ABIs from @peridot/chain-config once exported):
 *   market   MarketFactory.marketCount/marketAt -> IsolatedController.owner/active/policyId/collateralMarket/debtMarket,
 *            previewPolicy(account, op, pToken, amount) + eth_call simulation as the actual sender.
 *   account  SentinelAccountFactory.accountOf(owner, controller), SentinelAccount.operators(address), position reads.
 *   policy   PolicyRegistry.getPolicy(bytes32), manifest.tapeout.circuits.
 *   activity receipts + AutoRepayExecuted/OperatorSet logs; reverted transactions have no events (receipt status only).
 * Before any write: verify eth_chainId == 1952 and that every manifest address has code.
 */
import { unavailable } from "../../lib/maybe.ts";
import type { AccountService, ActivityService, MarketService, PolicyService } from "../types.ts";

const NOT_IMPLEMENTED = "On-chain reads are not implemented in this build";

export const chainMarketService: MarketService = {
  source: "chain",
  listMarkets: async () => unavailable(NOT_IMPLEMENTED),
  getMarket: async () => unavailable(NOT_IMPLEMENTED),
  getDirectPosition: async () => unavailable(NOT_IMPLEMENTED),
  previewOperation: async () => {
    throw new Error(NOT_IMPLEMENTED);
  },
};

export const chainAccountService: AccountService = {
  source: "chain",
  getAccount: async () => unavailable(NOT_IMPLEMENTED),
  listAccounts: async () => unavailable(NOT_IMPLEMENTED),
};

export const chainPolicyService: PolicyService = {
  source: "chain",
  listTemplates: async () => [],
  listRegistered: async () => unavailable(NOT_IMPLEMENTED),
};

export const chainActivityService: ActivityService = {
  source: "chain",
  list: async () => unavailable(NOT_IMPLEMENTED),
};

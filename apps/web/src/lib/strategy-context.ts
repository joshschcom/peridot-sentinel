/**
 * What this build can do with testnet strategy templates. One object, in a module without "use client", so server
 * and client components derive the same labels from it (Discover, Strategies, Studio and the landing page).
 */
import { RAW_CONFIG } from "../generated/config.ts";
import { RUNTIME, FORCE_FIXTURE } from "../services/runtime.ts";
import { IS_PRIVATE_FORK, TARGET_KIND } from "./chains.ts";
import { EXPANSION } from "./expansion.ts";
import type { AvailabilityContext } from "./strategy.ts";
import { parseV2OwnerTarget } from "./v2-target.ts";

export const STRATEGY_CONTEXT: AvailabilityContext = {
  testnetLive: TARGET_KIND === "testnet" && !FORCE_FIXTURE && RUNTIME.modes.account.source === "chain",
  v1: TARGET_KIND === "testnet" && RUNTIME.manifest.state === "deployed" ? RUNTIME.manifest.manifest : null,
  // A private-fork build exists to accept wallet signing against testnet state without touching the public chain,
  // so the v2 write switch is treated as on there, and only there. On public testnet the manifest's flag decides.
  v2: EXPANSION.manifest.status === "ok" ? (IS_PRIVATE_FORK ? { ...EXPANSION.manifest.value, uiEnabled: true } : EXPANSION.manifest.value) : null,
};

/**
 * The Sentinel v2 deployment an owner can act on in this build (base account and vault sibling), parsed once here so
 * that server-rendered copy and the client-side owner flows read the same result. A private-fork test build treats
 * the base write switch as on; the vault follows its own manifest's switch everywhere.
 */
const chainKey = TARGET_KIND === "local" ? "31337" : "1952";
export const V2_OWNER_PARSED = FORCE_FIXTURE
  ? null
  : parseV2OwnerTarget(TARGET_KIND === "local" ? 31337 : 1952, RAW_CONFIG.expansion.byChain[chainKey], RAW_CONFIG.vault.byChain[chainKey], { base: `${RAW_CONFIG.expansion.dir}/${chainKey}.json`, vault: `${RAW_CONFIG.vault.dir}/vault-${chainKey}.json` }, IS_PRIVATE_FORK);
/** Does this build offer the owner's vault account (deposit, withdraw, redeem into the mock ERC-4626 vault)? */
export const VAULT_UI_ON: boolean = V2_OWNER_PARSED?.status === "ok" && V2_OWNER_PARSED.value.vault !== null && (TARGET_KIND === "local" || STRATEGY_CONTEXT.testnetLive);

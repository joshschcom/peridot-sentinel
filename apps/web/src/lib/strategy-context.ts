/**
 * What this build can do with testnet strategy templates. One object, in a module without "use client", so server
 * and client components derive the same labels from it (Discover, Strategies, Studio and the landing page).
 */
import { RAW_CONFIG } from "../generated/config.ts";
import { RUNTIME, FORCE_FIXTURE } from "../services/runtime.ts";
import { TARGET_KIND } from "./chains.ts";
import { EXPANSION } from "./expansion.ts";
import type { AvailabilityContext } from "./strategy.ts";
import { REGISTRY_SWITCHES, type RegistryPinFile, parseRegistryPin } from "./strategy-registry.ts";
import { parseV2OwnerTarget } from "./v2-target.ts";

export const STRATEGY_CONTEXT: AvailabilityContext = {
  testnetLive: TARGET_KIND === "testnet" && !FORCE_FIXTURE && RUNTIME.modes.account.source === "chain",
  v1: TARGET_KIND === "testnet" && RUNTIME.manifest.state === "deployed" ? RUNTIME.manifest.manifest : null,
  // The manifest's own `uiEnabled` flag decides, in every build. A private-fork test build (IS_PRIVATE_FORK) changes
  // the network label, the explorer links and the faucet link, and no switch.
  v2: EXPANSION.manifest.status === "ok" ? EXPANSION.manifest.value : null,
};

/**
 * The public strategy registry this build reads, or null: its switch is off, the build is not reading X Layer testnet,
 * or it carries no valid reviewed pin. Null means the registry is not mentioned anywhere in the app.
 */
const REGISTRY_PARSED = parseRegistryPin(RAW_CONFIG.registry.json);
export const REGISTRY_PIN: RegistryPinFile | null = REGISTRY_SWITCHES.discover && STRATEGY_CONTEXT.testnetLive && REGISTRY_PARSED.status === "ok" ? REGISTRY_PARSED.value : null;
/** Publishing from this app: its own switch, and only where the registry is read. */
export const REGISTRY_PUBLISH_ON: boolean = REGISTRY_PIN !== null && REGISTRY_SWITCHES.publish;

/**
 * The Sentinel v2 deployment an owner can act on in this build (base account and vault sibling), parsed once here so
 * that server-rendered copy and the client-side owner flows read the same result. Each part follows its own
 * manifest's switch in every build.
 */
const chainKey = TARGET_KIND === "local" ? "31337" : "1952";
export const V2_OWNER_PARSED = FORCE_FIXTURE
  ? null
  : parseV2OwnerTarget(TARGET_KIND === "local" ? 31337 : 1952, RAW_CONFIG.expansion.byChain[chainKey], RAW_CONFIG.vault.byChain[chainKey], { base: `${RAW_CONFIG.expansion.dir}/${chainKey}.json`, vault: `${RAW_CONFIG.vault.dir}/vault-${chainKey}.json` });
/** Does this build offer the owner's vault account (deposit, withdraw, redeem into the mock ERC-4626 vault)? */
export const VAULT_UI_ON: boolean = V2_OWNER_PARSED?.status === "ok" && V2_OWNER_PARSED.value.vault !== null && (TARGET_KIND === "local" || STRATEGY_CONTEXT.testnetLive);

/**
 * Future strategy categories. They have no template, no parameters and no action: nothing here can be adopted, and
 * every surface shows them apart from what is available (dashed outline, "Planned").
 */
export const PLANNED_STRATEGIES = [
  { name: "Vault strategies", body: `Strategies that move funds in and out of a vault for you. ${VAULT_UI_ON ? "Today you can use the testnet vault yourself on Trade; handing that job to a strategy is planned." : "The vault itself is not offered in this build."}` },
  { name: "Liquidity positions", body: "Strategies that open, manage and close a liquidity position. A prototype exists; nothing is deployed for it." },
  { name: "Peridot-hosted AI", body: "An AI operated by Peridot that runs a strategy for you. Not built. Today you can use rules, or connect your own AI." },
] as const;

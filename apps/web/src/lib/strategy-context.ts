/**
 * What this build can do with testnet strategy templates. One object, in a module without "use client", so server
 * and client components derive the same labels from it (Discover, Strategies, Studio and the landing page).
 */
import { RUNTIME, FORCE_FIXTURE } from "../services/runtime.ts";
import { IS_PRIVATE_FORK, TARGET_KIND } from "./chains.ts";
import { EXPANSION } from "./expansion.ts";
import type { AvailabilityContext } from "./strategy.ts";

export const STRATEGY_CONTEXT: AvailabilityContext = {
  testnetLive: TARGET_KIND === "testnet" && !FORCE_FIXTURE && RUNTIME.modes.account.source === "chain",
  v1: TARGET_KIND === "testnet" && RUNTIME.manifest.state === "deployed" ? RUNTIME.manifest.manifest : null,
  // A private-fork build exists to accept wallet signing against testnet state without touching the public chain,
  // so the v2 write switch is treated as on there, and only there. On public testnet the manifest's flag decides.
  v2: EXPANSION.manifest.status === "ok" ? (IS_PRIVATE_FORK ? { ...EXPANSION.manifest.value, uiEnabled: true } : EXPANSION.manifest.value) : null,
};

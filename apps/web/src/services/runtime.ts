/**
 * Resolves, once, which implementation each service uses and whether writes are possible.
 * The fixture banner, the write lock and the service registry all derive from this one object.
 *
 * A service runs against the chain only if BOTH hold:
 *   1. packages/chain-config/deployments/1952.json exists, validates and says "deployed";
 *   2. that service's chain implementation is marked ready in this build.
 */
import { RAW_MANIFESTS } from "../generated/manifests.ts";
import { WRITE_CHAIN_ID } from "../lib/chains.ts";
import { type ManifestState, resolveManifest } from "../lib/manifest.ts";
import type { DataSource, ServiceName } from "./types.ts";

/** Flip a flag only when the chain implementation is real and verified against the generated ABIs. */
export const CHAIN_IMPL_READY: Record<Exclude<ServiceName, "wallet">, boolean> = {
  market: false,
  account: false,
  policy: false,
  activity: false,
};

export interface ServiceMode {
  source: DataSource;
  reason: string;
}

export interface Runtime {
  writeChainId: number;
  manifest: ManifestState;
  modes: Record<Exclude<ServiceName, "wallet">, ServiceMode>;
  /** True when any data service shows example data. Drives the persistent banner. */
  fixture: boolean;
  fixtureReason: string;
}

export function resolveRuntime(raw: typeof RAW_MANIFESTS, ready = CHAIN_IMPL_READY): Runtime {
  const manifest = resolveManifest(WRITE_CHAIN_ID, raw[String(WRITE_CHAIN_ID)]);
  const names = Object.keys(ready) as Array<keyof typeof ready>;
  const modes = Object.fromEntries(
    names.map((name): [string, ServiceMode] => {
      if (manifest.state !== "deployed") return [name, { source: "fixture", reason: manifest.reason }];
      if (!ready[name]) return [name, { source: "fixture", reason: `Contracts are deployed, but the ${name} integration is not enabled in this build.` }];
      return [name, { source: "chain", reason: `Deployed manifest at commit ${manifest.manifest.commit}` }];
    }),
  ) as Runtime["modes"];
  const firstFixture = names.map((name) => modes[name]).find((mode) => mode.source === "fixture");
  return {
    writeChainId: WRITE_CHAIN_ID,
    manifest,
    modes,
    fixture: firstFixture !== undefined,
    fixtureReason: firstFixture?.reason ?? "",
  };
}

export const RUNTIME: Runtime = resolveRuntime(RAW_MANIFESTS);

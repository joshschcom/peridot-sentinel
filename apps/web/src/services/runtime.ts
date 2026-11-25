/**
 * Resolves, once, which implementation each service uses and whether writes are possible.
 * The fixture banner, the write lock and the service registry all derive from this one object.
 *
 * A service runs against the chain only if ALL hold:
 *   1. packages/chain-config/deployments/<target chain>.json exists, validates and says "deployed";
 *   2. that manifest passes the static live-readiness checks (required contracts, template root == this build's
 *      compiler, deploymentBlock, processor);
 *   3. that service's chain implementation is marked ready FOR THIS TARGET in this build.
 * Even then every read and write waits for the in-browser RPC checks (src/services/chain/client.ts).
 */
import { RAW_MANIFESTS } from "../generated/manifests.ts";
import { TARGET_KIND, type TargetKind, WRITE_CHAIN_ID } from "../lib/chains.ts";
import { type LiveReadiness, type ManifestState, liveReadiness, resolveManifest } from "../lib/manifest.ts";
import { STUDIO_MARKET_ROOT } from "../lib/policy.ts";
import type { DataSource, ServiceName } from "./types.ts";

type DataService = Exclude<ServiceName, "wallet">;

/**
 * Readiness is decided per target, not globally: a service reads the chain on a target only if its implementation
 * has been exercised there. Flip a flag only when the chain implementation is real and verified against the
 * generated ABIs; market and account must be flipped together because accounts reference chain market ids.
 *
 *   local    all four are implemented (src/services/chain) and exercised by scripts/e2e-local.mjs.
 *   testnet  the same code, enabled deliberately: the 1952 manifest still has to pass the static checks below and
 *            the in-browser RPC checks. This path has only run against negative cases so far (see FABLE_NOTES).
 */
export const CHAIN_IMPL_READY: Record<TargetKind, Record<DataService, boolean>> = {
  local: { market: true, account: true, policy: true, activity: true },
  testnet: { market: true, account: true, policy: true, activity: true },
};

/** Operator override: `NEXT_PUBLIC_PERIDOT_DATA=fixture` keeps a build on example data whatever the manifest says. */
export const FORCE_FIXTURE = process.env.NEXT_PUBLIC_PERIDOT_DATA === "fixture";

export interface ServiceMode {
  source: DataSource;
  reason: string;
}

export interface Runtime {
  writeChainId: number;
  manifest: ManifestState;
  /** Static manifest checks for live use. `null` when there is no deployed manifest to check. */
  live: LiveReadiness | null;
  modes: Record<DataService, ServiceMode>;
  /** True when any data service shows example data. Drives the persistent banner. */
  fixture: boolean;
  fixtureReason: string;
}

export interface RuntimeOptions {
  chainId?: number;
  sdkTemplateRoot?: string;
  forceFixture?: boolean;
}

export function resolveRuntime(raw: typeof RAW_MANIFESTS, ready: Record<DataService, boolean> = CHAIN_IMPL_READY[TARGET_KIND], options: RuntimeOptions = {}): Runtime {
  const chainId = options.chainId ?? WRITE_CHAIN_ID;
  const manifest = resolveManifest(chainId, raw[String(chainId)]);
  const live = manifest.state === "deployed" ? liveReadiness(manifest.manifest, options.sdkTemplateRoot ?? STUDIO_MARKET_ROOT) : null;
  const forced = options.forceFixture ?? FORCE_FIXTURE;
  const names = Object.keys(ready) as DataService[];
  const modes = Object.fromEntries(
    names.map((name): [string, ServiceMode] => {
      if (manifest.state !== "deployed") return [name, { source: "fixture", reason: manifest.reason }];
      if (forced) return [name, { source: "fixture", reason: "This build is pinned to example data (NEXT_PUBLIC_PERIDOT_DATA=fixture)." }];
      if (live && !live.ok) return [name, { source: "fixture", reason: `The manifest for chain ${chainId} says "deployed" but was rejected for live use: ${live.reason}.` }];
      if (!ready[name]) return [name, { source: "fixture", reason: `Contracts are deployed, but the ${name} integration is not enabled in this build.` }];
      return [name, { source: "chain", reason: `Deployed manifest at commit ${manifest.manifest.commit}` }];
    }),
  ) as Runtime["modes"];
  const firstFixture = names.map((name) => modes[name]).find((mode) => mode.source === "fixture");
  return {
    writeChainId: chainId,
    manifest,
    live,
    modes,
    fixture: firstFixture !== undefined,
    fixtureReason: firstFixture?.reason ?? "",
  };
}

export const RUNTIME: Runtime = resolveRuntime(RAW_MANIFESTS);

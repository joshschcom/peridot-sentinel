/**
 * Deployment manifest (INTERFACES v1, "Deployments"). Astra generates
 * packages/chain-config/deployments/<chainId>.json; this file only reads and validates.
 * Dependency-free on purpose so it can run in node tests.
 */

export type ManifestProfile = "local" | "testnet" | "read-only";
export type ManifestDeployStatus = "deployed" | "not-deployed";

export interface DeploymentManifest {
  schemaVersion: 1;
  chainId: number;
  abiVersion: string;
  profile: ManifestProfile;
  status: ManifestDeployStatus;
  commit: string | null;
  contracts: Record<string, `0x${string}`>;
  /** Shape of market entries is read leniently until the first deployed manifest pins it. */
  markets: ReadonlyArray<Record<string, unknown>>;
  tapeout: { mode: TapeoutMode; processor: `0x${string}` | null; circuits: ReadonlyArray<ManifestCircuit> };
  /** Opt-in capability fields (INTERFACES v1.2). Absent on older deployments. */
  capabilities: { studioMarketTemplateRoot: `0x${string}` | null; policyAllowedEvents: boolean };
  deploymentBlock: string | null;
  /** Local builds from a dirty tree carry provenance instead of a commit. */
  provenance: { baseCommit: string; sourceDigest: string; sourcesDirty: boolean } | null;
  mocks: ReadonlyArray<unknown>;
}

export type TapeoutMode = "unavailable" | "development-reference" | "official" | "self-deployed-reference";
export interface ManifestCircuit {
  kind: "MARKET" | "ACCOUNT";
  circuitId: string;
  policyId: `0x${string}`;
  netlistHash: `0x${string}`;
  configHash: `0x${string}`;
}

export type ManifestState =
  | { state: "absent"; chainId: number; reason: string }
  | { state: "invalid"; chainId: number; reason: string }
  | { state: "not-deployed"; chainId: number; reason: string; manifest: DeploymentManifest }
  | { state: "deployed"; chainId: number; manifest: DeploymentManifest };

export type RawEntry = { ok: true; json: unknown } | { ok: false; error: string } | undefined;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const TAPEOUT_MODES = ["unavailable", "development-reference", "official", "self-deployed-reference"];
const SUPPORTED_ABI_VERSIONS = ["v1"];
const EXPECTED_PROFILE: Record<number, ManifestProfile> = { 31337: "local", 1952: "testnet", 196: "read-only" };

export function resolveManifest(chainId: number, raw: RawEntry): ManifestState {
  if (raw === undefined) {
    return { state: "absent", chainId, reason: `No deployment manifest for chain ${chainId}.` };
  }
  if (!raw.ok) return { state: "invalid", chainId, reason: raw.error };
  const invalid = (reason: string): ManifestState => ({ state: "invalid", chainId, reason: `Manifest for chain ${chainId} rejected: ${reason}` });

  const m = raw.json;
  if (!isRecord(m)) return invalid("not an object");
  if (m.schemaVersion !== 1) return invalid(`unsupported schemaVersion ${String(m.schemaVersion)}`);
  if (m.chainId !== chainId) return invalid(`chainId ${String(m.chainId)} does not match ${chainId}`);
  if (typeof m.abiVersion !== "string" || !SUPPORTED_ABI_VERSIONS.includes(m.abiVersion)) {
    return invalid(`abiVersion ${String(m.abiVersion)} is not supported by this build (${SUPPORTED_ABI_VERSIONS.join(", ")})`);
  }
  if (m.profile !== "local" && m.profile !== "testnet" && m.profile !== "read-only") return invalid(`unknown profile ${String(m.profile)}`);
  const expectedProfile = EXPECTED_PROFILE[chainId];
  if (expectedProfile && m.profile !== expectedProfile) {
    return invalid(`profile "${m.profile}" is not allowed on chain ${chainId} (expected "${expectedProfile}")`);
  }
  if (m.status !== "deployed" && m.status !== "not-deployed") return invalid(`unknown status ${String(m.status)}`);
  if (m.commit !== null && typeof m.commit !== "string") return invalid("commit must be a string or null");
  if (!isRecord(m.contracts)) return invalid("contracts must be an object");
  for (const [name, address] of Object.entries(m.contracts)) {
    if (typeof address !== "string" || !ADDRESS.test(address)) return invalid(`contracts.${name} is not an address`);
  }
  if (!Array.isArray(m.markets) || !m.markets.every(isRecord)) return invalid("markets must be an array of objects");
  if (!isRecord(m.tapeout) || typeof m.tapeout.mode !== "string" || !TAPEOUT_MODES.includes(m.tapeout.mode)) return invalid("tapeout.mode missing or unknown");
  const processor = m.tapeout.processor;
  if (processor !== null && (typeof processor !== "string" || !ADDRESS.test(processor))) return invalid("tapeout.processor is not an address or null");
  if (!Array.isArray(m.tapeout.circuits) || !m.tapeout.circuits.every(isCircuit)) return invalid("tapeout.circuits has an unexpected shape");
  const provenance = isRecord(m.provenance) && typeof m.provenance.baseCommit === "string" && typeof m.provenance.sourceDigest === "string"
    ? { baseCommit: m.provenance.baseCommit, sourceDigest: m.provenance.sourceDigest, sourcesDirty: m.provenance.sourcesDirty === true }
    : null;
  if (!Array.isArray(m.mocks)) return invalid("mocks must be an array");

  const manifest: DeploymentManifest = {
    schemaVersion: 1,
    chainId,
    abiVersion: m.abiVersion,
    profile: m.profile,
    status: m.status,
    commit: m.commit,
    contracts: m.contracts as Record<string, `0x${string}`>,
    markets: m.markets as ReadonlyArray<Record<string, unknown>>,
    tapeout: { mode: m.tapeout.mode as TapeoutMode, processor: processor as `0x${string}` | null, circuits: m.tapeout.circuits as ManifestCircuit[] },
    mocks: m.mocks,
    capabilities: {
      studioMarketTemplateRoot: isRecord(m.capabilities) && typeof m.capabilities.studioMarketTemplateRoot === "string" && BYTES32.test(m.capabilities.studioMarketTemplateRoot) ? (m.capabilities.studioMarketTemplateRoot as `0x${string}`) : null,
      policyAllowedEvents: isRecord(m.capabilities) && m.capabilities.policyAllowedEvents === true,
    },
    deploymentBlock: typeof m.deploymentBlock === "string" || typeof m.deploymentBlock === "number" ? String(m.deploymentBlock) : null,
    provenance,
  };

  if (manifest.status === "not-deployed") {
    return { state: "not-deployed", chainId, manifest, reason: `Manifest for chain ${chainId} says "not-deployed": no contracts exist yet.` };
  }
  if (manifest.profile === "read-only") return invalid("a read-only profile cannot be marked deployed for writes");
  if (Object.keys(manifest.contracts).length === 0) return invalid('status is "deployed" but contracts is empty');
  // A null commit is tolerated only for the local profile, and only with recorded build provenance.
  // The chain layer must still verify chain id and bytecode over RPC before using it.
  if (manifest.commit === null && !(manifest.profile === "local" && provenance)) return invalid('status is "deployed" but commit is null');
  return { state: "deployed", chainId, manifest };
}

/** Contracts the app addresses by name. Tokens, books and the oracle are read from each controller. */
export const REQUIRED_CONTRACTS = ["MarketFactory", "PolicyRegistry", "TapeOutPolicyAdapter", "SentinelAccountFactory"] as const;

export type LiveReadiness = { ok: true } | { ok: false; reason: string };

/**
 * Static checks a `deployed` manifest must pass before any service may read the chain with it. They need no RPC,
 * so a manifest that fails them keeps the whole build in labelled fixture mode. The RPC checks (chain id, bytecode at
 * every address, on-chain template root) run on top of this in the browser before any read or write.
 */
export function liveReadiness(manifest: DeploymentManifest, sdkTemplateRoot: string): LiveReadiness {
  const no = (reason: string): LiveReadiness => ({ ok: false, reason });
  if (manifest.status !== "deployed") return no("the manifest is not marked deployed");
  const missing = REQUIRED_CONTRACTS.filter((name) => !manifest.contracts[name]);
  if (missing.length) return no(`required contract address missing: ${missing.join(", ")}`);
  const zero = Object.entries(manifest.contracts).find(([, address]) => /^0x0{40}$/.test(address));
  if (zero) return no(`contracts.${zero[0]} is the zero address`);
  const root = manifest.capabilities.studioMarketTemplateRoot;
  if (!root) return no("capabilities.studioMarketTemplateRoot is not published");
  if (root.toLowerCase() !== sdkTemplateRoot.toLowerCase()) return no("the manifest's Studio template root differs from this build's policy compiler");
  if (manifest.deploymentBlock === null || !/^\d+$/.test(manifest.deploymentBlock)) return no("deploymentBlock is missing, so log queries would have no lower bound");
  if (manifest.tapeout.mode === "unavailable" || manifest.tapeout.processor === null) return no("no policy processor is published");
  return { ok: true };
}

function isCircuit(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === "MARKET" || value.kind === "ACCOUNT") &&
    typeof value.circuitId === "string" &&
    /^\d+$/.test(value.circuitId) &&
    [value.policyId, value.netlistHash, value.configHash].every((hash) => typeof hash === "string" && BYTES32.test(hash))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

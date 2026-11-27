/**
 * The Sentinel v2 deployment a connected OWNER can act on in this build, if any: the base account factory (typed
 * adapters: lending, one swap route) and its ERC-4626 vault sibling.
 *
 *   local target    packages/chain-config/expansion/deployments/31337.json + vault-31337.json: an unforked Anvil with
 *                   fixed simulated prices, a mock venue and a mock vault. Writes are offered only after the browser
 *                   has matched the node's instance id, genesis hash and every recorded code hash.
 *   testnet target  1952.json + vault-1952.json. Each carries the contracts team's `uiEnabled` switch. While it is
 *                   false the app offers no write for that part, and the vault is not shown at all.
 *
 * Every wallet resolves its OWN accounts through the factories (`accountOf(owner)`); no account address is taken
 * from a manifest. Nothing here is a mainnet deployment and no venue here is a real exchange.
 */
import { type Maybe, ok, unavailable } from "./maybe.ts";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
type Hex = `0x${string}`;
const address = (value: unknown): Hex | null => (typeof value === "string" && ADDRESS.test(value) ? (value as Hex) : null);
const hash = (value: unknown): Hex | null => (typeof value === "string" && HASH.test(value) ? (value as Hex) : null);

export interface V2Token {
  address: Hex;
  symbol: string;
  decimals: number;
}
export interface V2Code {
  name: string;
  address: Hex;
  hash: Hex;
}
export interface V2VaultTarget {
  file: string;
  label: string;
  writes: boolean;
  factory: Hex;
  adapter: Hex;
  vault: Hex;
  asset: V2Token;
  shareDecimals: number;
  /** ACCOUNT policy the factory attaches at creation. */
  accountPolicy: Hex;
  codes: V2Code[];
}
export interface V2OwnerTarget {
  file: string;
  chainId: 1952 | 31337;
  label: string;
  /** May this build send v2 owner transactions on this target? */
  writes: boolean;
  writesReason: string | null;
  /** Local only: the exact Anvil instance the manifest was written for. */
  anvil: { instanceId: Hex; genesisHash: Hex } | null;
  contracts: { factory: Hex; swap: Hex; lending: Hex; execution: Hex };
  codes: V2Code[];
  tokens: { wokb: V2Token; usdc: V2Token };
  swap: { policyMaxLossBps: number; hardMaxLossBps: number };
  /** ACCOUNT policy id passed to createAccount. Null: account creation is not offered. */
  accountPolicy: Hex | null;
  /** The lending market the lending adapter is bound to, when the manifest states it. */
  lendingMarket: { label: string; controller: Hex; collateralAsset: Hex; debtAsset: Hex; collateralMarket: Hex } | null;
  vault: V2VaultTarget | null;
}

const BASE_CODES = ["mockWokb", "mockUsdc", "mockOracle", "cpu", "execution", "source", "venue", "swap", "lending", "factory"] as const;

function codes(root: Rec, names: readonly string[]): V2Code[] | null {
  const contracts = rec(root.contracts);
  const hashes = rec(root.runtimeCodeHashes);
  const found: V2Code[] = [];
  for (const name of names) {
    const at = address(contracts?.[name]);
    const code = hash(hashes?.[name]);
    if (!at || !code) return null;
    found.push({ name, address: at, hash: code });
  }
  return found;
}

function parseVault(json: unknown, file: string, chainId: number, base: { usdc: Hex; swap: Hex; lending: Hex; execution: Hex }, anvilInstance: string | null): V2VaultTarget | null {
  const root = rec(json);
  if (!root || root.chainId !== chainId || root.schemaVersion !== 1 || typeof root.label !== "string" || !/mock/i.test(root.label)) return null;
  // The vault is hidden unless the contracts team switched it on for this target.
  if (root.uiEnabled !== true) return null;
  const list = codes(root, ["mockVault", "vaultAdapter", "vaultFactory"]);
  const asset = address(root.asset) ?? address(rec(root.baseContracts)?.mockUsdc);
  const policy = hash(root.sourcePolicy);
  const bases = rec(root.baseContracts);
  if (!list || !asset || !policy || typeof root.assetDecimals !== "number" || typeof root.shareDecimals !== "number") return null;
  // The sibling must be built on THIS base deployment, and (locally) for the same node instance.
  const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  if (!same(asset, base.usdc) || !same(bases?.swap, base.swap) || !same(bases?.lending, base.lending) || !same(bases?.execution, base.execution)) return null;
  if (anvilInstance !== null && !same(rec(root.anvil)?.instanceId, anvilInstance)) return null;
  const at = (name: string) => list.find((entry) => entry.name === name)!.address;
  return { file, label: root.label, writes: true, factory: at("vaultFactory"), adapter: at("vaultAdapter"), vault: at("mockVault"), asset: { address: asset, symbol: "mUSDC", decimals: root.assetDecimals }, shareDecimals: root.shareDecimals, accountPolicy: policy, codes: list };
}

/** The write switch is the manifest's own `uiEnabled`, in every build: nothing in the app can force it on. */
export function parseV2OwnerTarget(chainId: 1952 | 31337, json: unknown, vaultJson: unknown, files: { base: string; vault: string }): Maybe<V2OwnerTarget> {
  const root = rec(json);
  if (!root) return unavailable(`No Sentinel v2 deployment manifest for chain ${chainId} in this build`);
  if (root.chainId !== chainId || root.schemaVersion !== 2) return unavailable(`The Sentinel v2 manifest is not a schema-2 manifest for chain ${chainId}`);
  if (typeof root.label !== "string" || !/mock/i.test(root.label)) return unavailable("The Sentinel v2 manifest does not label its swap venue as a mock");
  if (rec(root.execution)?.mode !== "development-reference") return unavailable("The Sentinel v2 manifest does not declare the development reference processor");
  const local = chainId === 31337;
  if (local && (root.profile !== "local" || root.public !== false)) return unavailable("The local Sentinel v2 manifest is not marked as a private local profile");
  const list = codes(root, local ? [...BASE_CODES, "acceptanceFactory", "acceptancePrices"] : BASE_CODES);
  if (!list) return unavailable("The Sentinel v2 manifest is missing an address or a recorded code hash");
  const swap = rec(root.swap);
  if (!swap || typeof swap.policyMaxLossBps !== "number" || typeof swap.hardMaxLossBps !== "number" || typeof swap.mockWokbDecimals !== "number" || typeof swap.mockUsdcDecimals !== "number") return unavailable("The Sentinel v2 manifest has no swap configuration");
  const anvil = rec(root.anvil);
  const instanceId = hash(anvil?.instanceId);
  const genesisHash = hash(anvil?.genesisHash);
  if (local && (!instanceId || !genesisHash)) return unavailable("The local Sentinel v2 manifest does not identify its Anvil instance");
  const at = (name: string) => list.find((entry) => entry.name === name)!.address;
  const market = rec(root.lendingMarket);
  const lendingMarket = market && address(market.controller) && address(market.collateralAsset) && address(market.debtAsset) && address(market.collateralMarket) ? { label: typeof market.label === "string" ? market.label : "Lending market of the v2 lending adapter", controller: address(market.controller)!, collateralAsset: address(market.collateralAsset)!, debtAsset: address(market.debtAsset)!, collateralMarket: address(market.collateralMarket)! } : null;
  if (local && !lendingMarket) return unavailable("The local Sentinel v2 manifest does not state its lending market");
  const enabled = root.uiEnabled === true;
  return ok({
    file: files.base,
    chainId,
    label: root.label,
    writes: enabled,
    writesReason: enabled ? null : "Sentinel v2 writes are switched off for this app on testnet (the deployment's uiEnabled flag is false). Nothing can be signed here.",
    anvil: local ? { instanceId: instanceId!, genesisHash: genesisHash! } : null,
    contracts: { factory: at("factory"), swap: at("swap"), lending: at("lending"), execution: at("execution") },
    codes: list,
    tokens: { wokb: { address: at("mockWokb"), symbol: "mWOKB", decimals: swap.mockWokbDecimals }, usdc: { address: at("mockUsdc"), symbol: "mUSDC", decimals: swap.mockUsdcDecimals } },
    swap: { policyMaxLossBps: swap.policyMaxLossBps, hardMaxLossBps: swap.hardMaxLossBps },
    accountPolicy: hash(rec(root.m4)?.accountPolicy),
    lendingMarket,
    vault: parseVault(vaultJson, files.vault, chainId, { usdc: at("mockUsdc"), swap: at("swap"), lending: at("lending"), execution: at("execution") }, local ? instanceId : null),
  });
}

"use client";
/**
 * Owner flows on a Sentinel v2 deployment (base account and ERC-4626 vault sibling) for the build's target chain.
 * Reads are pinned to one block. Every write goes through the same driver as v1 (simulate as the wallet, send, wait
 * for the receipt) with the contracts team's JSON ABIs. A write is offered only when the target's switch is on AND
 * `verifyOwnerTarget` has matched the deployment in the browser.
 */
import { type Abi, type Hex, erc20Abi, keccak256, zeroAddress } from "viem";
import { getPublicClient } from "wagmi/actions";
import baseFactoryAbi from "../../../../../packages/chain-config/expansion/abi/SentinelAccountFactoryV2.json" with { type: "json" };
import baseAccountAbi from "../../../../../packages/chain-config/expansion/abi/SentinelAccountV2.json" with { type: "json" };
import vaultAdapterAbi from "../../../../../packages/chain-config/expansion/abi/SingleVaultAdapter.json" with { type: "json" };
import vaultFactoryAbi from "../../../../../packages/chain-config/expansion/abi/VaultSentinelAccountFactoryV2.json" with { type: "json" };
import vaultAccountAbi from "../../../../../packages/chain-config/expansion/abi/VaultSentinelAccountV2.json" with { type: "json" };
import { RAW_CONFIG } from "../../generated/config.ts";
import { IS_PRIVATE_FORK, TARGET_KIND, WRITE_CHAIN } from "../../lib/chains.ts";
import { V2_OP } from "../../lib/expansion.ts";
import { retryRead } from "../../lib/retry.ts";
import { type V2OwnerTarget, type V2Token, type V2VaultTarget, parseV2OwnerTarget } from "../../lib/v2-target.ts";
import { FORCE_FIXTURE } from "../runtime.ts";
import type { Address } from "../types.ts";
import { ABI, withErrors } from "./client.ts";
import type { TxPlanStep } from "./tx.ts";
import { wagmiConfig } from "./wagmi.ts";

const BASE_FACTORY = baseFactoryAbi as Abi;
const BASE_ACCOUNT = baseAccountAbi as Abi;
const VAULT_FACTORY = vaultFactoryAbi as Abi;
const VAULT_ACCOUNT = vaultAccountAbi as Abi;
const VAULT_ADAPTER = vaultAdapterAbi as Abi;

const chainKey = TARGET_KIND === "local" ? "31337" : "1952";
const parsed = FORCE_FIXTURE
  ? null
  : parseV2OwnerTarget(TARGET_KIND === "local" ? 31337 : 1952, RAW_CONFIG.expansion.byChain[chainKey], RAW_CONFIG.vault.byChain[chainKey], { base: `${RAW_CONFIG.expansion.dir}/${chainKey}.json`, vault: `${RAW_CONFIG.vault.dir}/vault-${chainKey}.json` }, IS_PRIVATE_FORK);
/** Null: this build has no usable v2 manifest for its target chain. */
export const V2_OWNER_TARGET: V2OwnerTarget | null = parsed?.status === "ok" ? parsed.value : null;
export const V2_OWNER_TARGET_REASON: string | null = parsed?.status === "unavailable" ? parsed.reason : null;

function rpc() {
  const found = getPublicClient(wagmiConfig, { chainId: WRITE_CHAIN.id });
  if (!found) throw new Error("No RPC client for the target chain");
  return found;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface Pin {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}
async function pinned<T>(read: (at: { blockNumber: bigint }, block: Pin) => Promise<T>): Promise<T & { block: Pin }> {
  const client = rpc();
  const head = await retryRead(() => client.getBlock({ blockTag: "latest" }));
  const block: Pin = { number: head.number, hash: head.hash, timestamp: head.timestamp };
  const value = await read({ blockNumber: head.number }, block);
  const again = await retryRead(() => client.getBlock({ blockNumber: head.number }));
  if (again.hash !== head.hash) throw new Error("The pinned block changed while it was being read. Read again.");
  return { ...value, block };
}

/**
 * Is the manifest really this chain? Chain id, (locally) the Anvil instance id and genesis hash, the runtime code
 * hash at every recorded address, and the factories' own adapter and policy bindings. Any problem blocks all writes.
 */
export async function verifyOwnerTarget(target: V2OwnerTarget): Promise<{ ok: boolean; problems: string[]; contracts: number; block: Pin }> {
  return pinned(async (at) => {
    const client = rpc();
    const problems: string[] = [];
    const chainId = await retryRead(() => client.getChainId());
    if (chainId !== target.chainId) return { ok: false, problems: [`The RPC reports chain ${chainId}, expected ${target.chainId}`], contracts: 0 };
    if (target.anvil) {
      const genesis = await retryRead(() => client.getBlock({ blockNumber: 0n }));
      if (!same(genesis.hash, target.anvil.genesisHash)) problems.push("The node's genesis block is not the one this manifest was written for");
      try {
        const metadata = (await client.request({ method: "anvil_metadata" } as never)) as { instanceId?: string } | null;
        if (!metadata?.instanceId || !same(metadata.instanceId, target.anvil.instanceId)) problems.push("The node is not the Anvil instance this manifest was written for");
      } catch {
        problems.push("The node did not identify itself as the expected Anvil instance");
      }
    }
    const all = [...target.codes, ...(target.vault?.codes ?? [])];
    const found = await Promise.all(all.map((entry) => retryRead(() => client.getCode({ address: entry.address, ...at }))));
    all.forEach((entry, index) => {
      const code = found[index];
      if (!code || code === "0x") problems.push(`No contract code at the manifest's "${entry.name}" address`);
      else if (!same(keccak256(code), entry.hash)) problems.push(`The code at the manifest's "${entry.name}" address is not the recorded code`);
    });
    if (problems.length === 0) {
      const view = (address: Address, abi: Abi, functionName: string) => retryRead(() => client.readContract({ address, abi, functionName, ...at })) as Promise<string>;
      const [swap, lending, execution] = await Promise.all([view(target.contracts.factory, BASE_FACTORY, "swapAdapter"), view(target.contracts.factory, BASE_FACTORY, "lendingAdapter"), view(target.contracts.factory, BASE_FACTORY, "executionPolicy")]);
      if (!same(swap, target.contracts.swap) || !same(lending, target.contracts.lending) || !same(execution, target.contracts.execution)) problems.push("The v2 factory's adapters or execution policy differ from the manifest");
      if (target.vault && !same(await view(target.vault.factory, VAULT_FACTORY, "vaultAdapter"), target.vault.adapter)) problems.push("The vault factory's adapter differs from the manifest");
    }
    return { ok: problems.length === 0, problems, contracts: all.length };
  });
}

export interface OwnerGrant {
  operator: Address;
  inputAsset: V2Token;
  maxPerCall: bigint;
  remaining: bigint;
  expiry: bigint;
  expired: boolean;
}
export interface OwnerBaseAccount {
  account: Address;
  idleWokb: bigint;
  idleUsdc: bigint;
  /** Collateral asset of the lending market, idle in the account. Null when the manifest names no lending market. */
  idleCollateral: bigint | null;
  collateralShares: bigint;
  debtRaw: bigint;
  /** Complete by construction: the account enumerates its operators. */
  operators: Address[];
  swapGrants: OwnerGrant[];
  block: Pin;
}
export interface OwnerVaultAccount {
  account: Address;
  idleAsset: bigint;
  shares: bigint;
  claimAssets: bigint;
  liquidShares: bigint;
  liquidAssets: bigint;
  maxPositionAssets: bigint;
  minSharesPerAssetWad: bigint;
  operators: number;
}
export interface OwnerV2 {
  base: OwnerBaseAccount | null;
  vault: OwnerVaultAccount | null;
  /** Symbol and decimals of the lending collateral asset, read from the token. */
  collateral: V2Token | null;
  block: Pin;
}

const MAX_OPERATORS = 25n;
/** The connected wallet's own accounts, through the factories' mappings, at one block. */
export async function readOwnerV2(target: V2OwnerTarget, owner: Address): Promise<OwnerV2> {
  return pinned(async (at, block) => {
    const client = rpc();
    const read = <T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) => retryRead(() => client.readContract({ address, abi, functionName, args, ...at })) as Promise<T>;
    const balance = (token: Address, holder: Address) => read<bigint>(token, erc20Abi as Abi, "balanceOf", [holder]);
    const [baseAddress, vaultAddress] = await Promise.all([read<Address>(target.contracts.factory, BASE_FACTORY, "accountOf", [owner]), target.vault ? read<Address>(target.vault.factory, VAULT_FACTORY, "accountOf", [owner]) : Promise.resolve(zeroAddress as Address)]);
    let collateral: V2Token | null = null;
    if (target.lendingMarket) {
      const [symbol, decimals] = await Promise.all([read<string>(target.lendingMarket.collateralAsset, erc20Abi as Abi, "symbol"), read<number>(target.lendingMarket.collateralAsset, erc20Abi as Abi, "decimals")]);
      collateral = { address: target.lendingMarket.collateralAsset, symbol, decimals };
    }
    let base: OwnerBaseAccount | null = null;
    if (baseAddress !== zeroAddress) {
      const [accountOwner, wokb, usdc, exposure, count, idleCollateral] = await Promise.all([
        read<Address>(baseAddress, BASE_ACCOUNT, "owner"),
        balance(target.tokens.wokb.address, baseAddress),
        balance(target.tokens.usdc.address, baseAddress),
        read<readonly [bigint, bigint]>(baseAddress, BASE_ACCOUNT, "exposure"),
        read<bigint>(baseAddress, BASE_ACCOUNT, "operatorCount"),
        collateral ? balance(collateral.address, baseAddress) : Promise.resolve(null),
      ]);
      if (!same(accountOwner, owner)) throw new Error("The factory maps this wallet to an account it does not own");
      if (count > MAX_OPERATORS) throw new Error(`The account lists ${count} operators, more than this page reads`);
      const operators = await Promise.all(Array.from({ length: Number(count) }, (_, index) => read<Address>(baseAddress, BASE_ACCOUNT, "operatorAt", [BigInt(index)])));
      const swapGrants: OwnerGrant[] = [];
      for (const operator of operators) {
        for (const inputAsset of [target.tokens.wokb, target.tokens.usdc]) {
          const [maxPerCall, remaining, expiry] = await read<readonly [bigint, bigint, bigint]>(baseAddress, BASE_ACCOUNT, "grants", [operator, target.contracts.swap, V2_OP.SWAP, inputAsset.address]);
          if (maxPerCall !== 0n || remaining !== 0n || expiry !== 0n) swapGrants.push({ operator, inputAsset, maxPerCall, remaining, expiry: BigInt(expiry), expired: BigInt(expiry) <= block.timestamp });
        }
      }
      base = { account: baseAddress, idleWokb: wokb, idleUsdc: usdc, idleCollateral, collateralShares: exposure[0], debtRaw: exposure[1], operators, swapGrants, block };
    }
    let vault: OwnerVaultAccount | null = null;
    if (target.vault && vaultAddress !== zeroAddress) {
      const [accountOwner, idleAsset, position, maxPositionAssets, minSharesPerAssetWad, operators] = await Promise.all([
        read<Address>(vaultAddress, VAULT_ACCOUNT, "owner"),
        balance(target.vault.asset.address, vaultAddress),
        read<readonly [bigint, bigint, bigint, bigint]>(vaultAddress, VAULT_ACCOUNT, "vaultPosition"),
        read<bigint>(vaultAddress, VAULT_ACCOUNT, "maxVaultPositionAssets"),
        read<bigint>(vaultAddress, VAULT_ACCOUNT, "minVaultSharesPerAssetWad"),
        read<bigint>(vaultAddress, VAULT_ACCOUNT, "operatorCount"),
      ]);
      if (!same(accountOwner, owner)) throw new Error("The vault factory maps this wallet to an account it does not own");
      vault = { account: vaultAddress, idleAsset, shares: position[0], claimAssets: position[1], liquidShares: position[2], liquidAssets: position[3], maxPositionAssets, minSharesPerAssetWad, operators: Number(operators) };
    }
    return { base, vault, collateral };
  });
}

export type VaultAction = "deposit" | "withdraw" | "redeem";
/**
 * The vault adapter's own quote for an action, at one block, and the bound derived from it with a tolerance:
 *   deposit   assets in  -> minimum shares out    (quote reduced by the tolerance)
 *   withdraw  assets out -> maximum shares burned (quote increased by the tolerance, rounded up)
 *   redeem    shares in  -> minimum assets out    (quote reduced by the tolerance)
 * The bound shown to the user is the bound that is signed.
 */
export async function quoteVault(vault: V2VaultTarget, account: Address, action: VaultAction, amount: bigint, toleranceBps: number): Promise<{ quote: bigint; bound: bigint; block: Pin }> {
  return pinned(async (at) => {
    const functionName = action === "deposit" ? "quoteDeposit" : action === "withdraw" ? "quoteWithdraw" : "quoteRedeem";
    const quote = (await retryRead(() => rpc().readContract({ address: vault.adapter, abi: VAULT_ADAPTER, functionName, args: [account, amount], ...at }))) as bigint;
    const tolerance = BigInt(toleranceBps);
    const bound = action === "withdraw" ? (quote * (10_000n + tolerance) + 9_999n) / 10_000n : (quote * (10_000n - tolerance)) / 10_000n;
    return { quote, bound };
  });
}

/* ---------- plans: the exact calls ---------- */

const DEADLINE_SECONDS = 1200n;
const deadline = async () => (await rpc().getBlock({ blockTag: "latest" })).timestamp + DEADLINE_SECONDS;
const step = (title: string, build: TxPlanStep["build"]): TxPlanStep => ({ title, build });

export const createBaseAccountPlan = (target: V2OwnerTarget): TxPlanStep[] => [
  step("Create your Sentinel v2 account", async () => {
    if (!target.accountPolicy) throw new Error("The deployment names no account policy to attach");
    return { address: target.contracts.factory, abi: BASE_FACTORY, functionName: "createAccount", args: [target.accountPolicy] };
  }),
];
export const createVaultAccountPlan = (vault: V2VaultTarget): TxPlanStep[] => [step("Create your vault account", async () => ({ address: vault.factory, abi: VAULT_FACTORY, functionName: "createAccount", args: [vault.accountPolicy] }))];
/** The test tokens of these profiles are permissionlessly mintable. Minted straight to the smart account. */
export const mintToAccountPlan = (token: V2Token, account: Address, amount: bigint): TxPlanStep[] => [step(`Mint test ${token.symbol} to the account`, async () => ({ address: token.address, abi: withErrors(ABI.token), functionName: "mint", args: [account, amount] }))];
export const supplyCollateralPlan = (account: Address, symbol: string, amount: bigint): TxPlanStep[] => [step(`Supply ${symbol} as collateral through the lending adapter`, async () => ({ address: account, abi: BASE_ACCOUNT, functionName: "supply", args: [amount] }))];
/** A swap-only grant: operation 5 on the pinned adapter, one input asset, per-call and cumulative limits, an expiry from chain time. */
export const setSwapGrantPlan = (target: V2OwnerTarget, account: Address, operator: Address, input: V2Token, perCall: bigint, cumulative: bigint, lifetimeSeconds: number): TxPlanStep[] => [
  step("Authorise the operator for the swap route", async () => {
    const block = await rpc().getBlock({ blockTag: "latest" });
    return { address: account, abi: BASE_ACCOUNT, functionName: "setGrant", args: [operator, target.contracts.swap, V2_OP.SWAP, input.address, perCall, cumulative, block.timestamp + BigInt(lifetimeSeconds)] };
  }),
];
export const revokeAllPlan = (account: Address): TxPlanStep[] => [step("Revoke all operators", async () => ({ address: account, abi: BASE_ACCOUNT, functionName: "revokeAllOperators", args: [] }))];
export const setVaultLimitsPlan = (account: Address, maxPositionAssets: bigint, minSharesPerAssetWad: bigint): TxPlanStep[] => [step("Set the vault deposit limits", async () => ({ address: account, abi: VAULT_ACCOUNT, functionName: "setVaultDepositLimits", args: [maxPositionAssets, minSharesPerAssetWad] }))];
export const vaultActionPlan = (account: Address, action: VaultAction, amount: bigint, bound: bigint): TxPlanStep[] => [
  step(action === "deposit" ? "Deposit into the vault" : action === "withdraw" ? "Withdraw from the vault" : "Redeem vault shares", async () => ({
    address: account,
    abi: VAULT_ACCOUNT,
    functionName: action === "deposit" ? "depositToVault" : action === "withdraw" ? "withdrawFromVault" : "redeemFromVault",
    args: [amount, bound, await deadline()],
  })),
];

# Sentinel savings account profile

The optional vault-enabled v2 factory creates a separate account with the same lending and swap methods. It binds one six-decimal vault/underlying pair. Existing Sentinel accounts retain their own positions and grants. The frontend should keep the feature disabled until its chain-specific manifest and vault journeys have been verified by December 2.

## Fork of X Layer mainnet

The pinned public block was **76,931,173** on chain 196. The rehearsal used private Anvil chain 31337. The real Spark spUSDC proxy is `0xf90E63079D97a0A1f479b2b168457F420CAFf6ba` and its underlying is native Circle USDC `0xB6CEceAB302E2E4948951eE7843FC24E92933061`. Both have six decimals. Spark reported implementation `0xdCe929A335C75a1676EF5957A4D7a3b928C48820`. Its ERC-1967 implementation slot matched. Regular vault actions check the pinned addresses, runtime hashes, reported implementation and decimals. Governance could upgrade a proxy to an implementation that lies about its own identity. A production release still requires an independent implementation monitor. [Pinned venue research](../session5-venues/README.md) · [Spark source](https://github.com/sparkdotfi/spark-vaults-v2/blob/0a686ba/src/SparkVault.sol)

USDC came from wrapping local fork OKB and swapping through the actual Uniswap router and pool. The same owner moved 60 USDC from the initial swap account to the separately created vault-enabled account. The operator could spend 50 USDC per deposit, and 55 USDC cumulatively. The owner capped the position at 60 USDC and required at least 0.98 shares per USDC. [Full fork receipts, events, code hashes and balances](spark-fork.json)

| Local fork action | Result | Transaction hash |
|---|---|---|
| Operator requested at least 51 shares for 50 USDC | Mined revert, decoded `VaultBounds()`. Balances and grant preserved | `0x984af745060f45bc1f6de2d8793b58d7900c6dd3ec80e9e3ebeb6e6bf12df05f` |
| Operator deposited 50 USDC | Account received 49.674782 spUSDC. Remaining grant was 5 USDC. Gas 183,181 | `0xd87f7cfc7e1f3f54a6f5d4334915c79af7a45d57baa93b439493f9ad49702a7e` |
| Owner withdrew exactly 5 USDC | Account burned 4.967479 shares and received 5 USDC | `0x9bad2dc4c316b42e2855aae56d4b7c5d5af4a7adbdc99af53ddd40d675410a89` |
| Owner disabled deposits, revoked all operators, then redeemed remaining shares | Account burned 44.707303 shares and received 44.999999 USDC. Account ended with 59.999999 USDC, zero shares, zero underlying allowance and zero remaining grant | `0x19105fc850be034fc80319e89e88ddc0b3f29eed760d31d5360236a15b30be26` |

The Spark deposit and withdrawal events name the account as sender and owner. Both withdrawals name the account as receiver. The operator received zero USDC. Every hash in this table is private fork evidence.

## Operations

The factory constructor accepts the Peridot lending adapter, the fixed swap adapter, the execution policy, and the new `SingleVaultAdapter`, in that order. `createAccount(bytes32 lendingPolicyId)` emits `AccountCreated(owner,account,policyId)`. The immutable SingleVaultAdapter has eleven read-only methods. All spending occurs through the account itself.

| Method | Effect |
|---|---|
| `setVaultDepositLimits(maxPositionAssets,minSharesPerAssetWad)` | Owner only. Raw six-decimal asset cap and absolute minimum share/asset rate scaled by 1e18. Zero cap disables deposits. The account verifies pre-trade allocation and the actual post-deposit claim. |
| `depositToVault(assets,minShares,deadline)` | Op 6 charges raw underlying. Account previews, approves exact assets to the vault, receives shares, resets allowance and checks both balance changes. |
| `redeemFromVault(shares,minAssets,deadline)` | Op 7 charges raw shares. Account checks `maxRedeem`, preview and caller minimum. Proceeds go to the account. |
| `withdrawFromVault(assets,maxShares,deadline)` | Op 8 charges the exact rounded-up preview in raw shares. Account checks `maxWithdraw`, maximum share cost and final deltas. Proceeds go to the account. |
| `vaultPosition()` | Returns shares, accounting claim in raw underlying, liquid shares and liquid assets from the vault. An accounting claim can exceed immediate withdrawal capacity. |
| `exitVaultShares(shares)` | Owner can transfer shares in kind to the owner during a liquidity, price, policy or identity-check outage if the upstream share token still permits transfers. |

The account uses the common per-operator, adapter, operation and input-asset grants with per-call limit, remaining cumulative limit and timestamp expiry. Emergency revocation invalidates all three vault grants in constant time. Deposits default to disabled. Minima supplied by the operator cannot waive the owner's absolute exchange-rate floor or allocation cap. A successful withdrawal has no circuit or deposit-limit dependency. The existing swap and lending TapeOut policies retain their original meanings. This optional savings profile uses explicit owner limits for allocation.

## Reproduce

Run from the repository root. Each fork is private to this rehearsal. The first terminal hosts the isolated mainnet fork. The second command sequence sets up the live venue bindings on that fork, obtains real fork USDC and exercises the Spark path.

```sh
anvil --host 127.0.0.1 --port 19635 --chain-id 31337 --fork-url https://rpc.xlayer.tech --fork-block-number 76931173 --no-storage-caching --silent
```

```sh
forge build --root contracts --offline
forge test --root contracts/expansion --offline --match-path 'test/vault/*' -vv
mkdir -p .research
node contracts/expansion/script/swap/fork.mjs > .research/session6-spark-fork-bootstrap.json
node contracts/expansion/script/vault/fork.mjs
```

Five targeted Solidity tests passed with zero failures and zero skips. They cover transfer amounts and rounding, zero approvals, grant depletion and global revocation on every vault operation, expiry, min-out, liquidity bounds, owner-only share exit, an implementation change, incorrect decimals and missing settlement. At the pinned compiler settings the vault-enabled account and factory runtime sizes were 20,584 and 24,396 bytes respectively. The factory has 180 bytes of EIP-170 headroom. Check deployed size before changing the base account.

## Mock savings vault on the testnet profile

The mock holds actual minted test tokens and computes shares from inventory using virtual asset/share offsets. It has no yield strategy. The optional mock profile uses the core expansion's separately deployed mUSDC, lending adapter, swap adapter and execution policy. The demo creates a separate vault-enabled account, mints 12 mUSDC to it, deposits 10, withdraws 2 and redeems 4 shares. The expected ending position is 4 mock shares and 8 idle mUSDC. The mock fixture and Spark mainnet vault have separate identities and provenance.

The deployment harness checks the historical M4 receipt, the core manifest code hashes and the vault artifacts. Public preflight independently builds the specified Git source checkpoint with solc 0.8.26 and compares ABI, creation bytecode and runtime template for all four new contracts. Each send uses the session's nonce and hash journal. Each mined leg verifies the actual VaultSettled event, underlying vault event and resulting allowance at its own height. The final manifest records the four deployment addresses and runtime hashes with the historical settlement block. Later market activity can change live balances.

```sh
anvil --host 127.0.0.1 --port 19637 --chain-id 1952 --fork-url https://testrpc.xlayer.tech --fork-block-number 47249126 --no-storage-caching --silent
```

```sh
node contracts/expansion/script/vault/deploy.mjs fork --preflight-only
node contracts/expansion/script/vault/deploy.mjs fork
node contracts/expansion/script/vault/deploy.mjs fork
```

This 1952-fork rehearsal used the verified public base manifest. Its nine successful local transactions and position evidence are in the [fork manifest](../../deployments/session6/fork-e3770a1c28d01bf4/vault/manifest.json) and [fork journal](../../deployments/session6/fork-e3770a1c28d01bf4/vault/deployer.json). Re-running on the same instance reuses the recorded hashes. For public deployment use `testnet --source-commit=<reviewed-SHA> --preflight-only`, then the same invocation without the preflight flag in Astra's authorized deployer environment. The public manifest path is `packages/chain-config/expansion/deployments/vault-1952.json`.

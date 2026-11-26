# Local v2 and vault wallet acceptance

The shared node is unforked Anvil, chain **31337**, at `http://127.0.0.1:18545`. Claude operates it. The original M4 oracle is stale at the shared node’s pending block. The expansion therefore supplies into a separate **local acceptance market** with its own fixed-price fixture and its own books. This market reuses the deployed M4 registry, policy adapter, ACCOUNT and MARKET policies, rate model, pToken implementation and mCOL/mUSD tokens. The original M4 book and its oracle keep their prior configuration. The base v2 factory and the optional vault factory each allow one account per owner. The two accounts have separate asset balances, positions and grants. Each owner uses their own connected wallet to create and operate them. All tokens and prices in this profile are simulated.

| Browser input | Source |
| --- | --- |
| Base v2 factory, local acceptance market (`lendingMarket`), swap route, EXECUTION policy, mock swap assets, Anvil identity and code hashes | [31337 expansion manifest](../../packages/chain-config/expansion/deployments/31337.json) |
| Vault factory, adapter, mock vault, underlying asset, Anvil identity and code hashes | [31337 vault manifest](../../packages/chain-config/expansion/deployments/vault-31337.json) |
| Original M4 book, shared lending tokens and registered policies | [M4 local manifest](../../packages/chain-config/deployments/31337.json) |
| Both factory, account, adapter and vault ABIs | [Expansion ABI directory](../../packages/chain-config/expansion/abi) |

## Connect and create

1. Select the local app target and connect an unlocked test wallet from **Anvil #3–#9**. The rehearsal uses #1 as owner and #2 as operator. Browser wallets have their own native gas balance.
2. Match chain 31337, the RPC, the instance identifier from `anvil_metadata`, the genesis hash and contract code hashes in the manifests. Refuse a mismatched deployment before offering wallet writes. `node contracts/expansion/script/local8/check.mjs` performs the local deployment checks.
3. Read `accountOf(connectedAddress)` on the desired factory. If it returns zero, the connected wallet sends `createAccount(base.m4.accountPolicy)` directly to `base.contracts.factory` or `vault.contracts.vaultFactory`. The policy is the registered ACCOUNT ID for the existing M4 market. Require a successful receipt and read back the factory’s mapping, the child’s `owner()` and its adapter and policy bindings. If the mapping already contains an account, reuse it. The child embeds the connected wallet as its immutable owner, so account runtime hashes differ across wallets.
4. For every write, simulate from the actual signer, estimate gas and use the estimate plus one third (rounded up) plus 30,000 gas. Wait for the canonical receipt and refresh at its block. Use raw bigint amounts for approvals, grants and amounts. The wallet signing an operator transaction is a different unlocked address from the owner.

Fable’s build at the start of Session 8 collects numeric expansion filenames through `sync-manifests.mjs`. A local target must also include `vault-31337.json` explicitly, select chain 31337 rather than a fixed 1952 key, and look up each connected owner through its factory. Rebuild the generated frontend config after selecting both manifests. These operations are enabled only for the matching local target. Fable owns the screens and browser acceptance.

## Actual test-wallet transactions

The three underlying fixtures support permissionless `mint(address,uint256)`. Send each mint from the connected browser wallet directly to the intended smart account. The quoted examples below use a fresh deployment. The scripts read the corresponding position and quote again at the receipt block.

| Action | Wallet and exact inputs | Result to verify |
| --- | --- | --- |
| Fund vault sibling | Owner calls `base.contracts.mockUsdc.mint(vaultAccount, 12000000)`. | 12 mUSDC idle in the sibling. Both mUSDC and msUSDC vault shares have six decimals. |
| Enable deposits | Owner calls `vaultAccount.setVaultDepositLimits(20000000, 1000000000000000000)`. | Cap 20 mUSDC and floor 1 share per asset. The initial deposit cap is zero. |
| Deposit | Read `vaultAdapter.quoteDeposit(vaultAccount, 10000000)`, then owner calls `depositToVault(10000000, minShares, deadline)`. | 10 msUSDC in the fresh 1:1 fixture. Confirm the share balance, idle asset delta and cleared allowance from the account to the vault. |
| Withdraw | Read `quoteWithdraw(vaultAccount, 2000000)`, then owner calls `withdrawFromVault(2000000, maxShares, deadline)`. | 2 mUSDC returns to the sibling. The bound is a maximum share burn. |
| Redeem | Read `quoteRedeem(vaultAccount, 4000000)`, then owner calls `redeemFromVault(4000000, minAssets, deadline)`. | 4 msUSDC burned. In the rehearsed fixture 4 shares and 8 idle mUSDC remain. `vaultPosition()` reports shares, claimable assets, liquid shares and liquid assets. |
| Supply M4 collateral | Owner calls `M4.contracts.MockCollateral.mint(baseAccount, 1000000000000000000)`, then `baseAccount.supply(1000000000000000000)`. | The base account owns its collateral pTokens on the separate acceptance book, identified by `base.lendingMarket.collateralMarket`. Check `exposure()`, the book’s `balanceOf(baseAccount)`, and zero underlying allowance to the book. |
| Fund swap account | Owner calls `base.contracts.mockWokb.mint(baseAccount, 1000000000000000000)`. | 1 mWOKB idle in the base account. |
| Approve operator | Owner calls `setGrant(operator, base.contracts.swap, 5, base.contracts.mockWokb, 1000000000000000000, 2000000000000000000, expiry)`. | `operatorCount()`, `operatorAt(0)` and `grants(...)` match one operator with a 1 mWOKB per-call and 2 mWOKB cumulative limit. |
| Exercise swap | From the operator wallet, call `baseAccount.swapExactIn(mockWokb, 250000000000000000, minOut, deadline)`. | The 0.25 mWOKB input has a gross 20 mUSDC quote under the fixed 80/1 fixture. A 19.8 mUSDC minimum satisfies the inclusive 100 bps circuit. The inventory-backed mock venue transfers 19.99 mUSDC to the base account, leaving 1.75 mWOKB of grant. Check the account→adapter and adapter→venue allowances both return to zero. |
| Stop the operator | Switch to the owner and call `baseAccount.revokeAllOperators()`. Simulate the same swap from the operator at the stop block. | `AllOperatorsRevoked`, zero operators and a zeroed grant. The simulation returns `OperatorNotAuthorized()`. |

Use Unix seconds from the latest block for the grant expiry and each operation deadline. Choose a new deadline if the wallet prompt has expired. Derive withdrawal, redemption and deposit bounds from the vault adapter immediately before signing. The mock vault has no yield engine. A donation can change its asset/share ratio. The fixed swap quote uses the venue’s constructor prices and the local block time as a simulated timestamp. The separate acceptance book also uses labelled fixed mock prices for the M4 token pair. The base expansion’s `m4.controller` records the original M4 market, whereas `lendingMarket.controller` and the lending adapter’s `controller()` identify the market used by v2.

## Scripted rehearsal

From the repository root:

```sh
node contracts/expansion/script/local8/check.mjs
node contracts/expansion/script/local8/rehearse.mjs
```

The rehearsal uses only local unlocked #1 and #2. It stores each intent, sender, nonce, calldata hash, block hash, receipt and observed position or balance in its [local evidence](../../evidence/session8-local/rehearsal.json). Repeating the script verifies the same canonical transactions and historical results. A browser session should use #3–#9 and resolve both account addresses from the connected wallet.

On the shared instance `0xb5c6d66bb5f479feeedb14b148e63b526d74c86b029e3c71727ffd7509961552`, the rehearsal mined 13 successful transactions in blocks **136–148**. The same command then verified all 13 with zero additional sends. Wallet #1 created base account `0x94B9874aC5605713CcAc00ca8E832B37e15c1399` and vault sibling `0x55C9DCD6128e7d7e7e136d78e533C01F0cB2ef77`. At block 148, every factory mapping for #3–#9 remained zero. Wallet #2’s swap used 263,808 gas. After wallet #1 revoked all operators, replaying the same swap as an unsigned call at block 148 returned `OperatorNotAuthorized()`. Browser acceptance is a separate Fable run.

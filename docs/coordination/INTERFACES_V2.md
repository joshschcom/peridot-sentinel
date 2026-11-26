# Peridot Sentinel expansion interface v2 (M6 design freeze)

The M4 manifest and v1.2 interfaces still describe the deployed lending suite. This additive profile uses distinct account, factory, adapter and execution-policy addresses. A v1 account's shares, debt, approvals and grants belong to that account. Creating a v2 account creates an empty account. Present profile, chain, processor provenance and deployment status separately.

## Typed execution and authority

A factory pins the Peridot adapter, v1 lending policy system, swap adapter and dedicated execution evaluator. The immutable Peridot adapter identifies an existing market controller, collateral book and debt book. The account calls the books itself. Read shares from the relevant book and debt from its borrower ledger. A swap exchanges idle tokens. Report their balances separately from book positions. Vault shares and LP NFT ownership, if supported later, require their own venue readers. There is no aggregate cross-protocol health score.

The v2 account exposes supply, enterCollateral, redeem, borrow, repay, swapExactIn and owner withdrawal. A grant identifies operator, adapter, operation and input asset, with a per-call limit, cumulative remaining amount and expiry. Grants can be revoked immediately. Amounts are unsigned raw units of the input asset, including shares for redemption. Account ownership fixes the withdrawal recipient. Routes, recipients, approvals and calls are fixed by typed code. A swap takes (address tokenIn,uint256 amountIn,uint256 minOut,uint64 deadline), chooses the other member of the pinned pair and delivers output only to the calling account. Account and adapter reset exact approvals after settlement and check actual deltas. Lending borrow and debt-backed redeem retain independent market and account policy checks. Repay and debt-free exits must remain available during processor failure.

## Execution circuit

Keep the v1 MARKET and ACCOUNT netlists. Add one separate fixed EXECUTION binding for exact-input swaps. The binding pins processor, code hash, circuit ID, dimensions and the specific compiler-output hash at construction. The execution schema has no entry in the v1 registry. The account calls enforceSwap(uint8 checks,uint16 slippageBps) before settlement. Checks bits 0 through 3 represent verified pair/target, authorized budget, fresh price and available input respectively. Owner execution satisfies the authorization predicate through ownership. The adapter reads fixed asset prices and returns executionQuote(address,uint256) → (expectedOut,floorOut,timestamp). The account computes the oracle-relative loss allowed by minOut as ceil(max(expectedOut−minOut,0) × 10000 / expectedOut). Oracle expiry, deadline, exact input, inventory, minOut and a hard loss floor of at most 500 bps also have Solidity checks.

| Input bits (little endian) | Meaning |
|---|---|
| 0–3 | Action 5, swap exact input |
| 4–7 | Pair, budget, freshness and input availability, in order |
| 8–17 | Permitted loss from independent oracle quote, in bps |
| 18–19 | Reserved, both zero |

The 20-input, one-output stateless NAND circuit requires action 5, all checks, reserved zero and loss ≤100 bps. A 101 bps quote can pass the Solidity hard floor and still receive a circuit denial. Future operations require an explicit schema decision. One output byte 00 denies and 01 permits. A bounded staticcall rejects noncanonical output or failure. The D8(b) pair remains the lending pair. Re-cut a three-circuit proposal before requesting approval to publish the expansion. D14 remains with the founder. No public fabrication is authorized.

## Sentinel Connect

Version one of Connect reads the deployed v1 manifest. Stdio tools are sentinel_get_portfolio, sentinel_get_positions, sentinel_get_markets, sentinel_get_rates, sentinel_get_policies, sentinel_get_strategies, sentinel_simulate_auto_repay, sentinel_propose_auto_repay and sentinel_execute_auto_repay. All accept an empty object except execute, which accepts a locally issued proposalId. The process pins public chain 1952, operator, account, target and zero-value autoRepay() selector. Execute requires explicit enablement and a dedicated operator key inherited through the environment. The underlying grant controls the amount at inclusion. Reconcile submitted hashes against confirmed receipts and expose the actual amount. V2 write tools require a separate interface review.

## Integration status

Design freeze only. Enable a route only after its verified manifest and UI acceptance exist. Fork receipts use a local chain ID and cannot identify public transactions. The December 2 cut line requires fork verification and UI integration.

## Implemented ABI and external client

The generated JSON ABIs live in `packages/chain-config/expansion/abi/`. Factory constructor arguments are lending adapter, swap adapter and execution policy. The factory exposes `createAccount(bytes32 accountPolicyId)` and `accountOf(address owner)`. Account grants use operation IDs 0 supply, 1 redeem, 2 borrow, 3 repay and 5 swap. The read-only `exposure()` returns collateral-book shares and stored underlying debt at the last accrual. The account emits `SwapSettled(operator,tokenIn,tokenOut,amountIn,amountOut,slippageBps)`. The bps field is the allowed loss implied by minOut. Read actual input and output from the receipt. A captured 101 bps rejection uses selector `0x84a6f8c3`. [Generated ABIs](../../packages/chain-config/expansion/abi) · [Fork receipts](../../evidence/session5-swap/fork.json)

D15 adds three read-only tools to the nine in the freeze. `sentinel_quote({from,amountRaw})` returns an informational 196 quote or a typed blocked result. `sentinel_simulate_operator_borrow({})` runs a fixed 1 mUSD borrow as the repay-only operator using eth_call. `sentinel_get_execution_receipt({proposalId})` reconciles the signed transaction and confirmed post-state. Stdio exposes twelve tools and exactly one execute tool. Bigint values cross the JSON boundary as decimal strings. [SDK types](../../packages/sentinel-sdk/npm/index.d.mts) · [External client instructions](../../services/mcp/README.md)

The 1952 expansion manifest is separate from M4. It binds `contracts`, `runtimeCodeHashes`, creation and source hashes, `m4.accountPolicy`, `execution`, `swap` and the public journal. `uiEnabled:false` means the deployment has not yet passed frontend acceptance. The local testnet fork has its own explicit profile label because the v1 registry requires the original chain ID even on a fork.

## Session 6 operator discovery and emergency stop

For each account read `operatorCount()` and all `operatorAt(uint256 index)` at the same confirmed block. The list holds each address with at least one configured grant once. Spent and expired grants stay discoverable until revoked. Removing the last configured grant for an operator can move an index. A call outside the enumerated range reverts.

The owner may call `revokeAllOperators()` once to advance the account's authorization epoch. The count immediately becomes zero and prior grants cannot authorize any operation, including after an operator is added again. The account emits `AllOperatorsRevoked(uint256 indexed newEpoch)`. Individual grant events and the existing `grants(operator,adapter,op,inputAsset)` getter retain their signatures. Use the getter to verify remaining amount and expiry at the same block. V1 accounts retain the existing single-operator revoke interface.

## Pinned ERC-4626 profile

A separate VaultSentinelAccountFactoryV2 creates accounts that inherit v2 lending, swap and emergency revocation. The factory fixes one SingleVaultAdapter, vault and underlying. A base v2 account has no vault selectors. Display the account version before enabling a vault action. Both shares and USDC in this profile have six decimals. A vault-share balance belongs to the account that holds it. Read actual shares, converted assets and current redeem/withdraw maxima using vaultPosition().

Only the owner may set the absolute allocation cap and minimum shares per whole asset (WAD) via setVaultDepositLimits. Grant IDs 6, 7 and 8 identify deposit, redeem-by-shares and withdraw-exact-assets. Grant 6 uses underlying asset units. Grants 7 and 8 use vault share units. An exact withdrawal previews the share debit, requires it to fit the grant and the caller-supplied maximum, then checks that actual shares burned equal the preview. Both the asset and the shares use six decimals in these deployments. Deposit requires minShares, redeem requires minAssets, and withdraw bounds the shares burned. All three accept a deadline, with settlement to the account. The owner can exit in kind through exitVaultShares when the vault cannot pay cash. Events include VaultSettled, VaultLimitsSet and VaultSharesExited. Both factory addresses, the source of each price or conversion, and disabled capability status belong in the UI. [Vault account ABI](../../packages/chain-config/expansion/abi/VaultSentinelAccountV2.json)

## Connect v2 public testnet tools

The restricted profile exposes `read_account`, `read_market`, `simulate_and_propose_swap`, `execute_swap`, `simulate_denied_borrow`, `mine_denied_borrow` and `get_receipt`. The two execution tools accept a locally issued proposal ID. The swap binds the exact input, minimum output, deadline, spender and recipient. The optional negative tool is limited to one deliberately unauthorized one-raw-unit borrow on the demo account. Show simulated, broadcast, confirmed, mined revert and needs-review states separately. The 1952 mock venue quote and the optional 196 OKX market quote carry their own chain, observation time and availability. [Tool inputs, outputs, limits and verification](../../services/mcp-v2/README.md)

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

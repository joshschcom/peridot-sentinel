# Session 2 independent review

Reviewed on 25 November 2026 against local base `43f3b603398946e12b68809e98a532359ca0fd0c` and the keeper and proposal edits in the shared working tree. My chain calls used public read-only RPCs. The review did not use a signer.

## D8(b) fabrication proposal

I decoded all three unsigned envelopes with viem and independently re-encoded them from the two specs compiled by the SDK. The bytes, chain ID 196, targets, EIP-1559 fields, native values, gas limits, and both netlist hashes matched. The envelopes leave sender, nonce and signature unset. The mint calldata is 68 bytes, market fabrication is 580 bytes and account fabrication is 772 bytes. The supplied fork evidence has three successful receipts, a NAND balance sequence of 150 → 87 → 0, and 12/12 matching SDK vectors. The Peridot circuit IDs 2 and 3 in that evidence are fork-only. [Unsigned proposal and local fork evidence](session2-d8b/proposal-and-fork.json)

| Quantity | Independently derived result |
|---|---:|
| Mint plus two fabrication fees | 0.00326 OKB |
| Fork gas usage and execution fee estimate at 20,000,001 wei per gas | 933,980 gas / 0.00001867960093398 OKB |
| Expected three-call cost at the quoted gas price | 0.00327867960093398 OKB |
| Envelope gas ceiling at 50,000,000 wei per gas | 1,220,000 gas / 0.000061 OKB |
| Three-call ceiling at pinned ancillary fees | 0.003321 OKB |
| Estimated / ceiling USD at the recorded 77.65 USD/OKB | 0.2545894710125235470 / 0.25787565 |
| Alternative new-CPU acquisition subtotal, excluding execution gas on both chains | 2.29502214469268348013850 USD |

The alternative subtotal converts its USDT purchase, BNB bridge fee and two OKB fabrication fees using separate recorded USD index closes. Execution gas for wallet-specific approvals, acquisition, bridge and X Layer actions remains excluded. The selected existing-CPU route requires native OKB only. [Fee and price observations](session2-d8b/fees-and-prices.json)

I confirmed the published pin hash for block 76,846,436 and repeated fee and supply reads at block 76,847,029, hash `0x741bc8422212fcf7e2e41aa326235673b71bd952cb5ef4c32f04c8a765253018`. Both blocks returned the same registered CPU 410, 9,837 available components, a zero component unit price, a batch fee of 660,000,000,000,000 wei, 1,300,000,000,000,000 wei per fabrication and a CPU nextId reading of 1. The X Layer GasPriceOracle returned zero for getL1FeeUpperBound(972) and getOperatorFee(1220000) at both observations. These are historical snapshots. Any later consideration of signing requires a fresh fee and inventory check, actual wallet eligibility and founder approval.

## Studio and demo verification

`cd contracts && forge test --match-path 'test/studio/Studio.t.sol' --summary` passed 5 tests with 0 failures and 0 skips. They covered permissionless market registration with a valid proof, independent registrar permissions for processor trust and other policy kinds, proof scope, processor and program identity, first-entry reuse, isolation across registries/processors, and refusal after trust revocation. I compared the generated and Forge ABIs for PolicyRegistry (21 entries), IsolatedController (54) and SentinelAccount (41). They matched exactly. Both policy emitters use topic `0xeb463f07e933856af299f9a0abac9614d66118b9fd44ee20d5bddba7ab3b10a6`. A policy denial reverts its transaction and its transient logs.

Local Studio evidence records the same canonical policy ID on the second invocation and different markets for two deliberate creation requests. Only the first invocation needs to add and register that circuit. The demo-operations journal keys writes by operation, actor, target and calldata hash and reconciles submitted nonces. I inspected the saved unforked and sponsor-fork runs. Each contains 22 operational receipts and distinct policy approvals from the Sentinel and controller. During each liquidation the first account's stored debt changed from 80,000,000 to 60,000,025 base units including accrual, and the independent market's accounting snapshot stayed equal across the settlement. Both runs use mock prices, and only the sponsor-fork run uses the sponsor processor with fork-only circuit IDs. [Local operation receipts](session2-ops/local-d3fc8f1b0d3d/all.json) · [Fork operation receipts](session2-ops/sponsor-fork-d8c23ebb1e0b/all.json)

## Keeper and rollout

- **Corrected during review.** An operator journal is shared across Sentinel accounts. A pending hash could initially be attributed to the wrong account on the activity endpoint. The revised transactionally migrated journal stores the intended account. An unknown legacy target or another account's unmined reservation yields a hash-free busy state. Mined receipts are recorded under their actual destination. A worker that reconciles another account's receipt returns a neutral status and preserves its own service state. The parent lead owns HTTP, fault and migration smoke results.
- **Recovery boundary.** Reservations are keyed by a single operator slot. A conditional delete clears the matching hash only. An interrupted send whose receipt is unavailable remains reserved until reconciliation. The service uses bounded retry for transport errors and pauses its execution loop on a mined revert belonging to its configured account. An activity page provides a bounded recent window and can contain duplicate observations of the same receipt.
- **Public deployment.** At X Layer testnet block 47,157,179 the official RPC returned chain ID 1952 and exactly 0 wei for `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67`. Gas funding remains required. The unsigned D8(b) proposal is a separate founder decision. No public transaction or deployment resulted from this review.

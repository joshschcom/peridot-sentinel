# Development release review, 25 November 2026

A6 reviewed the local Peridot development build, including working-tree changes after base commit `1903c15cf2e65d2c97b7c7d15c189e3d37398bc3`. The local deployment uses mock tokens, a mock price feed and the development reference processor. The review covered the controller, pToken entry points, registry, policy adapter, Sentinel, keeper, deployment script and manifests.

## Verification

| Command or comparison | Observed result |
|---|---|
| `cd contracts && forge test --summary` | 15 passed, 0 failed, 0 skipped across market (6), policy (4) and Sentinel (5) suites. Forge emitted the inherited NatSpec warning in PTokenInterfaces. |
| `npm --prefix packages/circuit-sdk test` | 8 passed, 0 failed, 0 skipped after TypeScript build. |
| Compare each exported ABI from `packages/chain-config/dist/abis.js` to the same-named Foundry artifact in `contracts/out` using exact JSON equality | All ten ABIs matched, covering 311 constructor, function, event and error entries. |
| `node packages/chain-config/scripts/check-manifest.mjs packages/chain-config/deployments/31337.json http://127.0.0.1:18545` | 13 distinct contract addresses returned code on unforked local chain 31337 at block 32. |

Market enforcement is in the pToken/controller path. Local tests exercised direct mint, borrow, transfer, redemption by share and underlying, and exit. Repayment, valid liquidation and seizure bypass policy evaluation. The local suites exercised repayment and a debt-free exit during a circuit or oracle outage. The controller still requires a valid liquidation price. New risk uses accrued book state. The optional circuit reserve check cannot relax the controller's unconditional cash floor.

Sentinel fixes its market and withdrawal recipient. Operator borrow pays the account. Automated repay uses the smallest of remaining debt, idle debt tokens and the grant's residual budget. Authorization checks include an exclusive expiry, mask and revocation. Owner repayment is available even after policy revocation. Direct account policy checks and market enforcement share the controller's projected state.

## Findings and disposition

- **Medium, keeper concurrency, corrected in source.** The initial journal allowed a reconciler handling an old receipt to remove a newer pending record. The revised SQLite journal uses a unique slot per operator and deletes only a row matching the reconciled transaction hash. The reviewer inspected the revised query and reservation. The local functional suites above do not exercise simultaneous keeper processes.
- **Operational limitation.** A submission interrupted after reserving a hash can leave a pending record without a mined receipt. The keeper stops subsequent submissions and records its pending state. Operators need to inspect the hash and nonce before recovery. Deduplicate audit/activity records by transaction hash if multiple workers observe the same receipt.
- **Funding and release gate.** The zero-delay contracts and mock price feeds are restricted to local/testnet chain IDs by contract constructors. The deployment script also checks the profile, node chain ID and testnet signer. Production still needs a separate governed configuration, deployed bytecode and dependency verification, validated asset/oracle/liquidation routes and release-level testing. The existing manifest check verifies chain ID and code presence. It cannot establish the identity or governance of a live proxy implementation.
- **Scope of evidence.** These test counts and address checks cover the development implementation. A1 maintains sponsor processor and mainnet-fork evidence independently. Public testnet deployment and the frontend wallet path require their own receipts and verification.

The reviewed sequential local demo has no outstanding critical or high finding from this bounded review. Funded release remains blocked by the separate release gates.

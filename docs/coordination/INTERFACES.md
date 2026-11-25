# INTERFACES — canonical cross-team contract

**Version:** `v0-provisional` (seeded by Claude on 2026-11-25 so frontend fixtures share one schema; **Astra owns all revisions**).
Generated ABIs in `packages/chain-config` are canonical for actual signatures once they exist. Every change bumps the version and adds a row to the history table at the bottom, plus a MILESTONE_LOG notice.

## 1. Chains
| Name | chainId | RPC | Explorer | Status |
|---|---|---|---|---|
| X Layer testnet | 1952 | https://testrpc.xlayer.tech | https://www.okx.com/web3/explorer/xlayer-test (verify) | dev target |
| X Layer mainnet | 196 | https://rpc.xlayer.tech | https://www.okx.com/web3/explorer/xlayer (verify) | read-only / fork only |

## 2. Operations (uint8 enum `Op`)
| Value | Name | Risk class | Market policy applies | Account policy applies |
|---|---|---|---|---|
| 0 | SUPPLY | exposure-increasing for market | yes (caps) | yes |
| 1 | REDEEM | risk-increasing (solvency) | yes | yes |
| 2 | BORROW | risk-increasing | yes | yes |
| 3 | REPAY | risk-reducing | **never gated by circuits** | **never gated** |
| 4 | ENTER_COLLATERAL | risk-reducing | no | yes (allowed-action) |
| 5 | EXIT_COLLATERAL | risk-increasing | yes | yes |
| 6 | MARGIN_OPEN | risk-increasing (P1) | yes | yes |
| 7 | MARGIN_CLOSE | risk-reducing (P1) | never gated | never gated |
| 8 | REBALANCE | depends (P1) | tbd | tbd |

Liquidation, seize and repay are never gated by any circuit. Protocol solvency checks always remain authoritative.
Enforcement point (direction for Astra): market policy is evaluated inside the controller `*Allowed` hooks (mint/redeem/borrow/transfer). It is not a wrapper, so direct pToken calls are covered.

## 3. PolicySpec (TypeScript, shared via `@peridot/circuit-sdk`)
```ts
export type PolicyKind = 'MARKET' | 'ACCOUNT';
export interface PolicySpec {
  schema: 'peridot.policy/v0';
  kind: PolicyKind;
  templateId: 'market-max-ltv-v0' | 'account-guard-v0';
  templateVersion: 0;
  params: MarketMaxLtvParams | AccountGuardParams;
  label?: string;              // display only, not hashed
}
export interface MarketMaxLtvParams {        // market: deny risk increase if post-op LTV > maxLtvBps or oracle stale or cash reserve breached
  maxLtvBps: number;           // integer 0..10000
  requireCashReserve: boolean;
}
export interface AccountGuardParams {        // account: stricter personal LTV and allowed-action mask
  maxLtvBps: number;           // integer 0..10000, typically < market max
  allowedOps: Op[];            // e.g. [SUPPLY, BORROW, REPAY]
}
```
Canonical hash: `keccak256(canonicalJSON(spec without label))`. Final width and encoding are Astra's choice.

## 4. Circuit context input (provisional, Astra finalizes)
Packed little-endian bit vector built **in Solidity** from authoritative state:
`op (4 bits) | oracleFresh (1) | postLtvBps (14, range-checked ≤10000, revert if out of range) | cashOk (1) | thresholdBps (14, from template config) | reserved`.
Output: 1 bit `allow`. Optionally 4 bits `reasonCode`. Stateless circuits only (nState = 0).

## 5. Policy registry entry
`{ policyId: bytes32, kind, chainId, processor: address, circuitId: uint256, netlistHash: bytes32, schemaVersion, templateId, templateVersion, nIn, nOut, configHash: bytes32, publisher: address, metadataURI }`

## 6. Errors and reasons (provisional names)
- `MarketPolicyRejected(bytes32 policyId, uint8 reasonCode)`: the market circuit returned deny.
- `AccountPolicyRejected(bytes32 policyId, uint8 reasonCode)`: the Sentinel circuit returned deny.
- `PolicyEvaluationFailed(bytes32 policyId)`: the processor call reverted, ran out of gas or returned a bad length. This fails closed for risk increases only.
- `OperatorNotAuthorized(address operator, uint8 op)`, `OperatorExpired()`, `ExceedsOperatorLimit()`, `RecipientNotAllowed()`.

The frontend maps each error to a friendly message and keeps the raw error in an advanced view.

## 7. Events (provisional)
- `MarketCreated(marketId, owner, controller, policyId)`
- `MarketPolicySet(marketId, policyId)`
- `PolicyRegistered(policyId, processor, circuitId)`
- `PolicyEvaluated(policyId, opHash, allow, reasonCode)`
- `AccountCreated(owner, account)`
- `AccountPolicySet(account, policyId)`
- `OperatorSet(account, operator, opsMask, maxAmount, expiry)`
- `OperatorRevoked(account, operator)`
- `AutoRepayExecuted(account, operator, pToken, amount, healthBefore, healthAfter)`

## 8. Deployment manifest (Astra generates, Fable reads)
`packages/chain-config/deployments/<chainId>.json`
```json
{ "chainId": 1952, "abiVersion": "<hash>", "commit": "<sha>", "profile": "testnet",
  "contracts": { "MarketFactory": "0x…", "PolicyRegistry": "0x…", "TapeOutAdapter": "0x…", "SentinelFactory": "0x…" },
  "markets": [{ "id": "…", "controller": "0x…", "pTokens": {"USDC":"0x…"}, "mock": true }],
  "tapeout": { "processor": "0x… | NOT_DEPLOYED", "real": true, "circuits": [] },
  "mocks": ["MockUSDC", "MockOracle"] }
```
If a manifest is absent, the frontend runs in **FIXTURE MODE**, shows a visible banner and disables writes.

## 9. Frontend service boundary (Fable owns implementation)
`WalletService`, `MarketService`, `AccountService`, `PolicyService`, `ActivityService`. Each one has a `fixture` and a `chain` implementation with the same TypeScript interface, and is selected per feature by manifest readiness.

## Version history
| Version | Date | Author | Change |
|---|---|---|---|
| v0-provisional | 2026-11-25 | Claude | Initial seed for parallel start |

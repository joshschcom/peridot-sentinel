# Peridot Sentinel strategy templates

`peridot.strategy/v1` describes two strategies available on X Layer testnet (1952). Importing and exporting a template is offline. Only the account owner can grant authority through the existing contracts. An author's name, instructions, address or signature cannot authorize an operator.

| Template | Deployed binding | Owner adoption |
| --- | --- | --- |
| Debt protection | M4 Sentinel v1, mUSD (6 decimals), ACCOUNT circuit 2 on the development reference processor | Verify the owner’s existing account on this controller and its active policy. Set the account-wide trigger when it changes, then replace the selected operator’s grant with the repay-only mask `8`. The operator calls `autoRepay()` when LTV reaches the inclusive trigger. |
| Restricted agent swap | Base v2 Sentinel, one inventory-funded mock mWOKB → mUSDC venue, EXECUTION circuit 1 on its dedicated development reference processor | Verify the owner’s v2 account, fixed pair and execution policy. Set one grant for operation `5`, the pinned adapter and mWOKB as input. Swap output goes to the account. The maximum oracle-relative loss is fixed at 100 bps by the deployed circuit. |

These bindings come from the [M4 manifest](../chain-config/deployments/1952.json) and [base v2 manifest](../chain-config/expansion/deployments/1952.json). The separate [judge campaign](../../deployments/session7/1952/judge-01/manifest.json) has other markets and adapter addresses. A judge-campaign account cannot replace these factory bindings. The v1 ACCOUNT circuit guards risk increases. The auto-repay path checks its trigger and grant, and remains available through a processor outage.

## Import and review

The browser entry point is [index.ts](index.ts). Fable can import that source directly from the workspace. After npm links the workspace, `@peridot/strategy-sdk` exports the same API. Use the [schema](strategy.schema.json) for authoring and the TypeScript validator on every import. Read the two [curated JSON examples](templates) without user or operator keys.

```ts
import { importStrategy, buildAdoptionPlan, buildRevocationPlan } from '@peridot/strategy-sdk'

const { template, canonical, hash } = importStrategy(pastedJson)
const selection = { owner: connectedAddress, operator: operatorChosenByOwner }
const preview = await buildAdoptionPlan(publicClient, template, selection)
```

1. Display the network, profile, assets, circuit, budgets in raw and human units, expiry, previous grant, current trigger, proposed settings and warnings. Treat all imported text, including agent instructions, as untrusted display text. Never insert it into HTML, a shell, a system prompt, a transaction target or wallet options.
2. The owner chooses their operator separately. The SDK derives the adapter and circuit from pinned manifests. It resolves the account from the factory’s `accountOf` mapping and verifies its owner. Missing accounts must be created in the existing account flow, with the pinned policy selected. Adoption also requires the appropriate position, idle repayment funds or swap inventory for later execution. The campaign-specific MCP servers have their own account and operator restrictions.
3. The SDK returns `reviewId` and an empty `transactions` array if the current operator already has a recorded grant or adoption changes the account-wide trigger. After the owner reviews the impact, rebuild with `{...selection, acknowledge: preview.reviewId}`. The ID commits to the template, selected identities, observed grant and trigger. A changed grant produces a fresh review. Accepting the ID only generates unsigned calldata.
4. Review each `transactions[]` member’s `method`, typed `args`, `from`, `to`, `value` and `data`. Sign each zero-value call separately in the owner’s wallet. Confirm its receipt before continuing. If the second signature is cancelled, the first trigger change remains in force. Re-read state after each receipt or intervening change. The grant getters have no compare-and-swap on chain. `blockNumber` and `blockHash` identify the review snapshot. The expiry derives from that block's timestamp and the proposed duration.
5. To remove this grant, call `buildRevocationPlan(publicClient, template, selection)`. V1 revokes the selected operator’s entire mask and leaves the shared trigger configured. V2 revokes only the selected adapter/op/input tuple. Other grants remain effective. The separate v2 account-wide emergency stop is `revokeAllOperators()`. Revocation planning skips live circuit reads to preserve recovery during a processor outage.

Grant replacement can refill a spent budget. V1 also replaces any borrow permission held by the selected operator. Changing its trigger affects **every** operator with repay authority and v1 has no on-chain enumerator. Review historical operator events before changing the trigger.

## Limits and identity

- The import cap is 8,192 characters. Exact fields, case-sensitive deployment addresses, fixed operation order and full policy identities must match a known profile. Free text is short printable English prose. Unknown fields, duplicate keys, injected addresses, key-like strings, conventional mnemonic-shaped word runs and credential markers fail validation. Arbitrary text can still contain private information or instructions. Supply only public descriptions.
- The SDK serializes JSON with recursively sorted object keys, original array order, no whitespace and decimal raw-unit strings. The hash is Keccak-256 of the UTF-8 bytes. It identifies content and grants no authority.
- V1 accepts 1–10,000 trigger bps and caps cumulative imports at **2 mUSD** (2,000,000 raw). The grant has one cumulative budget. A single repayment can consume all of it up to idle funds and outstanding debt.
- V2 caps a single call at **1 mWOKB** and cumulative imported allowance at **2 mWOKB**, with per-call ≤ cumulative. Both use 18 decimals. The caps follow the bounded public demo route. The contracts accept wider integers. The swap circuit enforces 100 bps and the adapter’s hard ceiling is 500 bps. An imported template cannot widen them.
- Suggested grant life is 1–604,800 seconds. The SDK deliberately requires positive bounded integer amounts and fresh relative expiry. It never imports an existing account, operator, recipient, grant ID, absolute expiry or executable calldata.

## Verification

```sh
npm --prefix packages/strategy-sdk run check
node packages/strategy-sdk/smoke.mjs
```

The first command type-checks the SDK, regenerates the expected schema in memory, compares both examples with the manifests and runs offline permission and parsing tests. The second reads both deployed profiles, resolves the existing demo owner’s own accounts, builds review and revocation plans and decodes them with generated ABIs. It uses public addresses and read-only RPC requests. Historical block hashes and decoded method names are in the [public read-only verification](../../evidence/session7-strategies/public-read.json). The executed operator demonstrations are recorded separately in the [v1 receipt](../../evidence/session5-mcp/flagship-1952.json) and [v2 settlement evidence](../../evidence/session6-mcp-v2/verified.json).

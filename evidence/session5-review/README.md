# A6 expansion release review

This review covers the expansion working tree over `3f53cea`. The execution, lending and swap contracts use separate addresses. A diff against M4 checkpoint `34797b2621c1b2541edcb3ab99ec74f1a1621203` found no changes in the v1 contract source tree, v1 ABI directory or either v1 public manifest path. All six generated expansion ABIs match the corresponding compiled Foundry artifact.

## Contract and signer scope

The v2 account calls the lending books for its own address. Repayment and debt-free redemption avoid the policy evaluator. A swap spends the account’s idle input, fixes the account as recipient, checks input and output balances and clears allowances. Grants bind the operator, adapter, operation and asset, with separate per-call and remaining limits. Owner authorization controls withdrawals. The standalone EXECUTION binding checks circuit dimensions and the netlist hash on construction, then checks processor code and canonical response before accepting a swap. These scope checks apply to the development account profile.

MCP exposes one signing operation. It pins chain 1952, the v1 account, dedicated operator, zero value and the exact `autoRepay()` selector. The signer reconciles a locally computed hash through the proposal and keeper journals. The receipt verifier checks the confirmed transaction and both repayment events. Submitted hashes require same-hash reconciliation across retries.

## Captured acceptance evidence

| Item | Evidence and conclusion at review |
|---|---|
| Real venue on a private fork | At fork blocks 76,931,197 and 76,931,198, the recorded 101 bps denial preserved balances and grant, then the 95 bps call exchanged 1 WOKB for 82.164632 USDC. The pool recipient matches the v2 account, the operator received zero output, both allowances ended at zero, and the grant fell by 1 WOKB. [Fork receipts](../session5-swap/fork.json) |
| 1952 development rehearsal | The local fork preserved chain ID 1952. The journal contains 18 distinct hashes with 18 distinct nonces. The mock swap returned 79.960000 mUSDC at local block 47,241,890. The 101 bps denial is an eth_call. The rollout code now renews stale quotes and deadlines while there is no signed swap, and preserves the calldata for a reserved hash. A hard process exit can leave the exclusive filesystem lock behind. Check the writer and outstanding hash before supervised recovery. [Fork manifest](../../deployments/expansion/local-fork-of-1952/manifest.json) |
| Public expansion | No public v2 manifest or journal was present at review. UI acceptance is a separate milestone. |
| MCP and OKX | The external stdio client discovered twelve tools. Public reads demonstrate an eligible repayment and an operator borrow denial. The OKX quote returned a typed credentials-blocked outcome. The earlier keeper receipt exercises receipt verification. The seven-step Connect-submitted public receipt, remaining grant and a successful provider quote were pending at review. [MCP captures](../session5-mcp/README.md) |
| Three-circuit publication | The D16 proposal contains unsigned 196 calls and private-fork receipts for MARKET, ACCOUNT and EXECUTION. Public publication and public evaluation of the new circuit IDs remain acceptance milestones. [Proposal and fork evidence](../session5-d8b/proposal-and-fork.json) |

## Findings sent to the owners

1. The deployment script initially retained an expired one-hour swap deadline after interrupted preparation. The revised source renews the deadline and repeats the decision observation before reservation. Already reserved transactions retain their original hash.
2. The demo client persisted an unsigned proposal for longer than its five-minute validity. A restart after expiry or a changed grant could keep trying the old ID. Recovery needs to distinguish an unsubmitted proposal from a known hash and preserve the superseded attempt. A credentials-blocked quote also needs a later, dated successful observation to support D15’s quote requirement.
3. The signer checked the exact repay-only mask, trigger and grant at the confirmed snapshot and checked the pending repayment amount before signing. A newer authorization could leave the same simulated amount. Recheck the pending grant and trigger before signing if claiming this additional freshness guarantee. The fixed `autoRepay()` selector and the contract’s inclusion-time authorization still apply.
4. The interface document linked to `index.d.ts` while the package exports `index.d.mts`.

## Independent checks

```sh
forge test --root contracts/expansion --offline --match-test 'test(FactoryAndOwnerPermissions|PerCallAndCumulativeBoundsAndScopedRevocation|RepaymentAndOwnerExitDuringOutage|BoundaryAndFlags)'
node --test --test-name-pattern='catalog|wrong chain|read retries|quote credentials' services/mcp/test/connect.test.mjs
git diff --name-only 34797b2 -- contracts/src packages/chain-config/abi packages/chain-config/deployments/1952.json deployments/1952.json
```

Four Solidity checks passed and four MCP checks passed, with zero failures and zero skips in these selections. An initial Forge filter with a trailing dollar sign selected zero tests and was corrected before counting results. ABI checks used structural JSON equality for each exported ABI and its build artifact. The swap numbers above come from archived fork receipts and balance snapshots. This review issued no public transactions.

## Closeout · 2026-11-26

| Original finding | Follow-up verification |
|---|---|
| 1. Deployment deadline | Closed by source inspection. Before swap reservation the script refreshes stale mock prices, renews a deadline within 120 seconds of expiry and reruns the denial observation after renewal. A reserved swap keeps its original calldata and hash. The runbook covers recovery from a stale filesystem lock. The script passed `node --check contracts/expansion/script/deploy-expansion.mjs`. |
| 2. Expired unsigned proposal | Recovery fixed. The client checks the exact proposal ID and its recorded invalidation reason, archives the old attempt, then reads fresh state and requests a new proposal. A reserved hash stays on its reconciliation path. The successful OKX provider quote remains an outstanding D15 evidence item. |
| 3. Pending grant | Fixed. Before signing, the server compares the pending repay-only mask, remaining amount, expiry and trigger with the proposal and checks the pending repayment simulation. The contract checks authorization again at inclusion. |
| 4. SDK link | Fixed. The interface link resolves to an existing declaration file and matches the type export in the npm package manifest. [SDK declaration](../../packages/sentinel-sdk/npm/index.d.mts) |

`node --test --test-name-pattern='a replacement needs|pending-state profile' services/mcp/test/connect.test.mjs` passed both new regression tests, with zero failures and zero skips. This closeout used local tests, file checks and source inspection.

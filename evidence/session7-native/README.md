# CPU 410 financial enforcement rehearsal

Run `node contracts/expansion/script/native7/run.mjs --rehearse` from the repository root, then `node --test contracts/expansion/test/native7/run.test.mjs`. The first command builds both project profiles, starts and stops its own loopback node, and compares 23 input vectors on the genuine forked CPU, the read-only witness and a separate development interpreter. The registry trusts only CPU 410. The financial guard fixes the MARKET, ACCOUNT and EXECUTION IDs. The development interpreter exists solely to cross-check outputs.

Each financial receipt records the actor, block, transaction status and measured gas. The operation records retain native `eval` subcall IDs, inputs, output decisions and gas from the call trace. Accepted cases check actual token or debt deltas; rejections compare grants, balances, stored debt and allowances. Direct pToken borrows go through the market hook, v2 borrows exercise both lending policies, and typed swaps consume EXECUTION. Collateral, debt tokens, prices and swap inventory are labelled test fixtures on this private fork. [Fork receipts and unsigned proposal](rehearsal-fork.json)

The six observed boundary transactions were:

| Consumer and projected input | Result | Fork gas |
|---|---|---:|
| V2 account borrow, 5500 bps | ACCOUNT and MARKET approved | 796,290 |
| V2 account borrow, 5501 bps | ACCOUNT denied | 435,534 |
| Direct debt-book borrow, 6500 bps | MARKET approved | 480,767 |
| Direct debt-book borrow, 6501 bps | MARKET denied | 367,761 |
| V2 swap, 100 bps tolerated loss | EXECUTION approved | 350,388 |
| V2 swap, 101 bps tolerated loss | EXECUTION denied | 258,293 |

The v2 borrower received 55 mock USD against its 100 mock collateral units. The direct borrower received 65 mock USD against a separate 100 collateral units. The approved operator swap spent one mock collateral unit and delivered 0.999500 mock USD to the account, with both allowance layers zero at settlement.

Three dependency failures are deliberately injected into **private Anvil state** after the healthy operations. The hashes of the copied CPU or implementation change in those cases, so the pinned guard rejects them before evaluating any program. The harness restores the exact original bytes after each scenario. It preserves the individual mined receipts. The separate Foundry test running on a local fork of the same account intercepts `eval` responses while preserving all code hashes. It supplies a revert, one raw return byte, a nonbinary output and a trailing ABI word. The underlying production-path decoders reject each response on all three risk-increasing paths. These 12 checks are simulations, distinct from the mined fault receipts.

After publication use `--published` for an entirely new financial wiring on a private fork at the verified public block. It reads `packages/chain-config/expansion/tapeout-196.json` and stores its result in `published-ids-fork.json`. Missing public IDs stop that mode. The pending configuration remains under Claude's existing postpublication tooling. [Founder proposal](../../docs/NONCUSTODIAL_MAINNET_DEMONSTRATOR.md)

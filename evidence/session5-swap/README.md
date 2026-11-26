# Exact-input settlement through a Sentinel v2 account

A newly created v2 account on private Anvil chain **31337** exchanged **1 WOKB for 82.164632 native Circle USDC**, using the real Uniswap V3 pool and SwapRouter02 from X Layer mainnet block **76,931,173**. The operator signed through the local unlocked Anvil account. The pool’s Swap event named the router as sender and the Sentinel account as recipient. No public transactions or keys were used. [Receipts, circuit IDs and balance deltas](fork.json) · [Pinned venue and oracle sources](../session5-venues/observations.json)

| Case | Local fork receipt | Outcome |
|---|---|---|
| Operator permits 101 bps loss | `0xba7c6b9addcea8db722929ecba7e03b358ed8673c859e66dcb55d211a8ab511d` at 76,931,197 | The requested minimum of 81.401503 USDC passed the adapter’s 78.120444 USDC floor. The EXECUTION circuit denied it. Receipt status reverted, gas 299,221. Call trace returned `ExecutionPolicyDenied()`. Balances, grant remaining and both allowances matched the pre-trade snapshot. |
| Operator permits 95 bps loss | `0xc1291f9b485cea8d85ebc46d909c80ddb4494efbaf707a498f779f0fa545ced0` at 76,931,198 | Independent oracle quote 82.232046 USDC, requested minimum 81.450842. Pool paid 82.164632 USDC to the v2 account. Account and pool deltas matched in both tokens. The operator received zero output, both approvals ended at zero, and the grant's remaining budget moved from 2 to 1 WOKB. Gas 455,462. |

The rehearsal minted NAND components and fabricated MARKET, ACCOUNT and EXECUTION on the fork’s sponsor CPU `0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5`, receiving **fork-only** circuit IDs 2, 3 and 4. The isolated market provided the v2 account's lending bindings. The account's actual swap spent idle WOKB under the 59-gate EXECUTION circuit. The independent price source read both X Layer Chainlink USD price proxies plus sequencer status with a one-hour recovery interval and a maximum observation age of one day. USDC and OKB prices can update at different times and the feed can diverge from an executable quote; either condition can prevent settlement.

The 1952 fixture uses a separately labelled inventory venue, an explicitly priced test oracle, and test ERC20s. It pays output only from tokens actually held at its address. The mock has no constant-product pool or CL position. Public testnet manifests and receipts are a separate delivery.

## Replay

From the repo root, build M4 and the expansion, then start a fresh private fork. The rehearsal checks its chain ID, URL, block number and block hash. It wraps native Anvil funds through the actual WOKB contract and uses two unlocked fork EOAs. It does not use token-storage overrides, a funded-holder impersonation or a mainnet key.

```sh
(cd contracts && forge build)
(cd contracts/expansion && forge build && forge test --match-path 'test/swap/*')
anvil --host 127.0.0.1 --port 19635 --fork-url https://rpc.xlayer.tech --fork-block-number 76931173 --chain-id 31337 --no-storage-caching --quiet
```

In a second shell at the repo root, run `node contracts/expansion/script/swap/fork.mjs`. Successful completion checks the receipts, revert selector, pinned circuit dimensions and netlist hashes, token and pool identity, and exact settlement and authorization changes. Generated addresses, hashes and gas may change with source/build changes or fork node settings. [Rehearsal](../../contracts/expansion/script/swap/fork.mjs)

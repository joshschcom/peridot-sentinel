# Sentinel Connect v2 campaign on X Layer testnet

Run this from the repository root on the machine holding the existing D9 operator environment. The recorded owner objective asks the model to choose a bounded input and minimum output, retain some budget, read market data and a canonical receipt, and demonstrate one authorization rejection. Claude runs the LLM. The unsigned inspection utility exercises the same MCP service with a scripted client.

```sh
node --test services/mcp-v2/test/*.test.mjs
node services/mcp-v2/inspect.mjs
bash services/mcp-v2/run-claude.sh
```

The last command launches `claude -p` with the checked-in [objective](objective.txt), [private stdio MCP config](claude.mcp.json), no built-in tools, a seven-tool allowlist, and verbatim stream-JSON output. It prints a unique transcript filename. The genuine run requires the existing Claude subscription and a live grant from the owner. Use the D9 lane exclusively for the run. The launcher accepts the dedicated testnet operator through `SENTINEL_OPERATOR_KEY` or `KEEPER_TESTNET_OPERATOR_KEY`. It never reads a key file. The host receives an allowlisted environment for the Claude CLI and a one-use local socket. The restricted MCP process alone receives the D9 key and optional server-side OKX credentials. The launcher closes the local bridge on exit.

Pass the exact printed transcript path to the verifier. It requires read-only RPC and the checked-in manifest. It replays both simulations at their original blocks and compares both receipts, decoded events or revert, and observed budgets and balances independently of the signer's SQLite database.

```sh
node services/mcp-v2/verify-transcript.mjs <path-to-claude-transcript.ndjson> > evidence/session6-mcp-v2/verified.json
```

The [manifest](../../packages/chain-config/expansion/deployments/1952.json) binds one public testnet account and its mock venue, lending books, policy, development reference processor and execution circuit. Prices for actual testnet execution come from the labelled mock feed. The informational OKX quote is for the real WOKB/USDC pair on chain 196. Without server-side credentials, the response carries `status=unavailable`, its reason, request time, source, chain and `quote=null`.

| MCP tool | Typed input | Output or effect |
|---|---|---|
| `read_account` | Empty | Confirmed book positions, idle balances, policy and operator grant, plus any prior campaign submissions. |
| `read_market` | `amountInRaw` | Confirmed testnet reference output and minimums, plus separate OKX quote status. |
| `simulate_and_propose_swap` | `amountInRaw`, `minOutRaw` | Exact operator simulation of mock WOKB → mock USDC with the chosen minimum, plus a locally persisted proposal ID and deadline. |
| `execute_swap` | `proposalId` | Signs at most one zero-value swap to the pinned account, after rechecking current and pending state. |
| `simulate_denied_borrow` | Empty | Proposes the fixed one-raw-unit borrow only after the operator's absent borrow grant produces the expected authorization error. |
| `mine_denied_borrow` | `proposalId` | Explicitly enabled single testnet negative. Uses an explicit 300,000 gas limit and checks its actual receipt. |
| `get_receipt` | `proposalId` | Reconciles an existing proposal and any reserved transaction hash without signing. |

Input amounts are positive base-10 integer strings. Mock WOKB has 18 decimals and mock USDC has 6. The campaign requires an owner grant of at most 1 mock WOKB per call and a remaining cumulative budget at or below 2 mock WOKB. Each submitted transaction has a maximum fee exposure of 0.001 test OKB. Solidity enforces the remaining grant and minimum output through inclusion. The owner retains the ability to revoke. A change to grants, relevant state or prices between the final simulation and mining can lead to a revert.

Keep the ignored `services/mcp-v2/.state/proposals.sqlite` on durable local storage. The server reserves a locally computed hash and nonce in the same SQLite transaction as the shared pending slot for the D9 keeper/Connect-v1 lane. It broadcasts once. Reconcile an unknown submission by its original proposal ID and hash. Backups must preserve the campaign and keeper databases together. Run one signer location. The database enforces one signed swap and one signed negative for the campaign across restarts. It cannot enforce that cap against a separate signer holding the same key.

A mined successful swap requires both settlement events, the exact signed transaction, correct minimum, and reset approvals. Its receipt-window observations must match the spent grant, spent input and received output. A mined authorization rejection requires a reverted receipt, gas remaining, no logs and a canonical-block replay returning `OperatorNotAuthorized()`. Its before/after book, idle balances, grants and allowances must agree. Other transactions can affect these block-end observations. The server reports those mismatches as needing review, and the verifier fails the full evidence check.

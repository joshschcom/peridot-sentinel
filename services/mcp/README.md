# Sentinel Connect

A stdio MCP server lets an external agent inspect the deployed Sentinel v1 account on X Layer testnet. Its only executable transaction is a zero-value call to the account's `autoRepay()` method. The public profile fixes the account, its repay-only operator, the manifest and the RPC domains. Testnet balances are mock assets, its price feed is owner-set, and its policy processor is the development reference implementation. The SDK returns bigint raw units. MCP serializes bigint fields as decimal strings.

## Start and inspect

Use Node 22.13 or later and the repository's normal installed dependencies. The official MCP SDK has a package-local lock to preserve the deployed workspace's root lockfile. From the repository root run the following.

```sh
npm ci --prefix services/mcp/runtime --workspaces=false --ignore-scripts --no-audit --no-fund
npm run build -w @peridot/chain-config
node services/mcp/client.mjs list
node services/mcp/client.mjs inspect
node services/mcp/client.mjs quote
node services/mcp/client.mjs reject
node --test services/mcp/test/*.test.mjs
```

An external MCP host can start `node /absolute/path/to/services/mcp/server.mjs` using stdio. `client.mjs` uses the official MCP Client in a separate process to initialize a session, discover tools and invoke them. No listening port is opened. Only give execution credentials to a host authorized to exercise this specific grant. [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

| Tools | Input | Result |
|---|---|---|
| `sentinel_get_portfolio`, `sentinel_get_positions` | `{}` | Account net value, idle assets, supplied underlying, shares and stored debt |
| `sentinel_get_markets`, `sentinel_get_rates` | `{}` | Manifest markets and risk limits, pToken rates and model-based simple APR |
| `sentinel_get_policies`, `sentinel_get_strategies` | `{}` | Market and account policy registrations, auto-repay trigger, operator mask, budget and expiry |
| `sentinel_quote` | `{"from":"USDC","amountRaw":"1000000"}` or `WOKB` with raw input amount | Informational X Layer **196** WOKB/native USDC estimate from OKX. Missing provider credentials or an unavailable service yields a blocked result with a null quote |
| `sentinel_simulate_auto_repay`, `sentinel_propose_auto_repay` | `{}` | Contract simulation or ineligibility. An eligible proposal includes an ID, the block hash, amount, grant and five-minute expiry |
| `sentinel_execute_auto_repay` | `{"proposalId":"0x…"}` | Restricted chain-1952 transaction or reconciliation of that proposal |
| `sentinel_simulate_operator_borrow` | `{}` | Read-only simulation of a fixed one-mock-dollar borrow by this operator. The repay-only grant yields a decoded on-chain rejection |
| `sentinel_get_execution_receipt` | `{"proposalId":"0x…"}` | Canonical receipt, exact repayment event, confirmed before/after debt, wallet funds and operator grant |

## Authorized seven-step demo

The signer holds the already approved operator key in its environment. The grant must be repay-only (mask 8), funded, unexpired and eligible under the current LTV trigger. The lending account owner controls this grant. The external agent controls no recipient, amount, chain, wallet or calldata. A live OKX quote additionally requires the **server-side** variables `OKX_API_KEY`, `OKX_API_SECRET` and `OKX_API_PASSPHRASE`. The quote is a separate mainnet price indication. The repayment uses testnet lending balances and its own on-chain trigger.

```sh
SENTINEL_ENABLE_EXECUTE=1 SENTINEL_OPERATOR_KEY="$KEEPER_TESTNET_OPERATOR_KEY" node services/mcp/client.mjs demo
```

The client saves the seven steps under `evidence/session5-mcp/flagship-1952.json`. Step three reports a blocked quote if provider credentials are missing. The other steps can proceed. The client persists the proposal ID before execution. If a previously saved unsigned proposal expires or its grant changes, the demo separately reads its submission status. It archives the old observations and restarts its approval flow only when the server has atomically invalidated that exact proposal while it still has no transaction hash. Re-running this command resumes from that ID or returns the completed transcript. Keep both the transcript and the private SQLite journals when resuming. The signer environment is never included in the recorded evidence.

A host can also propose and execute separately with `client.mjs propose` followed by `client.mjs execute <proposalId>` in the signer environment. The v1 account's final repayment is the minimum of outstanding debt, funds and its grant at inclusion. The server rechecks the quote and current grant before signing. The owner can revoke or replace the grant on-chain.

## Confirmation and retry behavior

Read tools use one pinned block at least two blocks behind a recent network head, verify its hash after the reads, and retry transient or stale reads at most three times using the two official RPCs. `STALE_ORACLE`, `STALE_RPC`, `RPC_UNAVAILABLE` and `PROFILE_MISMATCH` are distinct from a genuine zero balance or contract denial. Confirmations here describe L2 depth. They do not assert L1 finality.

The server reserves a nonce and locally computed signed transaction hash before its single broadcast. The persistent proposal journal and the keeper's `pending` slot share a SQLite transaction. Lost responses, timeouts or a process exit leave the original proposal and hash available for reconciliation. The server never resends the signed bytes or creates a replacement. A crash between reservation and actual network submission can leave a permanently unknown hash. Keep the nonce lane reserved for operator review. A confirmed success must match the operator, nonce, recipient, zero value, selector, canonical block, Sentinel settlement event and debt-book repayment event. The outcome includes the actual amount and raw position changes.

After the signed demonstration completes, an independent reviewer can run `node services/mcp/verify-demo.mjs` without a signer. It checks the seven-step recording, the grant and wallet deltas, the rejected operation's exact error, and replays the transaction receipt and block-end balances against the public RPC.

The external quote client is provided by [the OnchainOS wrapper](../onchainos/quote.mjs). Provider responses captured without credentials are in [quote authentication evidence](../../evidence/session5-onchainos/quote-no-auth.txt) and [market API response evidence](../../evidence/session5-onchainos/market-no-auth.txt). The MCP transcript records the quote outcome observed in that specific external session.

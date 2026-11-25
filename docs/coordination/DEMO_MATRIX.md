# DEMO_MATRIX

The status of each step is one of: `fixture` | `fork` | `testnet-live` | `mainnet-live` | `blocked`. Never mark a step live without a tx hash.

| # | Demo step | Prerequisites | Contract status (Astra) | UI status (Fable) | Chain | Tx hash(es) | Expected result | Owner |
|---|---|---|---|---|---|---|---|---|
| 1 | Landing explains both products | none | n/a | fixture | — | — | Judge understands Sentinel and Studio in seconds | Fable |
| 2 | Studio creates isolated market | factory, mock tokens, oracle | not started | not started | 1952 | — | MarketCreated event, inactive then activated | Astra/Fable |
| 3 | Attach TapeOut market policy (processor + circuit ID shown) | TapeOut path (D8) | not started | not started | 1952/fork | — | PolicyRegistered; MarketPolicySet | Astra/Fable |
| 4 | Seed liquidity (supply) | market active | not started | not started | 1952 | — | pToken minted | Astra/Fable |
| 5 | Create Sentinel account, deposit collateral | SentinelFactory | not started | not started | 1952 | — | AccountCreated; collateral entered | Astra/Fable |
| 6 | Authorize personal policy + operator | AccountPolicy, operator perms | not started | not started | 1952 | — | AccountPolicySet; OperatorSet | Astra/Fable |
| 7 | Borrow (allowed) | both policies pass | not started | not started | 1952 | — | debt increases | Astra/Fable |
| 8 | Borrow rejected by MARKET policy (user policy would allow) | market threshold < user | not started | not started | 1952 | — | MarketPolicyRejected | Astra/Fable |
| 9 | Borrow rejected by ACCOUNT policy (market would allow) | user threshold < market | not started | not started | 1952 | — | AccountPolicyRejected | Astra/Fable |
| 10 | Direct pToken bypass attempt denied | market hook in controller | not started | n/a | 1952 | — | revert MarketPolicyRejected | Astra |
| 11 | Keeper auto-repay after labeled mock price move | keeper, operator | not started | not started | 1952 | — | debt down, health up | Astra/Fable |
| 12 | Operator cannot withdraw to itself; owner revokes and exits | Sentinel perms | not started | not started | 1952 | — | RecipientNotAllowed; OperatorRevoked | Astra/Fable |
| 13 | Circuit evidence view (processor, circuit ID, inputs/outputs, netlist hash) | registry | not started | not started | 1952/196 | — | matches on-chain eval | Astra/Fable |

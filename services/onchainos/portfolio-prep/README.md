# OKX read preparation

This offline module prepares requests for OKX wallet balances and the existing WOKB/USDC quote route. All test observations are **synthetic**. The public availability probes from session 6 returned HTTP 401 and provider code 50103. Authenticated holdings, token coverage and quote availability are still unverified. [Previous probes](../../../evidence/session6-onchainos/unauthenticated.json) · [Portfolio design](../../../docs/coordination/OKX_MULTICHAIN_PORTFOLIO_DESIGN.md)

Run the targeted tests from the repository root.

```sh
node --test services/onchainos/portfolio-prep/reads.test.mjs
```

To inspect the unsigned URLs for a **synthetic** watchlist and quote, run the following locally. It prints the plans without making network calls.

```sh
node --input-type=module <<'JS'
import {portfolioPlan, quotePlan} from './services/onchainos/portfolio-prep/reads.mjs'
const evm = '0x0000000000000000000000000000000000000001'
const subjects = ['196', '1', '8453'].map(chainIndex => ({chainIndex, address: evm, role: 'watch'}))
subjects.push({chainIndex: '501', address: '11111111111111111111111111111111', role: 'watch'})
console.log(JSON.stringify([...portfolioPlan(subjects), quotePlan('WOKB', '1000000000000000000')], null, 2))
JS
```

| Plan | Returned data |
|---|---|
| Supported chains | Intersection of provider capabilities with X Layer mainnet 196, Ethereum 1, Base 8453 and Solana 501. A future caller should skip unsupported network scopes. |
| Token inventory | One GET per chain and selected address. Returned chain and holder must match. Asset identities use chain plus token address or mint. Token balance, optional raw balance and USD price remain decimal strings. The default provider risk filter stays enabled. |
| Wallet USD subtotal | One GET per subject with `assetType=1`. This isolates wallet-token value. The provider returns no subject fields for this endpoint, so correlation depends on the original pending request. |
| Trade quote | Informational exact-input WOKB → USDC or USDC → WOKB on 196. Checks input and output identity, input amount and positive output. The normalizer returns only the asset symbols and raw amounts. |

`normalize(plan, observation)` accepts the original plan, HTTP status, parsed JSON body, UTC request and receipt timestamps and the caller's provenance label (`synthetic` or `provider-response`). For a successful provider response it returns a validated field subset. A malformed successful response raises an error and should invalidate that observation. An HTTP or provider error returns `status: "unavailable"` with null data. A successful empty token list is meaningful only for that request's scope and filter. Provider block/slot and source timestamp stay null. Missing prices and raw balances stay null. A provider-reported price of zero remains a reported zero.

The OKX Ethereum example identifies native ETH by an empty contract address. Empty identifiers on the other chains and conventional placeholder addresses remain flagged for verification. Solana holder and mint identifiers preserve case and decode to exactly 32 bytes. Provider logo URLs, arbitrary metadata, raw error text, routes and transaction instructions are discarded. DeFi holdings require separate provider endpoints. [Inventory fields and Ethereum example](https://web3.okx.com/onchainos/dev-docs/wallet/balance-api-all-token-balances) · [USD subtotal fields](https://web3.okx.com/onchainos/dev-docs/wallet/balance-api-total-value) · [Supported chains](https://web3.okx.com/onchainos/dev-docs/wallet/balance-api-chains)

After the founder provisions credentials, a future server-side reader can submit the reviewed GET requests and compare one sanitized answer per enabled chain with an independent RPC read at a recorded height. Confirm token/mint decimals and provider native markers before presenting a portfolio total. Testnet fixture balances, public wallet inventories and Sentinel's on-chain debt or vault exposure each have their own source and scope.

# Public testnet activity snapshot

The Peridot Sentinel app can read a committed JSON snapshot of **settled on-chain events** on X Layer testnet 1952. It covers a single inclusive range from the M4 deployment block. The issuer-set mock prices, test tokens and development reference processor retain their testnet meaning. [Snapshot](../../packages/chain-config/activity/1952.json)

## Refresh

Use Node 22.13 or later with the repository dependencies installed. Run from the repository root.

```sh
npm run build -w @peridot/chain-config
node --test services/indexer/scan.test.mjs
node services/indexer/refresh.mjs
node evidence/session6-indexer/verify.mjs
```

Refresh every **15 minutes during a live demo** and immediately after each deployment or recorded operation has 12 L2 successor blocks. At the observed one-second cadence, 15 minutes adds about nine 100-block pages. Claude publishes the updated JSON with the app build. A one-off local refresh does not update a previously deployed web bundle.

The two official RPC transports must identify chain 1952, recent heads and the same pinned target hash. Each read has a timeout and bounded retries. The scanner pages in 100 **inclusive** blocks with up to six log requests in flight. The first new block must name the saved checkpoint as its parent. Each committed group has its start checkpoint and end hash checked, including a check of the end hash on the other RPC transport. The most recent group is also scanned independently on both endpoints and their decoded results must agree. Every returned event's block hash is verified and its timestamp comes from that block. A verified group is written by atomic rename. A failed group leaves the last contiguous checkpoint available. A local SQLite writer lock prevents concurrent refreshes and releases on process exit.

On the next run, the scanner rechecks the saved checkpoint hash against both RPCs. A confirmed reorg or changed event definitions trigger a rebuild from deployment. When a manifest only appends contract roots to a hash-matched configuration, the scanner preserves blocks before the earliest added deployment, then replays its entire overlapping suffix. Both transports verify the rewind checkpoint. An RPC disagreement, stale head or missing block leaves the last written range intact; rerun the same command after the public backend recovers. The target has 12 successor **L2 blocks** at the lower observed tip.

## Read contract

The file is `packages/chain-config/activity/1952.json`. Import the JSON by repository-relative path at web build time. The pinned v1 package exports are unchanged.

| Field | Meaning |
|---|---|
| `schemaVersion`, `kind`, `chainId` | Numeric 1, literal `indexed-event-snapshot`, numeric 1952 |
| `updatedAt`, `scopeDigest` | UTC refresh time and SHA-256 of source configuration and event ABI |
| `coverage` | Inclusive decimal-string `fromBlock` and `toBlock`, `toBlockHash`, decimal-string `headAtRefresh`, numeric `confirmations`, `status` of `caught-up` or `catching-up`, and `gaps[]` with inclusive ranges and `reason` of `awaiting-index` or `confirmation-depth` |
| `sources[]` | Verified deployment/factory identity, represented as `address`, ABI contract name and first covered `fromBlock` |
| `events[]` | `blockNumber`, `blockHash`, `transactionHash`, `transactionIndex`, `logIndex`, UNIX-seconds `timestamp`, emitting `address`, ABI `contract`, `eventName`, decoded `args` |

All numeric event arguments and log indexes are decimal strings. Addresses and hashes are hex. Booleans stay booleans. Token amounts retain the underlying contract's base units; BPS and WAD fields retain their ABI semantics. Events are in ascending chain order. On a fixed canonical branch, deduplicate by `(transactionHash,logIndex)` and retain the block hash for reorg checks. Conflicting duplicates stop a refresh.

For market/account filtering, compare emitting addresses and/or named arguments. `PolicyAllowed` is emitted independently by the controller and by the account. In an `AutoRepayExecuted` row the emitter identifies the account and the args identify the operator, amount and LTVs. Factory creation rows contain the owner's address and the child addresses needed to discover newly created markets and accounts.

Show **“Indexed through block …”** on snapshot results. Before merging a live scan, require the RPC block hash at `toBlock` to match `toBlockHash`. Request new pages starting at `toBlock + 1`, merge in block/log order and deduplicate by transaction hash and log index on the same canonical chain. If only a recent head interval fits the browser budget, display the exact gap between those ranges. If the boundary hash changes, suppress the merge and request a refreshed snapshot.

## Included records

The base manifest provides the market factory, Sentinel factory, policy registry, mock testnet oracle and development processor. Only the verified account factory may introduce account emitters. The market factory introduces controllers and collateral/debt books. A creation triggers a second scan of the same window, including constructor logs emitted before the factory's event. The public expansion manifest adds its v2 account factory, swap adapter, source oracle and processor after public deployment. A published optional vault profile adds its testnet vault, typed account factory and the vault accounts created by that factory. Seed contracts and child contracts are identified by their chain addresses. A signature from an unrelated contract cannot create a new source.

Coverage extends to emitted events in the generated ABIs for these sources. This includes lending-book settlement and share events, account permissions, allowed decisions, registered circuits, and adapter settlement. Wallet token transfers on unrelated contracts, unsigned proposals and failed simulations have their own data sources. Reverted transactions discard their EVM event logs. Surface a mined denial from its separately verified receipt and decoded error; keep off-chain keeper attempts in the keeper read API. An event count of zero only describes the displayed contract scope and indexed interval.

## RPC and explorer alternatives

On November 26, both official RPC domains and their documented `/terigon` routes rejected an `eth_getLogs` span of 101 block heights (102 inclusive) with RPC error `-32602`. A span of 100 heights (101 inclusive) succeeded at the same historical start. The indexer uses 100 inclusive blocks per page. [Official RPC endpoints](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/rpc-endpoints/rpc-endpoints) · [Public probe](../../evidence/session6-indexer/api-probe.json)

The official X Layer Data API documents address-based and height-range-based log queries. Both have a result cap of approximately 1,000 records and show signed API headers. An unauthenticated request using the testnet chain name returned HTTP 401 and code 50103. The documentation does not establish unlimited, gap-free retrieval on chain 1952. The OKLink public API guide examined describes contract verification and ABI lookup. We could not verify a credential-free complete event-history API for this testnet. No credentials are required by this indexer. [Logs by address](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/data/logs-by-address) · [Logs by block and address](https://web3.okx.com/it/onchainos/dev-docs/xlayer/developer/data/logs-by-block-and-address) · [OKLink API guide](https://www.oklink.com/docs/en/)

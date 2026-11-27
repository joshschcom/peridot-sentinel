# Public testnet activity snapshot

The Peridot Sentinel app ships previously verified, settled X Layer testnet events. Each row retains its emitter, transaction hash, log index, block hash, timestamp and decoded arguments. Mock prices, tokens and reference circuits retain their testnet labels. [Shared snapshot](../../packages/chain-config/activity/1952.json) · [Judge campaign snapshot](../../deployments/session7/1952/judge-01/activity.json)

## Refresh or recover

From the repository root with workspace dependencies installed, run the following command. It reads the committed snapshot and writes a separate candidate. Add `--judge=judge-01` and choose a separate filename to run the same workflow for the judge campaign.

```sh
node services/indexer/refresh.mjs --output=evidence/session9-activity/shared-preview.json
```

The output identifies the candidate file, event count, inclusive segments, gaps, terminal hash, observed head and confirmation depth. During a demo, preview every 15 minutes or when a recorded transaction has 12 L2 successor blocks. Each invocation starts from the canonical file. It atomically replaces the requested candidate only after the full run succeeds. Previews reject paths inside the committed chain-config and judge deployment trees. A real refresh requires a separate coordinator request: replace the output argument with `--publish` to update the canonical file. Keep the candidate and publish processes separate from a frontend release build. A deployed app picks up a new snapshot with its next build.

The scanner checks chain 1952, the recency of both public tips, their minimum height less 12 confirmations and the target block hash. Before continuing, it re-reads the saved terminal block and its logs. It also checks the most recent nonempty event height in the last segment. Both hosts must return the original event fields. An incremental scan uses pages of up to 100 inclusive blocks. Both endpoints must agree on each group’s decoded logs, discovered emitters, terminal hash and the connection to the previous group. A successful empty page reports no events for those emitters on those endpoints. Identical omissions by both providers at heights with no independent positive control can go undetected during an ordinary scan.

| Operator observation | Behaviour |
| --- | --- |
| Saved hash and logs are readable | Extend the final segment. The existing rows are compared with the candidate before publication. |
| A requested historical block or log index is explicitly pruned, or the same recorded rows are repeatedly missing at an unchanged hash | Preserve every old row and every previously verified segment. Try the most recent common confirmed height as a new one-block segment. The interval from the last verified end plus one through the new start minus one is recorded as `history-unavailable`. The gap conservatively covers all unverified heights, including heights another provider may still serve. |
| Fresh recovery anchor | Both hosts must agree on the exact block, transaction list, ordered decoded logs and source discovery. The scanner fetches each transaction receipt on each host, checks its block and transaction identity and independently derives the indexed events from those receipts. Missing receipts, a disagreement or a short log response stops recovery, even when both log queries return the same empty list. |
| Hash/row conflict, wrong chain, stale tip, malformed reply, timeout, rate limit, incompatible scope, failed recovery anchor or no room for a nonempty gap | Exit nonzero, leave the prior file intact, and print the failed check. Recheck with archive or explorer evidence. A transient failure alone cannot create a history gap. Network reads use bounded retries. |
| Recovered snapshot refreshed again | Preserve internal gaps and extend the latest verified segment when its checkpoint is readable. The tail gap for confirmation depth is recomputed. The scanner can start another segment after a later pruning incident. |

Each recovery stands on the trusted shipped checkpoint and new RPC observations. An initial scan with no existing snapshot must be complete from deployment. Compatible appended factory roots can replay an overlapping suffix of a single segment with both endpoints. Every old event must reappear unchanged before publication. An incompatible ABI change or overlapping scope replay across a historical hole requires separate archive review. Automatic refresh never retrospectively fills a permanent hole. A future backfill must verify both boundary hashes, all intervening pages, prior rows and emitter discovery before a coordinator publishes a reviewed replacement.

For a receipt-level recheck, obtain the archive endpoint separately, verify its chain ID and compare the receipt block hash, emitter and log index with the stored event. The public explorer's transaction page is also an independent check when it still has that record.

```sh
cast chain-id --rpc-url "$ARCHIVE_RPC_1952"
cast receipt --rpc-url "$ARCHIVE_RPC_1952" "$EVENT_TRANSACTION_HASH" --json
```

## Read contract

Schema version 1 and the original event fields remain valid. Heights are inclusive decimal strings. A legacy snapshot without `coverage.segments` describes one interval from `coverage.fromBlock` through `coverage.toBlock`.

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `kind`, `chainId` | 1, `indexed-event-snapshot` for shared or `judge-event-snapshot` for a named judge, 1952. The latter carries `campaign` and `profile`. |
| `updatedAt`, `scopeDigest` | UTC observation time and digest of the configured source scope. |
| `coverage.fromBlock`, `toBlock`, `toBlockHash`, `headAtRefresh`, `confirmations` | Original deployment bound, newest indexed height/hash, observed head and confirmation depth. When gaps exist, the outer bounds contain several verified intervals. The shared `status: caught-up` means that the selected confirmed target was reached. |
| **`coverage.segments[]`** | Each item contains `fromBlock`, `toBlock`, `toBlockHash`, `sourceCoverage`. A new independent anchor includes `fromBlockHash`. `configured` covers the declared scope. The shared factory index switches to `known-emitters` after a gap: an account or market created during that gap may remain undiscovered, even in a subsequent scanned range. The judge has a fixed, recorded emitter list. |
| **`coverage.gaps[]`** | Each item has `fromBlock`, `toBlock` and `reason`. New `history-unavailable` items represent permanent unverified internal intervals. The existing `confirmation-depth` and `awaiting-index` values describe trailing coverage. |
| `sources[]`, `events[]` | Emitter address, ABI name and start height; indexed event identity, arguments in original raw units and timestamp. Keep saved events with their original transaction and block identifiers. |

Display the verified intervals and every internal hole with its reason. Label the shared index’s known-emitter limitation after a gap. On a live page, connect a live scan to a shipped terminal only after validating its hash. If the live RPC cannot serve the terminal, keep the original events visible as previously verified history, label that terminal unavailable and show any independently scanned recent interval with its own range and gap. A different terminal hash is a canonical conflict: suppress the live merge, preserve the historical evidence and surface the conflict. An unreadable interval must never display as zero activity.

Reproduce the simulated pruning and fail-closed tests without public RPC calls. Optional `ACTIVITY_FIXTURE_DIR` exports explicit synthetic examples to a separate evidence directory.

```sh
ACTIVITY_FIXTURE_DIR=evidence/session9-activity node --test services/indexer/scan.test.mjs services/indexer/recovery.test.mjs
```

## Included records

The base manifest provides the market factory, Sentinel factory, policy registry, mock testnet oracle and development processor. Only the verified account factory may introduce account emitters. The market factory introduces controllers and collateral/debt books. A creation triggers a second scan of the same window, including constructor logs emitted before the factory's event. The public expansion manifest adds its v2 account factory, swap adapter, source oracle and processor after public deployment. A published optional vault profile adds its testnet vault, typed account factory and the vault accounts created by that factory. Seed contracts and child contracts are identified by their chain addresses. A signature from an unrelated contract cannot create a new source.

Coverage extends to emitted events in the generated ABIs for these sources. This includes lending-book settlement and share events, account permissions, allowed decisions, registered circuits, and adapter settlement. Wallet token transfers on unrelated contracts, unsigned proposals and failed simulations have their own data sources. Reverted transactions discard their EVM event logs. Surface a mined denial from its separately verified receipt and decoded error; keep off-chain keeper attempts in the keeper read API. An event count of zero only describes the displayed contract scope and indexed interval.

## RPC and explorer alternatives

On November 26, both official RPC domains and their documented `/terigon` routes rejected an `eth_getLogs` span of 101 block heights (102 inclusive) with RPC error `-32602`. A span of 100 heights (101 inclusive) succeeded at the same historical start. The indexer uses 100 inclusive blocks per page. [Official RPC endpoints](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/rpc-endpoints/rpc-endpoints) · [Public probe](../../evidence/session6-indexer/api-probe.json)

The official X Layer Data API documents address-based and height-range-based log queries. Both have a result cap of approximately 1,000 records and show signed API headers. An unauthenticated request using the testnet chain name returned HTTP 401 and code 50103. The documentation does not establish unlimited, gap-free retrieval on chain 1952. The OKLink public API guide examined describes contract verification and ABI lookup. We could not verify a credential-free complete event-history API for this testnet. No credentials are required by this indexer. [Logs by address](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/data/logs-by-address) · [Logs by block and address](https://web3.okx.com/it/onchainos/dev-docs/xlayer/developer/data/logs-by-block-and-address) · [OKLink API guide](https://www.oklink.com/docs/en/)

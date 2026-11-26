# Judge campaign activity

Run `node services/judge-activity/refresh.mjs testnet judge-01` from the repo root after setup and after each walkthrough. During a demo refresh every 15 minutes. For the private 1952 fork, replace `testnet` with `fork`. The result is `activity.json` next to the corresponding judge manifest. The shared M4 and M7 snapshot has its own refresh command. [Shared indexer](../indexer/README.md)

The snapshot covers successful events emitted by this campaign’s two controllers, four pToken books, two v1 accounts, v2 account and swap adapter. The campaign manifest links the factory creation, circuit registration, funding and other setup receipts. Deliberately reverted transactions produce zero event logs. Read their proof from the campaign’s separate receipt files. A keeper attempt that never reached the chain must come from its service journal.

Display the campaign, profile, inclusive block range and terminal hash. The 1952 public reader waits for 12 successor L2 blocks and reconciles decoded events on both official RPCs. A private automining fork uses its local tip. Refresh reads in 100-block pages, writes each verified group atomically and rechecks the checkpoint on resume. A changed branch or source set triggers rebuilding. An RPC disagreement or a lagging endpoint stops advancement.

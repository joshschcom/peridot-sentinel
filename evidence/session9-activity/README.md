# Simulated RPC pruning

These two version-1 snapshot fixtures contain **synthetic** heights, hashes, transactions, receipt logs and timestamps. The judge fixture uses the real campaign’s public emitter addresses to exercise the actual reader shape. Its synthetic records do not describe the judge’s public activity.

| Input and result | Shared scope | Judge scope |
| --- | --- | --- |
| Verified checkpoint | 100–101, event at 100 | 100–101, event at 100 |
| RPC error | Historical header 101 pruned | Historical header 101 pruned |
| Displayed unverified gap | 102–119 | 102–119 |
| New segment | 120, `known-emitters` | 120, `configured` |
| Confirmation-depth gap | 121–132 | 121–132 |

Two independent synthetic readers agreed on the confirmed anchor’s block, transaction list, receipts and decoded logs. The tests also check that a missing receipt, a disagreement, or a silently empty log result contradicting the anchor receipt preserves the previous file. Separate cases exercise a matching genuinely empty block, missing historical logs, an incompatible scope and a subsequent successful refresh.

Run `ACTIVITY_FIXTURE_DIR=evidence/session9-activity node --test services/indexer/scan.test.mjs services/indexer/recovery.test.mjs` from the repository root. Both tests and fixture generation use temporary snapshot inputs. [Shared fixture](pruned-shared.json) · [Judge fixture](pruned-judge.json) · [20 test results](test-results.txt) · [Runbook](../../services/indexer/README.md)

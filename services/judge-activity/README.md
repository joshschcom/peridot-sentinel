# Judge campaign activity

Preview a campaign from the repo root using the same command as the shared index. The existing manifest and campaign snapshot are read as inputs.

```sh
node services/indexer/refresh.mjs --judge=judge-01 --output=evidence/session9-activity/judge-preview.json
```

A requested real refresh uses `--publish` in place of the explicit candidate output. The direct entry point also accepts `node services/judge-activity/refresh.mjs testnet judge-01 --output=<candidate.json>`. Use `fork` in place of `testnet` for the designated private 1952 fork: the RPC must prove the upstream and local instance, and the fork uses its own tip and one local witness. Public verification uses two official RPCs and 12 successor L2 blocks.

Each run checks current runtime, account, factory, ownership and route bindings. The index covers successful events on the two controllers, four pToken books, two v1 accounts, v2 account and swap adapter listed in the campaign. Because this list is fixed, every verified campaign segment has `sourceCoverage: configured`. Deliberate reversions and keeper simulations are reported separately through their receipts and service journal.

Display the campaign, profile, every inclusive segment, terminal hash and gaps. Older rows remain previously verified evidence if the current provider loses its checkpoint. Recent confirmed blocks can continue only after the receipt-checked recovery anchor succeeds. See the [refresh and pruning runbook](../indexer/README.md) for error handling, candidate publication, fail-closed outcomes, archive rechecks and the exact additive schema.

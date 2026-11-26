# Peridot Sentinel expansion

Run from the repository root. Forge uses the checked-in expansion configuration and the pinned M4 artifacts. The operations below use mock tokens on the development profiles.

```sh
forge build --root contracts --offline
forge test --root contracts/expansion --offline --match-path 'test/*/*.t.sol'
node contracts/expansion/policy/compile.mjs --check
node contracts/expansion/script/abi-export.mjs
```

For the 1952 rehearsal, start a private Anvil fork on 19626 at a public block after the M4 deployment. Preserve chain ID 1952 because the registered ACCOUNT policy includes chain ID. Use an unused journal with a fresh fork. The recorded run used block 47241872.

```sh
anvil --host 127.0.0.1 --port 19626 --chain-id 1952 --fork-url https://testrpc.xlayer.tech --fork-block-number 47241872 --silent
node contracts/expansion/script/deploy-expansion.mjs fork
```

Public deployment uses `node contracts/expansion/script/deploy-expansion.mjs testnet` in the authorized deployer's shell with PERIDOT_TESTNET_KEY supplied privately. It verifies the M4 anchor, compiled source hashes and source checkpoint. Public and private-fork profiles use separate addresses and journals. The script saves a nonce and transaction hash before submission, polls canonical receipts, checks runtime code and compares balances and allowances. Rerunning on the same chain instance reconciles the journal. A crash after reservation but before an observable broadcast requires inspecting that hash and nonce. Coordinate the deployer with Claude before resolving an uncertain attempt. Never reset a public deployment journal to retry a write.

The inventory price fixture sets one simulated mWOKB to 80 mUSDC. Freshness expires after one day. The venue charges 5 bps and only settles against tokens in its inventory. Refresh both prices through the separate expansion oracle for subsequent demos. The public M4 oracle and v1 grant are independent.

The real Uniswap venue and native TapeOut CPU were exercised on a private fork of chain 196. The new Circuit binding has a separate reproducible benchmark. [Full fork swap](../../evidence/session5-swap/README.md) · [Benchmark](../../evidence/session5-execution/fork-benchmark.json) · [API contract](../../docs/coordination/INTERFACES_V2.md)

If a process is killed while holding the journal's .lock file, first confirm that the originating process is gone. Inspect the last reserved hash and nonce on the same chain and coordinate with Claude. Remove only that stale lock after this check, then run the same command. A reserved hash is always reconciled before the script can advance.

A resumed run refreshes an expired unsigned demo deadline and any stale mock quote before repeating the denial simulation. After the swap hash is reserved, the original calldata and deadline are immutable in the journal.

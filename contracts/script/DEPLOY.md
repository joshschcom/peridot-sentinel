# Development deployment

Run from the repository root with the workspace packages installed. This script deploys test tokens, a manual price feed, a development NAND interpreter, registry, adapter, market books and Sentinel factory. Every amount is test currency. The live sponsor processor and fork fabrication evidence are in `docs/TAPEOUT_INTEGRATION.md`.

```sh
npm run build --workspace @peridot/circuit-sdk
(cd contracts && forge build && forge build script/DemoRateModel.sol)
```

Use an **unforked local Anvil** on loopback. Start a fresh node in one terminal and leave it running.

```sh
anvil --chain-id 31337 --port 18545 --silent
```

In another terminal, run the deployment. The first unlocked account owns the registry and market. The script adds 200 mock dollars of debt liquidity, activates the market and verifies code at its addresses. The optional position funds a Sentinel account with 100 mock collateral tokens, borrows 80 mock dollars, and authorizes the second unlocked account to repay up to 20. The controlled price moves LTV from 4000 to 5000 bps, past the 4500 bps automation trigger. The final output provides the keeper environment.

```sh
node contracts/script/deploy-demo.mjs local --position --publish-manifest
node packages/chain-config/scripts/check-manifest.mjs packages/chain-config/deployments/31337.json http://127.0.0.1:18545
```

For **X Layer testnet**, fund the designated deployer with test OKB. Supply a reviewed Git commit for both the no-key preflight and the deployment. `--ops=price` seeds the market and Sentinel position, authorizes the designated testnet operator, and performs the labeled mock-price move.

```sh
deployment_commit=$(git rev-parse HEAD)
node contracts/script/deploy-demo.mjs testnet --source-commit="$deployment_commit" --preflight-only

DEMO_OPERATOR=0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88 \
PERIDOT_TESTNET_KEY="$(cat /Users/joshua/Peridot/OKX/.testnet-keys/deployer.key)" \
  node contracts/script/deploy-demo.mjs testnet --source-commit="$deployment_commit" --ops=price --publish-manifest
```

A public run checks the scripts, Solidity inputs, SDK sources and dependency manifests against that checkpoint. It builds the SDK in a fresh directory and reproduces the contract artifacts from the pinned tree before opening the signer. Every resumed invocation repeats the build check. Immediately before submission it rechecks the deployment input paths. Frontend and documentation work can proceed during deployment.

Add `--publish-manifest` to write a verified non-fork manifest to `packages/chain-config/deployments/` and records receipt hashes and build provenance under `deployments/local/` or `deployments/testnet/`. A null commit denotes a build awaiting a matching source checkpoint. To attest an existing deployment, rerun the same command with `--source-commit=<SHA>`. The script compares every transitive Solidity source hash and the policy fixture, then verifies creation and runtime bytes by rebuilding a Git archive of that commit using its own Foundry configuration. The manifest records the build-time Git state separately. The source digest is Keccak-256 of compact UTF-8 JSON encoding the lexicographically sorted Solidity source path/content-Keccak pairs from the artifacts. Evidence records a separate init-code hash per artifact.

Rerun the same invocation to resume. Keep the deployment journal under `.research/deployment-journals/` while the deployment exists. A local run binds to its Anvil instance. Testnet binds to the genesis block and deployer. The script checks prior receipts and confirms each stored transaction. For a mined failure, inspect the receipt and cause before explicitly retrying the named step with `--retry-failed=<step>`. The journal retains the failed receipt. A local node reset starts a new simulation.

## Sponsor processor integration on a nested fork

Start from the A1 replay in `evidence/a1/replay-fork.py`. Leave that Anvil node running on port 19621 after it fabricates the two circuits. Start a second local node from its post-fabrication block.

```sh
anvil --fork-url http://127.0.0.1:19621 --chain-id 31337 --port 19622 --silent
```

Run the product settlement against the second node.

```sh
node contracts/script/deploy-demo.mjs sponsor-fork
```

The script checks the X Layer source block hash, loopback fork parent, chain ID and both circuit netlists. It deploys market and account contracts with the A1 sponsor processor, seeds the debt book, and mines an 80 mock dollar Sentinel borrow. A transaction trace checks the account and market circuit IDs, input bytes and allow outputs. It also mines two expected policy denials, one on the account and one on the direct pToken. Fork evidence goes into `evidence/a5/`. Every address and receipt in that directory is scoped to the local fork run.

## Repeatable demo operations

Start a fresh development Anvil as above. A single command deploys the suite, registers a market policy through Studio, seeds and activates the first market, creates a Sentinel account, and opens its position. The command uses the operator and RPC described above. Locally, a separate unlocked user publishes the market template with its SDK proof. The registry decides the canonical circuit ID.

```sh
node contracts/script/deploy-demo.mjs local --ops=fresh
```

Run any of the following on the same node. Each command retrieves completed receipts from the journal and carries out its prerequisites. `--ops=all` runs the operations in order from a fresh node.

| Operation | Observable effect |
|---|---|
| `--ops=fresh` | Funds the account with 100 mock collateral tokens, supplies them, borrows 80 mock dollars and sets a repay-only grant for 20. |
| `--ops=price` | Changes the test oracle quote from 2 to 1.6 mock USD per collateral token. The initial position moves from 4000 to 5000 bps, crossing the 4500 bps keeper trigger. |
| `--ops=isolate` | Creates and activates another market with its own books and a second Sentinel account. It seeds 200 mock dollars, opens a 30-dollar borrow, and verifies zero shares and debt for each account on the other market. |
| `--ops=liquidate` | Prepares the second market, then computes a controlled feed price targeting 9200 bps on the first account. A separate local liquidator pays a quarter of the observed debt and receives collateral shares. On testnet the deployment EOA pays from its own mock funds. |
| `--ops=all` | Runs fresh setup, the keeper-trigger price movement, the second market, and liquidation. Each market sees the same test feed. Both positions are measured immediately before and after liquidation, including the second market's debt, cash, supply and collateral. |

Every operation writes a per-run manifest and receipt evidence under `evidence/session2-ops/<mode>-<run>/`. Saved snapshots use the receipt's block. Repeating a completed command rechecks its historical result. The price and liquidation commands deliberately change demo conditions and should run on a separate rehearsal node when a frontend demo is in progress. To point Fable at a new local deployment, supply the matching source commit and explicitly publish after coordinating the switch.

```sh
LOCAL_ANVIL_RPC=http://127.0.0.1:18546 node contracts/script/deploy-demo.mjs local --ops=all
```

The same operations support `testnet` with the isolated funded account and a separate `DEMO_OPERATOR`, or `sponsor-fork` with the two fork-fabricated circuits. Set `LOCAL_ANVIL_RPC` to the nested fork's loopback endpoint for the latter. Demo feeds age after one day and the example operator grant expires after one day. For a new live demonstration start a fresh run or renew prices and authorization through the owner entry points.

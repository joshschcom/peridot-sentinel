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
node contracts/script/deploy-demo.mjs local --position
node packages/chain-config/scripts/check-manifest.mjs packages/chain-config/deployments/31337.json http://127.0.0.1:18545
```

For **X Layer testnet**, fund the designated address with test OKB. The testnet target pins the public RPC, checks chain 1952, verifies the designated signer, and deploys the same explicitly labeled development processor. The optional position requires a separate funded testnet operator public address in `DEMO_OPERATOR`.

```sh
PERIDOT_TESTNET_KEY="$(cat /Users/joshua/Peridot/OKX/.testnet-keys/deployer.key)" node contracts/script/deploy-demo.mjs testnet
```

Successful deployment writes a verified chain manifest to `packages/chain-config/deployments/` and records receipt hashes and build provenance under `deployments/local/` or `deployments/testnet/`. A null commit denotes a build awaiting a matching source checkpoint. To attest an existing deployment, rerun the same command with `--source-commit=<SHA>`. The script compares every transitive Solidity source hash and the policy fixture, then verifies creation and runtime bytes by rebuilding a Git archive of that commit using its own Foundry configuration. The manifest records the build-time Git state separately. The source digest is Keccak-256 of compact UTF-8 JSON encoding the lexicographically sorted Solidity source path/content-Keccak pairs from the artifacts. Evidence records a separate init-code hash per artifact.

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

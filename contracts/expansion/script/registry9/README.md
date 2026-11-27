# Private strategy registry rehearsal

Run from the repository root. The November 27 rehearsal used Node 26.4, Foundry 1.7.1 and solc 0.8.26. The rehearsal starts a plain Anvil on port 19831 and a private 1952 fork on 19832. It verifies the fork block on both X Layer testnet endpoints before launching. Both nodes stop after the run. The identities are deterministically generated for the private nodes. The launcher takes no signer configuration.

```sh
forge build --root contracts/expansion --offline src/registry9/StrategyRegistry.sol
node contracts/expansion/script/registry9/rehearse.mjs --out-dir evidence/session9-registry/review-01
```

Choose a fresh output directory for each run. To replay the November 27 origin while the RPCs retain its state, use the recorded pin.

```sh
node contracts/expansion/script/registry9/rehearse.mjs --out-dir evidence/session9-registry/replay-01 \
  --fork-block 47313472 --fork-hash 0xb4fa171115bd0e2ec0ae534ba1e4e339ba8ba9a41cb642a6e08aae8e5a16c7bd
```

The runner compares the checked-in ABI to the Foundry artifact and both deployed runtimes to the compiled runtime. An intentional contract change can regenerate the public ABI with `node contracts/expansion/script/registry9/rehearse.mjs --export-abi`. The compiler’s creation bytecode is available in `contracts/expansion/out/StrategyRegistry.sol/StrategyRegistry.json` under `bytecode.object`. There are no constructor arguments. The source and expected creation/runtime hashes are available for Claude’s independent public-deployment review. A public deployment also needs its own chain, address, runtime hash and confirmed deployment block in the frontend pin.

## Receipts and authority checks

The runner publishes both actual testnet templates with the unsigned SDK builder. Each is read back by publication key and by the three indexed filters. On the testnet fork a distinct prospective owner first receives a missing-account error from the existing adoption planner. They create their accounts at the two public testnet factories as reproduced on the fork, review the real calls, set the bounded grants and explicitly revoke each. Readbacks include the selected operator and the publisher before adoption and after revocation.

A completed run produces `local-31337.json`, `fork-1952.json`, the two-host origin in `origin.json` and one journal line per confirmed transaction in `receipts.ndjson`. A stopped run can leave a partial journal. The fork uses a one-successor-block SDK confirmation depth and independently verifies each mined receipt’s block hash. The SDK default for public clients is twelve successor blocks. Public fees depend on the actual gas price at deployment or publication. [November 27 local evidence](../../../../evidence/session9-registry/nov27/local-31337.json) · [Private-fork evidence and fees](../../../../evidence/session9-registry/nov27/fork-1952.json)

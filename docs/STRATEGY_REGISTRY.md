# Peridot Sentinel strategy publication

**Public X Layer testnet.** Claude deployed the registry at `0xB1BE0326E007e2719CdBBd61D8E26356d39F28ed` in block 47,314,090. The testnet deployer published version 1 of both curated strategies. Both public RPCs returned identical verified content. Discover from the deployment block in pages of up to 100 confirmed blocks. Fable owns browser integration. [Reviewed public pin](../packages/chain-config/deployments/strategy-registry-1952.json) · [Publications and read-only owner reviews](../evidence/session10-registry/discovery.json)

## Publication and retrieval

The publication key is the transaction sender, a creator-selected nonzero `bytes32 seriesId` and a sequential version starting at one. Each publish supplies the expected next version. A concurrent publish for that same version reverts. Other creators have separate namespaces. Versions and their content are immutable.

The creator includes the full canonical UTF-8 JSON in calldata. The registry retains those bytes in storage so a reader who knows the publication key can retrieve the content with an ordinary current-state call, even if an indexer loses old logs. `StrategyPublished` identifies the creator, series, version and content hash. Its three indexed topics support filtering by the template’s target chain, adapter version and policy identity. Discovery through historical logs remains subject to the RPC’s retention.

The adapter topic is Keccak-256 of the UTF-8 `deployment.adapter` string, including its version suffix. The policy topic is Keccak-256 of Solidity ABI encoding `(address enforcer, address processor, uint256 circuitId, bytes32 netlistHash)`. The target chain is 1952 for both supported strategy profiles. The standalone registry can be rehearsed on chain 31337. That rehearsal still describes 1952 strategies.

The contract computes Keccak-256 over the supplied bytes, limits payloads to 8,192 bytes and accepts only zero-value publications. A publisher can submit invalid JSON or misleading index labels. Before offering adoption, the SDK verifies the deployed registry identity, retrieves the immutable record, checks the byte hash, uses the existing `importStrategy` validator, requires byte-for-byte canonical encoding and recomputes all three topics. Text instructions remain untrusted display data. The selected adopter’s wallet and operator enter only the existing owner-transaction planner. Publication gives the creator no access to adopter funds or grants.

## Acceptance gates

| Gate | Evidence required |
| --- | --- |
| Contract | Nonpayable append-only entry point, separate creator namespaces, stale version rejection, bounds and fuzz tests for hash and immutability. |
| SDK | Registered bytes, hash, validator and index fields match. Reject mismatches before showing an adoptable template. Existing validator and schema stay unchanged. |
| Private deployments | Reproducible plain Anvil deployment and a separate private fork of 1952. Publish, filter, read, verify and inspect the adopter's own transactions. Record exact bytes, transaction gas and scope. |
| Public rollout | Claude reviews the ABI, pinned bytecode, results and cost; founder/Claude schedule public deployment. Fable controls the public discovery switch. |

## Review and limits

A public post is permanent. The creator pays network gas for the full payload and storage. The registry charges no fee. Creators should publish only material intended for indefinite public disclosure. Two people can use the same strategy name, series ID or content. Show the creator address and version alongside the title. A valid hash establishes which bytes that address published. It says nothing about the merits of the strategy. The UI should render instructions as inert text and require the adopter to review the operation, asset, amount, expiry and account in the existing wallet flow.

The contract has three callable functions. `publish` takes the series, expected version, target chain, two index labels and bytes. `latestVersion` returns the last accepted sequence number, and `readVersion` returns the complete immutable record. The contract has no upgrade or administration interface. The compiled runtime is 1,708 bytes, Keccak-256 `0xc8f42e779cd1e1c1b7436a8f75ad9acf7da98f8fb947a8dd6b90f79f612f29b1`. Clients need an independently reviewed address, chain and runtime hash. The address or pin must never come from an imported strategy. [Publication contract](../contracts/expansion/src/registry9/StrategyRegistry.sol) · [Immutability and other targeted tests](../contracts/expansion/test/registry9/StrategyRegistry.t.sol)

## November 27 acceptance and handoff

**Session 9 private rehearsal.** The registry was at `0xA11012A2ca9AdeeA836560A267A183966a4092c1` on the two disposable nodes. Both used the same fixture creator and creation nonce. The fork originated at block **47,313,472**. Two independent testnet RPCs agreed on origin hash `0xb4fa171115bd0e2ec0ae534ba1e4e339ba8ba9a41cb642a6e08aae8e5a16c7bd` and returned empty public code at that address at the origin. [Local proof](../evidence/session9-registry/nov27/local-31337.json) · [1952 FORK receipts and adoption](../evidence/session9-registry/nov27/fork-1952.json)

| Action on the private 1952 fork | Canonical JSON bytes | Transaction data bytes | Gas used | Execution fee in simulated test OKB |
| --- | ---: | ---: | ---: | ---: |
| Deploy registry | — | 1,781 | 422,748 | 0.000430146937609740 |
| Publish debt protection | 1,260 | 1,508 | 1,047,288 | 0.001061329703419128 |
| Publish restricted swap | 1,368 | 1,604 | 1,115,561 | 0.001127028837674924 |

These are mined Anvil measurements at the recorded fork gas price. Requote on the public target when reviewing deploy or publish transactions. The local run recorded three successful receipts. The private 1952 fork recorded ten. The independent adopter first had zero accounts. Each template required that wallet to create its own account, inspect the grant and authorize the owner transactions. The fork verified the exact active budget and expiry, then confirmed the operator's grant returned to zero after revocation. The creator's grant remained zero on both accounts. [Fork creation, publication, grant and revocation receipts](../evidence/session9-registry/nov27/receipts.ndjson)

### Consumer API

Import from `@peridot/strategy-sdk/registry`. Supply a trusted `RegistryPin` containing the reviewed RPC chain ID, deployment address, runtime code hash and deployment block. Confirmations default to 12 successor blocks. A registry record cannot supply or override this pin.

| SDK call | Result |
| --- | --- |
| `buildStrategyPublication(client, pin, {creator, seriesId, expectedVersion, json})` | Validates, canonicalizes and returns an unsigned zero-value publish transaction, hash and topics. A competing version requires rebuilding the preview. |
| `discoverPublishedStrategies(client, pin, {fromBlock, toBlock, targetChainId?, adapterVersion?, policyKey?})` | Checks one inclusive page of up to 100 confirmed blocks. Returns separate accepted and rejected publications. Failed RPC reads reject the page. Scope any discovery claim to that page and the provider's available history. |
| `readPublishedStrategy(client, pin, {creator, seriesId, version})` | Retrieves the stored bytes at a confirmed block and verifies runtime, content and labels. A known key works through a current-state read even when old logs are unavailable. |
| `verifyStrategyPublication(record)` | Checks offline bytes, hash, canonical form, validator and labels. Establish on-chain provenance with one of the chain reads above. |
| `buildAdoptionPlan(client, verified.template, {owner, operator})` from `@peridot/strategy-sdk` | Gives the adopter a separate owner-transaction review for their own account. Use the same package’s `buildRevocationPlan` to remove the grant. |

The full ABI is generated from solc. The compilation used a 1,781-byte creation payload with Keccak-256 `0x575fbf57464d1467af5f5bc96ec3eb5389d8ee30d777fff2e128f3f6659d8775`. After Claude's separately reviewed public creation, bind the public pin to the actual receipt, confirmed block and byte-for-byte runtime before enabling discover or publish in the UI. [Generated ABI](../packages/chain-config/expansion/abi/StrategyRegistry.json) · [SDK implementation](../packages/strategy-sdk/registry.ts)

Run from the repository root. Use a fresh evidence directory for each rehearsal.

```sh
forge test --root contracts/expansion --offline --match-path 'test/registry9/*.t.sol' -v
npm --prefix packages/strategy-sdk run check
node contracts/expansion/script/registry9/rehearse.mjs --out-dir "evidence/session9-registry/run-$(date -u +%Y%m%dT%H%M%SZ)"
```

Eight contract tests passed, including 256 cases on each of the hash and immutability fuzz targets. Strict TypeScript and all 18 SDK tests passed, including generated-ABI parity, rejected hash mismatches, noncanonical data and invalid strategy profiles. The accepted validator, schema, templates and owner planner match the pre-session source. The registry remains independently deployable alongside the existing testnet contracts.

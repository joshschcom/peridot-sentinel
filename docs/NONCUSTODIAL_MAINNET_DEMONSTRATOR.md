# Proposal for a read-only Peridot Sentinel circuit witness on X Layer

**Founder authorization required.** The proposed mainnet action is one zero-value contract creation on chain 196 after the three founder-published circuits are verified. The witness has no payable entry point, owner, approval, withdrawal, upgrade or token-operation method. A caller can ask it to evaluate one three-byte illustrative context. Financial settlement and the account v2 deployment remain confined to a private fork and the existing public testnet profile. [Witness source](../contracts/expansion/src/native7/NativeCircuitWitness.sol)

## Identity and inputs

The witness fixes CPU 410 at `0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5`. Its constructor checks factory membership and three IDs against the exact canonical netlists and dimensions. Every evaluation checks the CPU runtime, beacon runtime, beacon-reported implementation and implementation runtime. The CPU receives a bounded static call and must return one canonical ABI-encoded result byte. A valid negative decision returns false. A failed call or invalid response reverts.

| Kind | Schema | Inputs / outputs / state / NAND gates | Expected netlist keccak256 |
|---|---|---|---|
| 0 MARKET | lending-v1 | 20 / 1 / 0 / 63 | `0xe845d0cb6d0e0c86faca013143995f6a0c9d6a1dbb0772a6176fe0ee977e6c09` |
| 1 ACCOUNT | lending-v1 | 20 / 1 / 0 / 87 | `0x7dbd1ad5e86acbf5796e7ed7aacbcb724ae35b69ee5742c8efae1744d20a6818` |
| 2 EXECUTION | sentinel-execution-swap-v1 | 20 / 1 / 0 / 59 | `0x898674f49c1caa2e3196f31ce7afe18fa839d6260d5f75ebc4cd2248d266b30b` |

## Rehearsal and exact unsigned transaction

Run from the repo root with Foundry 1.7.1, solc 0.8.26 and the pinned npm workspace dependencies. Each command starts its own loopback Anvil on port 19710, verifies the upstream block hash, uses only unlocked fork accounts and closes the node on exit. The sole runtime input that changes after publication is the verified publication config. [Input config](../packages/chain-config/expansion/tapeout-196.json) · [Harness](../contracts/expansion/script/native7/run.mjs)

```sh
node contracts/expansion/script/native7/run.mjs --rehearse
node --test contracts/expansion/test/native7/run.test.mjs
```

The rehearsal starts from the D8(b) reference block and fabricates all three programs on the genuine processor in the disposable 196 fork. Its local circuit IDs and addresses apply to that rehearsal only. The witness contract was compiled with Solidity 0.8.26, via IR, 200 optimizer runs and the Paris EVM target. [Complete unsigned illustration, fork receipts and gas](../evidence/session7-native/rehearsal-fork.json)

After the founder's separately authorized D8(b) publication, Claude runs the existing postpublication verifier with the public receipt hashes, then runs the native harness in published mode.

```sh
node docs/coordination/D8b-postpublish.mjs "$MINT_TX" "$MARKET_TX" "$ACCOUNT_TX" "$EXECUTION_TX"
node contracts/expansion/script/native7/run.mjs --published
```

The second command uses the configuration's verified block and hash. It reads the finalized fabrication transactions, derives their IDs from the real CPU's events, verifies the sender's target, input and value against the previously approved D8(b) packet, and checks each ID again on the fork. Publication mode stops if IDs or final proofs are missing. Its result is `evidence/session7-native/published-ids-fork.json`. Its `witnessProposal.transaction` binds the reviewed initcode and public IDs. Immediately before a separate spending decision, reprice that exact creation on the live chain using read-only RPC. The command accepts the intended sender's **public address** and defaults to the publication sender. It verifies code, timestamps and the current base fee, estimates creation gas, and prints a new unsigned envelope, its upper cost and the available sender balance.

```sh
node contracts/expansion/script/native7/quote.mjs "$PUBLIC_SENDER_ADDRESS"
```

| Envelope field | Required value |
|---|---|
| Network / type | 196 / EIP-1559 creation |
| Destination and value | Omit `to` for CREATE; zero wei |
| Data | Complete `witnessProposal.transaction.data`, containing initcode followed by the three verified uint256 IDs. Its keccak256 is recorded in `creationDataHash`. |
| Sender / nonce | Ordinary founder-controlled funded EOA and its next unused nonce at signing. The constructor grants no privileges to the sender. The created address is determined by this EOA and nonce. |
| Gas and fees | Exact gas limit, priority fee and maximum fee per gas are in the envelope. Refresh the prevailing base fee, L1 fee upper bound, operator fee and available balance immediately prior to authorization. |
| Further calls | Three example ABI-encoded `evaluate(uint8,bytes3)` queries are included in `verificationCalls`. Send them as free `eth_call` reads to `receipt.contractAddress`. No additional signature is required. |

At the rehearsal block **76,931,874**, creating the witness with fork IDs 2, 3 and 4 consumed **477,432 gas**. The proposed gas limit is **626,790**, with a fee cap of 50,000,000 wei per gas and a 1 wei priority fee. Both the observed L1 upper bound and the operator fee were zero at that block. The full illustrative cap was **0.0000313395 OKB** for the creation, including zero call value. The rehearsal initcode including arguments has keccak256 `0x5eb78b03e30a2efa99a643ce5752f485e801c5a937d72aae35686d4b4d2c2d53`. These IDs and bytes are illustrative until public publication. The creation data, fee-oracle reads and all three sample read calls are retained together. [Unsigned rehearsal envelope](../evidence/session7-native/rehearsal-fork.json)

The D22 **0.004647 OKB** ceiling belongs to the four D8(b) circuit publication calls. The witness creation needs a separate budget and founder approval. Constructor bytecode, proposed IDs, funding and prevailing fees must be reviewed immediately before signing. A failed creation still spends gas. The receipt address and runtime must be checked against the compiled artifact and its immutable values before publishing a link.

## Meaning and risks

A witness response describes the packed inputs supplied by its caller. It carries no attestation that a portfolio, price or account actually had those values. The separate fork harness proves financial enforcement through the typed account, isolated lending books and swap adapter using contract-derived contexts. Each risk-increasing call checks the frozen native bindings. Repayment remains available during a processor outage. The developer reference interpreter is an untrusted, independent parity control and has no financial route in that fork. [Financial guard](../contracts/expansion/src/native7/NativeFinancialPolicy.sol)

The sponsor factory remains unsealed. The observed CPU beacon has zero owner. Recheck factory membership, the ERC-1967 CPU beacon slot, implementation fingerprints and netlists before adoption. Construction or evaluation may fail if a dependency changes, a gas limit becomes insufficient, or RPC observations are stale. A response produced by otherwise trusted unchanged code still depends on the effective program and underlying chain state. Anyone can transfer ERC-20s or force native currency to a contract outside its ABI; the witness cannot recover unsolicited assets. No funded release or mainnet financial deployment is proposed. [Sponsor bindings and trust evidence](TAPEOUT_INTEGRATION.md)

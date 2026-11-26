# D8(b) founder checks

The four unsigned 196 envelopes reproduce the session 5 CPU 410 fork rehearsal. The proposed sender is an ordinary EOA with enough native OKB to cover all four calls. A newly minted batch of 209 NANDs supplies the three programs on the existing CPU. No BEM acquisition or approvals appear in this packet. [Reviewed bytes and rehearsal](../session5-d8b/proposal-and-fork.json)

## Before signing

Run from the repository root. A sender's **public address** is optional. Including it checks code and native balance at the same block. Run immediately before reviewing the four calls in the signing wallet.

```sh
docs/coordination/D8b-presign-check.sh
docs/coordination/D8b-presign-check.sh "$PUBLIC_SENDER_ADDRESS"
node --test evidence/session6-d8b/checks.test.mjs
```

At public block 76,938,913 the reviewed destinations, selectors, bytes, NAND supply, implementation fingerprints and live fee checks passed. The maximum was **0.004647 OKB**, including 0.00456 OKB of contract payments and up to 0.000087 OKB of execution gas. The observed L1 and operator upper bounds were zero at that block. The script stops if those bounds push the total above the ceiling. Each fabrication is a separate transaction. A changed quote, missing receipt or failed transaction requires reconciliation of existing receipts and remaining NAND before any further signing. [Block-pinned pre-sign results](./presign-196.json)

## After publication

The no-argument form checks the three live **development reference** circuits on chain 1952 and prints the result. It leaves the public configuration untouched. At block 47,249,225 the MARKET, ACCOUNT and EXECUTION programs passed 6, 6 and 11 boundary vectors respectively. [Development parity capture](./prepublication-dev-parity.json)

```sh
node docs/coordination/D8b-postpublish.mjs
node docs/coordination/D8b-postpublish.mjs "$MINT_TX" "$MARKET_TX" "$ACCOUNT_TX" "$EXECUTION_TX"
```

The three fabrication receipt hashes are required for publication. Supplying the optional mint hash also validates the mint transaction and its order. The tool verifies the exact reviewed transaction fields, a common sender, receipt order, block hashes, successful execution and finality on chain 196. The emitting CPU, author, gate count and state bits authenticate each newly emitted ID. Input and output counts come from `circuitInfo`. The gross receipt gas and per-vector `eth_estimateGas` for a direct eval call are measured separately.

All three deployed mainnet netlist hashes and 23 eval outputs must agree with their fixtures and the live 1952 reference. A successful run writes immutable public evidence into `evidence/session6-d8b/published-196.json` and pins the circuit IDs and receipt hashes in `packages/chain-config/expansion/tapeout-196.json`. Claude reviews and checkpoints those files for Fable. The founder retains exclusive control of publication and signing.

The frozen session 5 evidence named the last two fields of the `TapedOut` event `nIn` and `nOut`. Their types and event selector are correct. The emitted values are gate count and state-bit count, including (63,0), (87,0) and (59,0) in the saved fork receipts. The regression test decodes those authentic rehearsal logs using the corrected field semantics. [Pinned Cerebr interface](https://github.com/NetLayerLabs/Cerebr/blob/47f5744dc2a76fabaa3fb8372b0d1dd265123ef3/src/scope/ITapeOut.sol)

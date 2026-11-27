# D16 · Three public policy circuits for Peridot Sentinel

**Founder decision for November 28, 2026.** Approve four native-OKB calls from one designated mainnet EOA to publish Market Policy V1, Sentinel Policy V1 and Expanded Sentinel Policy V2 on TapeReel, existing TapeOut CPU 410. At the November 26 pin the estimated all-in cost was **0.004586151721307586 OKB ($0.3771)**. The proposed ceiling for all four calls is **0.004647 OKB** ($0.3821 at that pin), conditional on the observed fee schedule. The signer receives the three circuit NFTs. This proposal is unsigned. The three public circuit IDs are pending. [Full unsigned envelopes and fork receipts](../../evidence/session5-d8b/proposal-and-fork.json)

**Public pin.** X Layer 196, block **76,931,874**, November 26, 2026 at **13:48:30 UTC**, hash `0x69209f9c7d765066eef82ee9bb53ba50eaea6d29ee33ff521908d2c81f0da16b`, RPC `https://rpc.xlayer.tech`. Factory `0x1f09DAeFA827f02CBb40967cc91b259763760761` returned `cpuAt(410) = 0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5` and `isCPU = true`. The CPU identifies the NAND component contract as `0x3896076BE165d6a7eC2a70CCF6876673fE245007`. [Public CPU creation receipt](https://www.okx.com/web3/explorer/xlayer/tx/0x49f3a5997dc717ca398af2ec23681c18d0644723970d1bc80b27078b435c2f9e)

## What the founder would sign

| Order | Destination and function | Value (OKB) | Fork gas used | Gas limit | Fork NAND after |
|---|---|---:|---:|---:|---:|
| 1 | Component contract · `mint(0,209)` | 0.00066 | 83,599 | 120,000 | 209 |
| 2 | CPU 410 · `tapeout(marketNetlist,20,1)` | 0.00130 | 402,065 | 520,000 | 146 |
| 3 | CPU 410 · `tapeout(sentinelNetlist,20,1)` | 0.00130 | 453,116 | 580,000 | 59 |
| 4 | CPU 410 · `tapeout(executionNetlist,20,1)` | 0.00130 | 368,806 | 520,000 | 0 |

The four `proposedMainnetCalls` objects contain the full EIP-1559 calldata, exact target, native value, empty access list and gas limits. They specify chain 196, a max fee of 50,000,000 wei/gas, and a priority fee of 1 wei/gas. Sender and nonce are chosen at signing. A single founder-controlled mainnet EOA supplies the OKB, mints all 209 NANDs and fabricates each program. The eight-decimal BEM token balance and both BEM allowances were zero before and after the successful rehearsal. This route requires **zero BEM**. There are no token approvals, CPU creation, financial contracts, project accounts, collateral or swaps among the four calls. [Reviewable envelopes](../../evidence/session5-d8b/proposal-and-fork.json)

The component cap was 10,000 with 163 minted, leaving 9,837. NAND was ID 0 and its unit price was zero. The component contract charged the batch fee once. All three programs were stateless, with 20 inputs and one output. Each fork receipt emitted one matching `TapedOut(uint256 indexed id,address indexed owner,uint32 gateCount,uint32 nState)` event. The last two event words are gate count and state count. Input/output dimensions come from circuitInfo. The CPU returned the exact compiled bytes and expected NFT owner. The four fork hashes and block hashes are in `forkRehearsal`. Only the fork received circuit IDs 2, 3 and 4. [Exact lending programs](../../packages/circuit-sdk/fixtures/policies-v1.json) · [Exact execution program](../../contracts/expansion/policy/execution.json)

| Publication | NANDs | Netlist Keccak-256 | Rehearsed boundary |
|---|---:|---|---|
| Market Policy V1 | 63 | `0xe845d0cb6d0e0c86faca013143995f6a0c9d6a1dbb0772a6176fe0ee977e6c09` | Borrow at 6,500 bps allowed, 6,501 denied |
| Sentinel Policy V1 | 87 | `0x7dbd1ad5e86acbf5796e7ed7aacbcb724ae35b69ee5742c8efae1744d20a6818` | Borrow at 5,500 bps allowed, 5,501 denied |
| Expanded Sentinel Policy V2 (EXECUTION) | 59 | `0x898674f49c1caa2e3196f31ce7afe18fa839d6260d5f75ebc4cd2248d266b30b` | Exact-input swap loss at 100 bps allowed, 101 denied |

## Fee basis and approval conditions

The four fork transactions consumed 1,307,586 gas. The public base fee was 20,000,000 wei/gas. The RPC observed at head 76,932,028 quoted 20,000,001 wei/gas with a 1-wei priority fee. Multiplying measured gas by that quote gives 0.000026151721307586 OKB. The 1,740,000 gas-limit sum multiplied by the max fee gives **0.000087 OKB**. The native protocol values sum to **0.00456 OKB**. The X Layer GasPriceOracle at `0x420000000000000000000000000000000000000F` returned zero for `getL1FeeUpperBound` at conservative sizes 268, 780, 972 and 748 bytes (calldata plus 200 bytes for this envelope). It also returned zero for `getOperatorFee` at each proposed gas limit. L1 base- and blob-fee scalars were zero at the pin. [Pinned prices, oracle queries and arithmetic](../../evidence/session5-d8b/proposal-and-fork.json) · [X Layer predeploys](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts)

The indicative USD figures use the onchain Chainlink OKB/USD price of **$82.22217838**, round 18446744073709580341. The eight-decimal feed at `0x4Ff345b18a2bF894F8627F41501FBf30d5C5e7BE` updated at 12:39:12 UTC, 4,158 seconds before the pin. OKB is the payment currency. [Recorded round data](../../evidence/session5-d8b/proposal-and-fork.json) · [Chainlink X Layer feed directory](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-xlayer-1.json)

Before approving spend, recheck sender, chain, membership, target code and implementation hashes, component capacity and quote. The factory is unsealed and owned by `0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138`, with active implementation `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a`. The CPU's beacon `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` reported a zero owner and implementation `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2`. Refresh the L1 and operator bounds and verify each combined remaining charge fits the approved native ceiling. EIP-1559 caps execution fees only. Changed bindings or a higher total require a revised approval. [Observed code hashes and storage slots](../../evidence/session5-d8b/proposal-and-fork.json)

Confirm each receipt and reconcile NANDs before the next call. The four transactions settle independently. A partial publication can leave paid fees, NFTs and unused NANDs. Record actual public IDs from each receipt, since unrelated users can fabricate between calls. A smart-contract wallet requires its own receiver and gas rehearsal. Existing Sentinel accounts keep their authorized circuits. Publication has no effect on their permissions or balances.

## Fable handoff and wallet-free mainnet demonstrator

Use the `readOnlyAbi` array in the evidence. The CPU exposes `circuitInfo(uint256)`, `netlist(uint256)`, `ownerOf(uint256)` and `eval(uint256,bytes) returns (bytes)`. The eval selector is `0x934d06ea`. Display chain, block/hash, processor address, receipt-derived circuit ID, input bytes, returned bytes and the matching policy hash. Bind all metadata and eval calls in one displayed result to a single public block. Read-only evaluation needs neither a wallet nor a funded account. Inputs chosen by the viewer represent a scenario. The returned decision is a native onchain computation and carries no fund movement or account authorization. [Machine-readable ABI, 23 vectors and sample fork calldata](../../evidence/session5-d8b/proposal-and-fork.json)

- **Available today.** The third-party TapeReel circuit #1 on public 196 has 5 inputs, 42 outputs and 163 NANDs. At the pin, `0x00` returned `0x942560200000`, and `0x01` returned `0x4b0a60200000`. The saved example includes complete public calldata. Label this existing circuit and its raw output as a processor connectivity demonstration. [Verified public reads](../../evidence/session5-d8b/public-read.json)
- **After the founder publishes.** Supply the three public fabrication hashes to the read-only verifier below. It verifies finalized receipts and their blocks, the common publisher, CPU, calldata, events, dimensions, compiled hashes and the 23 raw eval outputs. Its JSON provides the three public IDs for Fable. Until then, all three public IDs are null. [Public receipt verifier](D8b-postpublish.mjs)
- **No-funds interaction.** Let a viewer move the LTV or permitted swap loss across the published threshold. MARKET input `0x922c0b` and `0xb22c0b`, ACCOUNT `0x92af0a` and `0xb2af0a`, and EXECUTION `0xf56400` and `0xf56500` respectively returned `0x01` and `0x00` on the fork. Construct fresh ABI calldata from the **verified public ID**. Require the decoded one-byte output to be exactly `0x00` or `0x01` for these programs. Display RPC failures separately. Link the fabrication receipt for publication provenance. The subsequent `eth_call` can be reproduced at its block and carries no transaction hash. [V1 wire layout](INTERFACES.md) · [V2 wire layout](INTERFACES_V2.md)

## November 28 signing and verification

On November 27 at **09:19:48 UTC**, the read-only check passed at mainnet block **77,002,152**, hash `0x401a3e9c4fc7756c2fc2c92d0cb55f57d71bd22d7c1c90be9977337cf2005465`. It verified all four packet envelopes, exact netlist hashes, factory membership, upgrade authorities, code hashes and fee inputs. NAND supply available was **9,837**. The current maximum was **0.004647 OKB**. This observation omits the signer’s balance because the founder had not provided a public sender address. Repeat it with the intended address immediately before the founder’s separate signing decision. Run from the repo root. [November 27 read-only check](../../evidence/session9-native/presign-196.json)

```sh
sh docs/coordination/D8b-presign-check.sh "$PUBLIC_SENDER_ADDRESS"
```

**After the founder signs and all four receipts finalize**, set the four transaction-hash variables from the founder’s wallet. Run this sequence from the repo root. It reads the public transactions and testnet development circuits, then sends financial test transactions only on a disposable local fork. The optional quote prints unsigned data for independent founder review.

```sh
node docs/coordination/D8b-postpublish.mjs --published "$MINT_TX" "$MARKET_TX" "$ACCOUNT_TX" "$EXECUTION_TX" &&
node contracts/expansion/script/native7/run.mjs --published --out evidence/session9-native/public-financial-fork.json &&
node contracts/expansion/script/native7/quote.mjs --proof evidence/session9-native/public-financial-fork.json
```

The first command requires both public RPCs to agree on the canonical finalized publication receipts and events. It checks the packet's exact target, data, type, fee fields, value, publisher, NFT owner at the pin, dimensions, netlist, and all 23 native and testnet reference outputs before updating the [public configuration](../../packages/chain-config/expansion/tapeout-196.json). Public mode supports an explicit alternate `--out evidence/session9-…/config.json` for a staged verification. The default public destination requires `--published`. If finality or either witness is unavailable, wait and rerun. The output includes the verified block, IDs and evidence path. Fable can rebuild the UI from this public config after Claude checks it.

**Before signing**, run the complete rehearsal in a fresh isolated directory. The outer Anvil fabricates the exact four calls with chain ID 31337 on a verified 196 fork. Twelve local successor blocks provide a rehearsal observation point. The verifier writes a fork-only configuration and receipt evidence in the named directory. The financial harness reads that configuration in `--published --fork` mode on a second Anvil. Public finality is verified only in the real post-sign sequence. [Rehearsal command](../../contracts/expansion/script/native7/rehearse-publication.mjs)

```sh
node contracts/expansion/script/native7/rehearse-publication.mjs --out-dir "evidence/session9-native/run-$(date -u +%Y%m%dT%H%M%SZ)"
```

Anvil uses loopback ports 19709 and 19710. Both subprocesses close when the run finishes. Rehearsal mode rejects output paths in the app configuration and existing evidence directories outside the Session 9 output scope. Fork configs carry `chainId: 31337`, `mode: "fork-only"` and `status: "verified-fork-rehearsal"`. The shipped public config remains pending until the founder publishes.

**November 27 FORK result.** The rehearsal used public block **77,001,269**. All four transactions succeeded on the private fork. The verifier derived local IDs 2/3/4, checked publisher ownership, and matched **23/23** native outputs against the public 1952 development reference at block **47,312,912**. The nested consumer fork mined 61 transactions (49 successes, 12 deliberate reverts). All 18 financial traces made zero calls to the reference processor; repayment succeeded through the simulated outage. The 5,500 bps account borrow, 6,500 bps direct market borrow and 100 bps swap used 796,290, 480,767 and 350,388 gas. Each one-basis-point excess failed. The three financial paths also failed on all 12 malformed or failed-response simulations. Nine targeted Node assertions passed across the envelope, output isolation and generated evidence test suites. [FORK fabrication receipts](../../evidence/session9-native/nov27-fork/publication-transactions.json) · [FORK postpublication verification](../../evidence/session9-native/nov27-fork/verified-receipts.json) · [FORK configuration consumed by native7](../../evidence/session9-native/nov27-fork/tapeout-196.json) · [FORK gas and settlement proof](../../evidence/session9-native/nov27-fork/financial-fork.json)

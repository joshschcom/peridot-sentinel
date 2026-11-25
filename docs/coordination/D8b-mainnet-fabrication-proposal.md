# D8(b) · Standalone public policy circuits

**Decision requested.** The founder can obtain two public Peridot circuit IDs using existing TapeOut CPU 410 on X Layer mainnet. The three proposed calls cost an estimated **0.00327867960093398 OKB ($0.2546)** including execution gas. The proposed spending ceiling is **0.003321 OKB ($0.2579)** under the pinned fee schedule. The selected processor charges in OKB. Its mint supplies all 150 required NAND components. The founder would need no BEM, ERC-20 allowance, new CPU, registry or financial contract.

**Status: unsigned proposal.** The three receipts below came from a local fork. No public transaction was sent, no founder address was selected and neither Peridot circuit has a verified public ID. This decision is solely about publishing circuit NFTs. X Layer's event FAQ permits an existing processor and asks circuit entrants for the address and circuit IDs. It leaves acceptance of a public-circuit/testnet-financial demonstration to the organizer. [Participation requirements and FAQ](https://web3.okx.com/xlayer/build-x-series)

## Calls for founder review

At X Layer block **76,846,436** (2026-11-25 14:04:32 UTC), hash `0xb88c64f8d0b5bc53d215371a0c71b2c7c42a7258e1ec20b2d3bdab3225dccb4e`, the public factory `0x1f09DAeFA827f02CBb40967cc91b259763760761` returned `cpuAt(410) = 0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5` and `isCPU = true`. The CPU name is **TapeReel**, a third-party processor. Its `transistors()` returned `0x3896076be165d6a7ec2a70ccf6876673fe245007`. The component supply cap was 10,000, with 163 minted and 9,837 available. NAND is token ID 0. The earlier mainnet creation receipt identifies both contracts. [CPU 410 creation](https://www.okx.com/web3/explorer/xlayer/tx/0x49f3a5997dc717ca398af2ec23681c18d0644723970d1bc80b27078b435c2f9e)

| Order | Target and action | Value in wei | Gas used on fork | Proposed gas limit |
|---|---|---:|---:|---:|
| 1 | Transistors `0x3896076be165d6a7ec2a70ccf6876673fe245007` · `mint(0,150)` | 660,000,000,000,000 | 83,599 | 120,000 |
| 2 | CPU `0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5` · `tapeout(marketNetlist,20,1)` | 1,300,000,000,000,000 | 402,065 | 520,000 |
| 3 | Same CPU · `tapeout(accountNetlist,20,1)` | 1,300,000,000,000,000 | 448,316 | 580,000 |

**Exact unsigned calldata** for each row is the complete `proposedMainnetCalls[i].unsigned.data` in the evidence file. Each object supplies chain ID 196 (`0xc4`), EIP-1559 type, target, value, calldata, gas limit, max fee of 50,000,000 wei/gas and priority fee of 1 wei/gas. The file includes the two full ABI-encoded netlists with zero padding. Sender, signature and nonce are intentionally unassigned. For review, `jq '.proposedMainnetCalls[] | {label, unsigned}' evidence/session2-d8b/proposal-and-fork.json` prints the three envelopes without interacting with a node. [Unsigned calls and fork receipts](../../evidence/session2-d8b/proposal-and-fork.json)

| Policy | Circuit spec | Netlist Keccak-256 |
|---|---|---|
| MARKET | 63 NAND, maximum post-operation LTV 6,500 bps, reserve required on borrowing | `0xe845d0cb6d0e0c86faca013143995f6a0c9d6a1dbb0772a6176fe0ee977e6c09` |
| ACCOUNT | 87 NAND, maximum 5,500 bps, allowed operation IDs 0, 1, 2, 5 | `0x7dbd1ad5e86acbf5796e7ed7aacbcb724ae35b69ee5742c8efae1744d20a6818` |

Both are stateless, with 20 input wires and one output. The market call's selector is `0x7bd3ac1d` and full calldata is 580 bytes. The account call has the same selector and 772 bytes. The 68-byte mint call has selector `0x1b2ef1ca`. [SDK specs, netlists and vectors](../../packages/circuit-sdk/fixtures/policies-v1.json)

**Signer and settlement.** A founder-controlled, separately funded mainnet EOA must be the sender for all three calls. It pays native OKB and receives 150 ERC-1155 NANDs, burns 63 then 87, and receives both circuit NFTs. Each receipt must succeed before proceeding. The testnet deployer is reserved for chain 1952. The simulated sender in the evidence is a public Anvil account and is unsuitable for holding real assets. A smart contract wallet would require a new rehearsal for its gas and token receiver behavior.

## Cost basis

At the pin the base fee was 20,000,000 wei/gas. The official RPC quoted `eth_gasPrice = 20,000,001` and `eth_maxPriorityFeePerGas = 1`. The three fork receipts consumed 933,980 gas. Applying the public quote to that measured usage gives 0.00001867960093398 OKB in execution gas. Adding the component batch fee and both fabrication fees gives the estimated total above. The 1,220,000 gas limit sum at 50,000,000 wei/gas reserves at most 0.000061 OKB in execution fees.

The native L1 data fee is separate. At the pin, the X Layer gas oracle at `0x420000000000000000000000000000000000000F` reported base- and blob-fee scalars of zero. `getL1FeeUpperBound` returned zero for conservative unsigned transaction sizes of 268, 780 and 972 bytes. The USD amounts use the **$77.65** close of OKX's confirmed OKB/USD one-minute index candle starting at 14:03 UTC, the most recent completed minute before the snapshot. Requote and reapprove if pending state would exceed the spending ceiling, including any L1 charge. [Price responses and arithmetic](../../evidence/session2-d8b/fees-and-prices.json) · [OKX historical index observation](https://www.okx.com/api/v5/market/history-index-candles?instId=OKB-USD&bar=1m&limit=1&after=1795615440000)

## New CPU and BEM acquisition

An alternative is to create a Peridot-branded CPU through the current factory. Factory `bem()` identifies `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`, an eight-decimal BEM token. `deployFee()` returned 10,000,000 base units (**0.1 BEM**), and `protocolFee()` returned 1,000,000 (**0.01 BEM**). A real recent new-CPU transaction used 776,817 gas, sent zero OKB value and logged a 0.1 BEM transfer to the protocol wallet. Its component contract reports BEM from `BEM()`, mint price zero and the 0.01 BEM batch fee. Its circuit contract still quotes **0.0013 OKB per tapeout**. [Public CPU creation receipt](https://www.okx.com/web3/explorer/xlayer/tx/0x877bdbeea16f258079f4b236110cc041e569291fc0141808698d48b392512a34) · [Pinned fee queries](../../evidence/session2-d8b/fees-and-prices.json)

A new CPU with a zero component unit price would require **0.11 BEM plus 0.0026 OKB**, before transaction gas. A nonzero price adds 150 times that unit price. The creator needs allowance for the factory to collect the creation fee and a separate allowance for the new transistor contract to collect the mint charge. A founder already holding BEM on X Layer could fund the dedicated mainnet wallet with a normal transfer of the verified token. There is no token purchase or bridge in the proposed CPU 410 route.

For an indicative acquisition cost, we obtained public contract quotes on **BNB Chain block 135,667,855**, 14:06:04 UTC. This is a read-only example for the alternative route. TapeOut's bridge links the BNB token `0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a` and the X Layer token above. We verified both LayerZero peers. The BNB-side adapter is `0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72`. The source chain requires native BNB for gas and messaging. [Official TapeOut bridge](https://tapeout.net/bridge) · [Contract quotes and exact arguments](../../evidence/session2-d8b/fees-and-prices.json)

1. From an already funded BNB Chain wallet, a PancakeSwap V3 exact-output quote priced **0.111 BEM at 0.888649198957040325 USDT**. The verified pool `0x3098D7A051045000d68eC0360753A40C8cABEa31` holds BSC USDT and BEM with fee tier 10,000. Its factory matches the quoter's factory. USDT approval, swap gas and price slippage depend on the wallet and execution time.
2. Using TapeOut's bridge, the 50-bps fee and six-decimal cross-chain precision would deliver **0.110445 BEM**. The bridge's `quoteSend(...,false)` returned **0.002264734837712551 BNB** for LayerZero messaging. The bridge can require a token allowance and source-chain execution gas.
3. Using contemporaneous confirmed OKX USD index closes of 0.99858 for USDT, 532.4 for BNB and 77.65 for OKB, this sample purchase, message and both native fabrication fees come to **$2.2950, or 0.029556 OKB equivalent, before execution gas on both chains**. These are three distinct payment currencies. Wallet approval history, source-chain funding, bridge latency and market execution determine the remaining cost. An exact all-in cost for creating a new CPU requires a chosen wallet and a new end-to-end route quote. [BNB/USD candle](https://www.okx.com/api/v5/market/history-index-candles?instId=BNB-USD&bar=1m&limit=1&after=1795615440000) · [USDT/USD candle](https://www.okx.com/api/v5/market/history-index-candles?instId=USDT-USD&bar=1m&limit=1&after=1795615440000)

## Fresh fork verification

A new Anvil 1.7.1 instance on chain **31337** forked public chain 196 at the proposal pin. It submitted precisely the three proposed calls in order with the chain ID changed to 31337 and a local unlocked sender. The component balance moved from 0 to 150 to 87 to 0. Both circuits returned the expected dimensions and exact SDK netlist bytes. Their ERC-721 owners matched the simulated sender. Twelve of twelve `eval` calls matched the SDK, including the equality and one-basis-point-over cases. All three receipts have status 1. [Full receipt logs, owner checks and vectors](../../evidence/session2-d8b/proposal-and-fork.json) · [Loopback-only replay](../../evidence/session2-d8b/rehearse.py)

| Local fork action | Local fork receipt | Local result |
|---|---|---|
| Mint | `0x07ed42fc94d2aed0447896629e9c4544dfe6dd32e7b9dfe8cdae3c49c3c83b96` | 150 NAND |
| Market fabrication | `0x63347a7c0b975360cd1138169866f2c619386f860b4ed7c9bbea6cbbc83edf2f` | Fork circuit #2 |
| Account fabrication | `0x18a8f40543d298c1d8a623763d9eb0ea1cbbd2e8c290b416963e708c48b3e1d4` | Fork circuit #3 |

To reproduce, run the following in separate terminals from the repo root.

```sh
anvil --fork-url https://rpc.xlayer.tech --fork-block-number 76846436 --chain-id 31337 --port 19622 --no-storage-caching --quiet
python3 evidence/session2-d8b/rehearse.py
```

## Risks and approval boundary

- The factory is unsealed, with a nonzero UUPS owner. Its active implementation was `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a`. CPU 410 points to circuit beacon `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` with owner zero and implementation `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2`. Recheck code, implementation, factory membership, component cap, available supply and all fees at signing. [Historical upgrade and ownership evidence](../TAPEOUT_INTEGRATION.md)
- The three calls settle separately and can be interleaved with other users' fabrications. Read each new public ID from that transaction's `TapedOut` log and verify owner, dimensions, bytes and eval outputs. Public IDs may differ from fork IDs. If an intermediate call fails, reconcile the mined component balance and successful receipt before preparing another call. Mint and fabrication fees can be irreversible.
- These NFTs expose the exact policy netlists publicly and would be held by the signing wallet. No collateral moves and no policy is attached to a funded protocol. Using a third-party CPU makes that relationship visible in the submission. Founder approval would apply only to these three standalone calls and the stated fee ceiling. Receipt verification and actual submission eligibility are still pending.

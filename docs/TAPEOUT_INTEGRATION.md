# TapeOut integration on X Layer

On 25 November 2026, Peridot read an existing public circuit on X Layer mainnet and compared its outputs with TapeOut's reference evaluator. In a local Anvil fork of the same block, Peridot fabricated its two SDK policies on a factory-registered processor, then evaluated them through its Solidity adapter. Both policies passed all six of their vectors, including denials. A sponsor deployment on X Layer testnet remains unconfirmed.

| Evidence | Network | Artifact |
|---|---|---|
| Existing Cerebr processor, existing circuit #1, six read-only calls | Public X Layer 196, block 76,844,958 | [RPC values, gas and historical receipt](../evidence/a1/mainnet-reads.json) |
| All 451 processor creation events | Public X Layer 196, through the same block | [Processors, transistor contracts, blocks and transaction hashes](../evidence/a1/factory-events.json) |
| Peridot market #2 and account #3, local receipts and 12 decisions through the actual adapter | Anvil simulation, chain 31337 forked from 196 at 76,844,958 | [Fork evidence](../evidence/a1/fork-policy-evaluations.json) |
| Candidate addresses returned empty code | Public X Layer testnet 1952, block 47,155,156 | [Testnet byte counts and block hash](../evidence/a1/mainnet-reads.json) |

## Sources and testnet availability

The three shallow clones live in gitignored `.research/`. These pins identify the revisions examined.

| Repository | Commit | Relevant material |
|---|---|---|
| [TapeOutProtocol/TAPs](https://github.com/TapeOutProtocol/TAPs/tree/527477ecb7cf68ee9e86d8292669d57fe1680572) | `527477ecb7cf68ee9e86d8292669d57fe1680572` | TAP-02, TAP-10 and the MIT Python evaluator under `assets/tap-02`. TAP text and fixtures carry CC0 terms. |
| [TapeOutProtocol/TapeKit](https://github.com/TapeOutProtocol/TapeKit/tree/ebf861bced437b99f20b71deb1445340ea018206) | `ebf861bced437b99f20b71deb1445340ea018206` | MIT client code, CC0 specification. The kernel config defines BNB 56, X Layer 196 and Base 8453. |
| [NetLayerLabs/Cerebr](https://github.com/NetLayerLabs/Cerebr/tree/47f5744dc2a76fabaa3fb8372b0d1dd265123ef3) | `47f5744dc2a76fabaa3fb8372b0d1dd265123ef3` | Community deployment records and ABI hints for the public CPU at factory index 275. |

The TAP deployment tables, TapeKit kernel configuration and repository READMEs yielded no 1952 factory, processor or component faucet. At the testnet pin, the mainnet factory, its draft and current implementations, the circuit beacon, its implementation and the sampled CPU all returned zero bytes. This checks only those addresses.

Both sites returned HTTP 200. TapeOut serves a client whose X Layer RPC configuration includes chain 196. The loaded bundle was `/app/assets/index-DizVcbig.js`, SHA-256 `0c532120c91d15367da384da0dad3692f03acaee321c874aad3963c8c5aebf0c`. Fab X describes an X Layer component-mint and fabrication flow. Neither site supplied a verified 1952 processor for this investigation. [TapeOut](https://tapeout.net/) · [Fab X](https://fabx.tech/)

**Self-deployment remains unverified.** The pinned repos provide protocol text, evaluator code, clients and TapeSend contracts. They did not yield the Solidity source, license and build inputs for the active X Layer factory and complete processor/transistor stack. TAP-02 points to MIT-licensed BNB processor source. The X Layer factory has since changed implementations, and equivalence of the BNB build to the X Layer stack has not been established. Sourcify returned no compilation match for the current X Layer factory or processor implementation. With this evidence, use `DevelopmentReferenceProcessor` on local/testnet under the label **Peridot development reference processor**. Reserve **self-deployed TapeOut reference processor on testnet, not the official sponsor deployment** for a licensed, reproducible build equivalent to the sponsor implementation. [TAP-02](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-02.md) · [Factory verification lookup](https://sourcify.dev/server/v2/contract/196/0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a) · [Processor verification lookup](https://sourcify.dev/server/v2/contract/196/0x977f217887E085D298Cb3819cDAD5A0ee35F29B2)

## Public mainnet reads and authority

Official RPC `https://rpc.xlayer.tech` returned chain ID 196 and block hash `0xa2558795a0e1feb6aa6e03b5226362b752c1308bd5e26e6be13897fd9f6e3bc8` at block 76,844,958. The testnet RPC `https://testrpc.xlayer.tech` returned chain ID 1952 and block hash `0x3f0cbd1c53e5c53633911260873453ad8fefdac07332ea5073cd611115764534` at 47,155,156.

| Address / field | Result on mainnet |
|---|---|
| Factory proxy | `0x1f09DAeFA827f02CBb40967cc91b259763760761`, 130 bytes |
| ERC-1967 implementation slot `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` | `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a`, 9,376 bytes |
| Earlier TAP-10 candidate | `0x74956236Ab64eD143933040B4137E8A352e4d17b`, 7,671 bytes still deployed |
| ERC-1967 admin slot `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103` | Zero |
| Factory `owner()` / `isSealed()` | `0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138` / `false` |
| `circuitBeacon()` / beacon `owner()` | `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` / zero |
| Beacon `implementation()` | `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2`, 12,562 bytes |
| Sampled CPU ERC-1967 beacon slot `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` | Same circuit beacon. CPU runtime hash `0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5`. |

**The factory is unsealed.** Its current implementation exposes UUPS `upgradeToAndCall`, and the chain records an upgrade to its current implementation at block 75,368,048. A zero admin slot is consistent with UUPS. The beacon's ordinary ownership-based upgrade path has been renounced. Its ownership event at 73,915,513 transferred the owner from the factory to zero. The beacon runtime exposes `upgradeTo(address)`, `implementation()`, `owner()`, `transferOwnership(address)` and `renounceOwnership()`. TAP-10 §13.8's factory-seal predicate fails on the seal flag, factory implementation and beacon owner. Check the chain and review the implementation behind each dependency before a funded release. [Factory upgrade transaction](https://www.okx.com/web3/explorer/xlayer/tx/0xdc1e1dd122e0fe295958067f0c924c01a5999715e8f5be0659f20ba56acc6368) · [Beacon ownership transaction](https://www.okx.com/web3/explorer/xlayer/tx/0x1a534cc3b4e46394430823f429df152e7fe741656641523bcade5773599f6fe3) · [TAP-10](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-10.md)

## Public processor enumeration and evaluation

The factory returned `cpuCount() = 451`. The event index contains 451 distinct processors from 451 `CPUCreated(address indexed circuits,address indexed transistors,address indexed creator,string name,uint256 supply,uint256 mintPrice)` logs, in block/log order. Topic zero is `0x2e8868f18a1eaf0222b5b09484fdf12163e9741393f8457cd79d2ae42b2d2290`. We queried NodeFlare from block 70,995,047 through 72,295,046. For the remaining blocks we used monotonic historical `cpuCount()` reads on the official RPC to select nonempty intervals, then queried their logs via Sentio. Each interval's number of logs matched its change in count. A second pass using only the official RPC matched all 451 records against their transaction receipts, indexed log topics and `cpuAt(index)` at the pin. Index 0 first appeared at 71,026,003. Index 450 appeared at 76,844,176. [Full event index](../evidence/a1/factory-events.json)

`cpuAt(275)` returned `0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`, and `isCPU` returned true. Circuit #1 has dimensions `(nIn=2,nOut=1,nState=0,gateCount=2)`. Its historical fabrication receipt succeeded at 72,461,505 with 246,582 gas. The netlist is `0x0000000300000200000004000004`, hash `0x04669453a8027de5f595aa0edb7ecde0ceeeeb53fa00d00d726ee64082e46be3`. The first NAND reads input signals 3 and 2. The second NAND inverts their NAND result, implementing AND. [Existing circuit fabrication transaction](https://www.okx.com/web3/explorer/xlayer/tx/0xeb5e9cedb905ad98209f04a40b2a93e7caaadce88f031b2bcb07f21d78d18254)

| Input hex | Public `eval` hex | TAP Python reference hex | Official RPC gas estimate |
|---|---|---|---:|
| `00` | `00` | `00` | 50,601 |
| `01` | `00` | `00` | 50,766 |
| `02` | `00` | `00` | 50,766 |
| `03` | `01` | `01` | 51,183 |
| empty | `00` | `00` | 50,269 |
| `ffaa` | `01` | `01` | 51,195 |

The ABI read surface is `circuitInfo(uint256) → (uint32,uint32,uint32,uint32)`, `netlist(uint256) → bytes` and `eval(uint256,bytes) → bytes`. TAP-02 number encoding uses big-endian wire indices inside 7-byte NAND records (`00` + two u24 indices), and little-endian bit order inside each packed vector byte. Constants occupy signals 0 and 1, then come inputs and gate outputs. The last `nOut` signals form the output. TAP-02 also defines LATCH and REF. Peridot v1 accepts only backwards-referencing NANDs. The processor zero-extends short vectors and ignores excess bits. The v1 context encoder builds exactly three bytes and leaves the top four bits zero. One output bit returns one payload byte in a 96-byte ABI envelope.

## Local Anvil fork fabrication and enforcement

The upstream source was `https://rpc.xlayer.tech` at block 76,844,958. All writes in this section went to loopback Anvil, chain ID 31337. CPU index 410 already had a circuit and 9,837 components available for mint at the pin. It was created publicly at block 75,095,834. The pre-existing processor is `0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5` and its transistor contract is `0x3896076BE165d6a7eC2a70CCF6876673fE245007`. The Peridot circuit IDs and receipts below exist **only on this fork**. [Public CPU creation](https://www.okx.com/web3/explorer/xlayer/tx/0x49f3a5997dc717ca398af2ec23681c18d0644723970d1bc80b27078b435c2f9e)

| Fork policy | Circuit / shape | Components consumed | Fabrication gas | Solidity evaluation gas across six vectors |
|---|---|---:|---:|---:|
| Market, 6,500 bps max, reserve required on borrow | #2, 20 inputs / 1 output / 0 state | 63 NAND | 402,065 | 175,392–175,942 |
| Account, 5,500 bps max, explicit operation mask | #3, 20 inputs / 1 output / 0 state | 87 NAND | 448,316 | 229,723–230,273 |

One ERC-1155 `mint(0,150)` at zero component unit price cost 0.00066 simulated OKB and 83,599 gas. Each `tapeout(bytes,uint32,uint32)` consumed the expected quantity from that wallet and cost 0.0013 simulated OKB. The two fabrications and one component mint totaled 0.00326 simulated OKB before gas. The 63- and 87-gate netlists round-tripped byte-for-byte. `nextId()` returned the last assigned ID on this CPU. The client measured eval gas around the Solidity external read, including call and decoding overhead. [Netlists and boundary vectors](../packages/circuit-sdk/fixtures/policies-v1.json) · [Fork receipts, inputs, outputs and gas](../evidence/a1/fork-policy-evaluations.json)

The Solidity probe matched all 12 SDK vectors. The real Peridot `PolicyRegistry` and `TapeOutPolicyAdapter` then registered both circuits and matched all 12 decisions through the same processor. At the thresholds both borrows passed. One basis point above either threshold produced the corresponding `MarketPolicyRejected` or `AccountPolicyRejected`. The adapter forwards at most 1,500,000 gas. A short buffer returned `00` on the raw market circuit and the probe rejected it. Appending a byte to the equality vector preserved the raw result. Circuit #1 on `0x0565EA48CA41Ae559d8d491dbb0a9ec945DB551b` has two state bits and reverted with `has latch: use step`; missing circuit ID 0 reverted with `no circuit`. Neither failure produced an allow decision. [Solidity probe](../contracts/test/fork/a1/ProcessorProbe.sol) · [Fork evidence](../evidence/a1/fork-policy-evaluations.json)

These fees are specific to this existing CPU. The current factory's `bem()` identifies `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`, symbol BEM, eight decimals. The TapeOut client obtains a BEM allowance for new CPU creation on this configuration. At the pin, `deployFee()` was 10,000,000 BEM base units (0.1 BEM) and `protocolFee()` was 1,000,000 (0.01 BEM). Newer CPU 449's transistor contract returned BEM from its `BEM()` getter. The older CPU 275 had exhausted its 1,000,000-token supply cap. A fabrication quote must identify the processor, inspect its component inventory and read its current fee denomination. [Public results](../evidence/a1/mainnet-reads.json) · [Official client](https://tapeout.net/)

### Settlement on the fork

An isolated child of the local fork retained the sponsor processor and fork-only circuit IDs #2 and #3. A real Peridot Sentinel borrow on that fork consumed 771,264 gas, accrued debt to the Sentinel, and called both circuits with the same three context bytes, `0x12f409`. Both returned allow. Separate mined fork transactions reverted with AccountPolicyRejected and MarketPolicyRejected. The latter called the lending book directly. The rejection receipts, revert data and successful borrow trace are recorded together. [Product settlement evidence](../evidence/a5/settlement-ea66a81d55e7.json)

### Reproduce

Run these from the repository root. The Python harness requires Foundry 1.7.1, Python 3 and two SDK fixtures. The first command builds the gas probe in the repo's ignored research directory. The second builds the actual Peridot enforcement contracts. Start the third in a separate terminal. The harness checks the loopback Anvil node's chain, upstream endpoint, fork block and starting height before it sends an unsigned transaction from a local unlocked funded account. A rerun on a fresh fork can produce different transaction hashes.

```sh
(cd contracts && forge build test/fork/a1/ProcessorProbe.sol --out ../.research/probe-out --cache-path ../.research/probe-cache)
(cd contracts && forge build src/policies/TapeOutPolicyAdapter.sol)
anvil --fork-url https://rpc.xlayer.tech --fork-block-number 76844958 --chain-id 31337 --port 19621 --no-storage-caching --quiet
python3 evidence/a1/replay-fork.py
```

For the public evidence, clone the pinned TAPs revision under the ignored research directory, then verify every indexed event against its receipt and registry position at the mainnet pin. The same script compares all six reads to the pinned reference evaluator.

```sh
git clone https://github.com/TapeOutProtocol/TAPs.git .research/TAPs
git -C .research/TAPs checkout --detach 527477ecb7cf68ee9e86d8292669d57fe1680572
python3 evidence/a1/verify-public.py
```

An individual read-only call can be reproduced with the following command.

```sh
cast call --rpc-url https://rpc.xlayer.tech --block 76844958 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF 'eval(uint256,bytes)(bytes)' 1 0x03
```

## Draft organizer request

Peridot Markets has verified a live processor on X Layer and fabricated two policy circuits in a local fork. Our public financial demo targets X Layer testnet 1952. Could you share any official testnet factory, processor and component faucet addresses, or the licensed factory/processor/transistor source and reproducible build for a self-deployment? Would a testnet financial demo accompanied by public mainnet read evidence and clearly labeled fork-only Peridot circuit IDs meet the submission criteria? If live public circuit IDs are required, please identify the minimum acceptable demonstration and confirm the supported fabrication fees and assets.

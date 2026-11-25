# X Layer token identities and price observations

Mainnet returned USD prices for all four candidate assets through Chainlink. X Layer testnet returned recent USDC/USD and USDT/USD prices from Supra when supplied with a network-specific signed proof. Both findings come from read-only calls. Peridot does not consume these feeds in the demo deployment.

## Reproduce

Run from the repository root with the existing npm dependencies.

```sh
node evidence/session3-oracles/replay.mjs
node evidence/session3-oracles/replay-supra.mjs
```

The first command compares code sizes, runtime hashes, raw ABI calls and decoded results against [rpc.json](rpc.json). The second compares four read-only proof-verifier calls with [supra-verifier.json](supra-verifier.json). Both assert chain ID and canonical block hash and compare the complete result. Reproduction requires an RPC that retains historical state. The scripts have no signing or broadcast path.

| Network | Primary asset and feed snapshot | UTC time | RPC |
|---|---|---|---|
| X Layer mainnet, 196 | 76,847,921 · `0x6a506032748daf2c979031666cf81474e03c4d35f98d9054709aef77aa7a23b3` | 2026-11-25 14:29:17 | https://rpc.xlayer.tech |
| X Layer testnet, 1952 | 47,158,121 · `0xadf3e7abe2c345b5ecd4a6b1a974d31d5780269a688278c42cf2f0fa0faf5d49` | 2026-11-25 14:29:18 | https://testrpc.xlayer.tech |

## Token identity

All rows below have runtime code and answered ERC-20 `name()`, `symbol()` and `decimals()` at their pin. Runtime sizes cover the addressed contract, including proxy shells where applicable.

| Network and asset | ERC-20 address | Returned symbol | Decimals | Runtime bytes |
|---|---|---|---:|---:|
| 196 · Circle-issued native USDC | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` | USDC | 6 | 1,798 |
| 196 · USDC bridged from Ethereum | `0x74b7f16337b8972027f6196a17a631ac6de26d22` | USDC | 6 | 1,550 |
| 196 · earlier bridged USDC.e | `0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035` | USDC | 6 | 5,802 |
| 196 · USDT0 OFT, current X Layer representation | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | USD₮0 | 6 | 2,227 |
| 196 · legacy wrapped USDT | `0x1E4a5963aBFD975d8c9021ce480b42188849D41d` | USDT | 6 | 5,802 |
| 196 · Paxos Global Dollar | `0x4ae46a509F6b1D9056937BA4500cb143933D2dc8` | USDG | 6 | 708 |
| 196 · wrapped native OKB | `0xe538905cf8410324e03A5A23C1c177a474D59b2b` | WOKB | 18 | 3,474 |
| 1952 · Circle test USDC | `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3` | USDC | 6 | 1,798 |
| 1952 · Paxos test USDG | `0xF0863D7A29a55d0c4263c11bFac754312ff078DF` | USDG | 6 | 708 |

All three mainnet USDC contracts report the same symbol on-chain. Match by chain and address. Circle publishes the native and current bridged addresses. OKX identifies the older bridged USDC.e. [Circle launch and addresses](https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer) · [OKX bridge generations](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/bridge/usdc-on-x-layer)

OKX identifies the old wrapped USDT and the replacement USDT0. USDT0 uses its own cross-chain settlement system. A USDT/USD reference quote alone cannot establish the local bridge representation's recoverable value. [OKX migration notice](https://www.okx.com/en-ae/help/usdt0-faq) · [USDT0 network and token address](https://usdt0.to/ecosystem/x-layer)

Paxos publishes USDG token, transfer-adapter and supply-control addresses separately. For balances and allowances use the token row. X Layer publishes the WOKB wrapper, while native OKB pays network gas. Mapping WOKB to the OKB spot price assumes the wrapper remains redeemable. [Paxos mainnet contracts](https://docs.paxos.com/guides/stablecoin/usdg/mainnet) · [Paxos testnet contracts](https://docs.paxos.com/guides/stablecoin/usdg/testnet) · [X Layer contract directory](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts)

## Mainnet Chainlink push feeds

Each price proxy returned its provider-listed aggregator, eight decimals, a positive price, a nonzero timestamp no later than the block, and matching round IDs. All five fell inside the directory's 86,400-second heartbeat. The listed deviation threshold was 0.5% for each. Heartbeat describes provider update behavior. The protocol still needs its own maximum age and response to interruptions. The bundled [directory extract](chainlink-directory.json) records both address layers and the SHA-256 of each full directory response. [Official mainnet directory](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-xlayer-1.json) · [Chainlink directory configuration at commit e72fe55](https://github.com/smartcontractkit/documentation/blob/e72fe55c846a60fa29ec14bb16460ab9a0f7920b/src/features/data/chains.ts) · [Price-feed methodology and bounds](https://docs.chain.link/data-feeds/selecting-data-feeds)

| Product | Feed proxy | USD per base unit | Last update UTC | Age seconds |
|---|---|---:|---|---:|
| USDC / USD | `0xB8a08c178D96C315FbFB5661ABD208477391BC40` | 0.99988000 | Nov 24 16:18:19 | 79,858 |
| USDT0 / USD | `0x673b428Fd1df93a6F77fA7ea1F8eeD8A4Ff36b9f` | 0.99885995 | Nov 24 19:41:42 | 67,655 |
| USDG / USD | `0x385C6bDDE06b0E438319bF4ddBfFe51C521ABf3D` | 0.99998000 | Nov 24 19:42:43 | 67,594 |
| OKB / USD | `0x4Ff345b18a2bF894F8627F41501FBf30d5C5e7BE` | 78.25276041 | Nov 25 14:11:26 | 1,071 |
| USDT / USD | `0xb928a0678352005a2e51F614efD0b54C9830dB80` | 0.99874348 | Nov 24 16:15:55 | 80,002 |

The provider classifies USDT0/USD as a DEX-state price. It marks USDC/USD and USDT/USD as capped stablecoin feeds. A single dollar peg assumption would erase depegs visible in the data. The existing isolated controller expects USD WAD per whole token. For an 8-decimal quote, multiply the positive raw answer by `10^10`; token balance scaling happens separately with the ERC-20's decimals. [Directory metadata](chainlink-directory.json) · [Controller pricing math](../../contracts/src/markets/IsolatedController.sol)

Sequencer uptime proxy `0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9` returned answer 0 (up), `startedAt=1763064971` and `updatedAt=1795551888`. Uptime uses status-transition time and an application-defined grace period after recovery. The age of a price round and the time since a sequencer restart measure different things. [Chainlink sequencer status specification](https://docs.chain.link/data-feeds/l2-sequencer-feeds)

## Supra storage and proof settlement

Supra lists a pull-verifier and a storage contract for both networks. Both addresses had code on their specified chain. Its catalogue maps 48 to USDT/USD (8 price decimals in these observations), 89 to USDC/USD (8), and 148 to OKB/USDT (18). Supra labels the last pair “Under Supervision”. The examined catalogue did not identify a direct USDG/USD or OKB/USD pair. [Supra contract directory](https://docs.supra.com/oracles/data-feeds/pull-oracle/networks) · [Supra pair catalogue](https://docs.supra.com/oracles/data-feeds/data-feeds-index)

| Network | Pull verifier | Storage | `getSvalue(pair)` at asset pin |
|---|---|---|---|
| 196 | `0xe41444462709484272F54371F3f53bBF900Ec49E` | `0x3E5E89d14576cE9f20a8347aA682517fe65B4ACB` | USDT/USD and USDC/USD last updated 2024-09-15. OKB/USDT last updated 2026-11-17. |
| 1952 | `0xF8522B7fcE37439b98A2be282d413A44269028bE` | `0x39d5cdB131f73c76cefac04556Fa0F75689200dA` | All three returned zero for round, decimals, time and price. |

We fetched a separate provider proof from each network's public `POST /get_proof` endpoint using `{"pair_indexes":[48,89,148],"chain_type":"evm"}`. The artifacts contain the complete response and block hashes. Replay submits archived bytes with JSON-RPC `eth_call` to the real verifier's `verifyOracleProofV2(bytes)`. It decodes arrays of pair IDs, raw integer prices, timestamps in milliseconds, decimals and rounds. No transaction or persisted storage update occurred. An integration with the controller's view interface would need a verified update path and timely delivery before subsequent risk checks. [Mainnet proof](supra-mainnet-proof.json) · [Testnet proof](supra-testnet-proof.json) · [Supra verifier interface](https://docs.supra.com/oracles/data-feeds/pull-oracle) · [Official REST client at commit 6768495](https://github.com/Entropy-Foundation/oracle-pull-example/blob/6768495d4b87f16da614ec282e850791e00cebd5/rest/javascript/evm_client/pullServiceClient.js)

| Chain | Canonical replay block | USDT/USD | USDC/USD | OKB/USDT | Quote timestamp (ms) | Age at block (ms) |
|---|---:|---:|---:|---:|---:|---:|
| 196 | 76,848,401 | 0.99858758 | 0.99997000 | 77.5825 | 1795617432137 | 4,863 |
| 1952 | 47,158,598 | 0.99857500 | 0.99993500 | 77.62 | 1795617431088 | 3,912 |

At capture five blocks earlier, both verifiers also accepted the proof while its timestamp exceeded the block time by 137 ms on mainnet and 1,088 ms on testnet. Compare `timestampMs` to `block.timestamp * 1000`, check future time and maximum age, and validate every requested pair and its decimals. For the two-leg USD valuation of OKB, multiply the raw OKB/USDT and USDT/USD quotes as integers and retain their combined scale of 26 decimals. The resulting USD values were 77.47292092535 and 77.5093915 respectively. They depend on pricing and freshness of both legs. A direct feed for the specific token can have different settlement or pricing behavior. [Decoded proofs and exact cross-products](supra-verifier.json)

These replays assert canonical hashes at specific block heights. At the finality check, the RPCs reported finalized heads 76,847,025 and 47,157,299 respectively, below the observation heights. Independent L1 finality of the captured blocks was unverified in this session.

## Testnet exclusions and funding

The X Layer Sepolia directory supplied six Chainlink candidates. On chain 1952, all six proxies and all six corresponding aggregator addresses had empty code. The five mainnet price proxies and mainnet uptime address were also empty at the 1952 pin. This rules out those exact addresses for that snapshot. Another testnet deployment may exist. [Candidate list](https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-xlayer-1.json) · [Recorded probes](rpc.json)

Pyth's published EVM chain catalogue at commit `de5612d4a7a9f86de1a84308578c204184e8b767` had 204 entries, with no chain ID 196 or 1952. The accompanying EVM price-contract directory had no X Layer/OKX chain entry. This research established no Pyth deployment for either network from that catalogue. [Pyth EVM chains at pin](https://github.com/pyth-network/pyth-crosschain/blob/de5612d4a7a9f86de1a84308578c204184e8b767/contract_manager/src/store/chains/EvmChains.json) · [Pyth EVM price contracts at pin](https://github.com/pyth-network/pyth-crosschain/blob/de5612d4a7a9f86de1a84308578c204184e8b767/contract_manager/src/store/contracts/EvmPriceFeedContracts.json)

Deployer `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67` held 0 wei on 1952 at 47,158,121. OKX documents a user-operated faucet with a 0.2 test OKB daily allowance. We found no documented public programmatic claim endpoint in that guide. No funding request or deployment was made. [Official faucet instructions](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/bridge/get-testnet-okb-from-faucet)

# Astra session report · 25 November 2026

**M0–M3 contracts and infrastructure run on local Anvil and on a fork of X Layer.** A Sentinel borrow on the fork called two actual sponsor circuits with identical context bytes and settled. Two additional fork transactions reverted independently through the account and direct pToken paths. Public X Layer testnet deployment is blocked on test OKB. The web wallet journey remains with Fable.

## Delivery and commits

| Checkpoint | Delivered |
|---|---|
| `58684b1e14495e7dc2fef411a0db23e1d2fd7cf2` | INTERFACES v1 and initial coordination notices. |
| `fe0c60b025cefa70a04eb576ae1fcce90367377e` | Foundry project, baseline-derived isolated lending books, two-asset controller and market factory, registry and bounded adapter, mock feed/assets, deterministic compiler/SDK, chain-config scaffolding and first mainnet reads. |
| `cc9445a79877c406fc9f107b9fcfb440c6db91f6` | Sentinel account/factory, keeper, locally seeded position, ABI exports, real processor fork fabrication, v1.1 interface supplement, design documents and independent review. This is the verified contract build. |
| `7ded29d85ebdcb4ef761b11009087b7e1a471d17` | Full sponsor-fork settlement and two mined rejection receipts, source attestation, fork replay instructions, public chain re-verification, local keeper receipt/concurrency evidence and updated matrix. |

Claude committed the first session report at `9c7f7ea` and refreshed the root workspace lockfile at `586c400267c29b035f3b23b53603100f0405941b`.

Claude made the local Git checkpoints. The Codex sandbox denied creation of .git/index.lock. The checkpoint bodies group the contributing roles under Claude's attribution format. The prior Peridot baseline remains at tag pre-xlayer-hackathon (`fae7cda`). Schema is `peridot.policy/v1`, manifest ABI is `v1` and the documentation revision is `v1.1`. [Interfaces](INTERFACES.md) · [Milestone notices](MILESTONE_LOG.md)

## TapeOut evidence

| Environment | Observation |
|---|---|
| **Public mainnet, read-only** | At X Layer 196 block **76,844,958**, CPU index 275, `0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`, circuit #1 (two-input AND), matched the upstream evaluator and SDK on six inputs. Four canonical gas estimates ranged from 50,601 to 51,183. All 451 processor-creation receipts and indexed addresses were verified. |
| **Factory trust at the public pin** | The factory proxy points to `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a` and reports unsealed. The admin slot is zero and the factory owner is nonzero. The circuit beacon points to `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2` and its ownership was renounced. |
| **Local fork of that block** | Factory-registered CPU `0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5` fabricated Peridot market #2 (63 NAND) and account #3 (87 NAND). Component mint plus circuit fees were **0.00326 simulated OKB**, before transaction gas. Solidity caller evaluation consumed 175,392–175,942 and 229,723–230,273 gas, respectively. Both sets of six changing-input vectors also passed through the Peridot registry and adapter. |
| **Product settlement on a local child fork** | The account and market evals both received `0x12f409` on an 80-mock-USD borrow. The mined receipt used 771,264 gas, hash `0x83c774cc5a499b38166c38bff7f6094a80830f726235ddc1fcb2b4e5c796c563`. The account rejection hash was `0xe59dd2799250e4ff2d77d4e40664aef98abfd6957994190ede89650dfad1fa92`. The direct pToken market rejection hash was `0x7a766e64787d79ed7e7b3249bc63dd296bd85651eeecaab6b9761b6964a53dd4`. Trace return data matches both named errors. |

The fork circuit IDs and product receipts exist only in simulation. The sponsor's public sample circuit predates this project. Upstream pins, read/fork commands, ABI, component prices, organizer draft and license investigation are in the spike report. [TapeOut integration](../TAPEOUT_INTEGRATION.md) · [Product settlement](../../evidence/a5/settlement-ea66a81d55e7.json)

## Deployments and keeper

- **Unforked Anvil 31337, deployed.** The development reference interpreter, market and account factories, registry, adapter, two mock assets and mock feed were deployed to loopback port 18545. The market received 200 mock USD. There were 22 successful setup transactions and 8 successful position transactions. One earlier local borrow exhausted its gas allocation; the journal preserves the failed receipt and a successful retry with headroom. A clean rebuild of cc9445a matched 36 source hashes and all 10 compared artifacts. [Local manifest](../../packages/chain-config/deployments/31337.json) · [Position receipts](../../deployments/local/position-a45e0a53b1c3.json)
- **Local auto-repay.** An operator with a 20-mock-USD cumulative grant repaid from the Sentinel's own funds. Stored debt moved from 80.000000 to 60.000006 mock USD including accrual. The event recorded LTV falling from 5,001 to 3,751 bps. Tx `0x6f124ca0bbf991ed202280dd1b0ff3a6fb9319253c964a7caaf58ef21462e9b6`, block 32, 231,318 gas. In a separate test, two simultaneous workers produced one five-mock-USD repayment at block 40 and consumed the grant once. [Auto-repay receipt](../../evidence/astra/local-auto-repay.json) · [Concurrency run](../../evidence/astra/local-keeper-concurrency.json)
- **X Layer testnet 1952 — NOT DEPLOYED.** The official RPC returned 0 wei for `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67` at block 47,156,264. The official guide documents an address-entry web faucet, up to 0.2 test OKB per day. No supported programmatic claim was identified. [Testnet manifest](../../packages/chain-config/deployments/1952.json) · [Official faucet](https://web3.okx.com/xlayer/faucet/xlayerfaucet)
- **X Layer mainnet 196 — NOT DEPLOYED by Peridot.** All public mainnet actions in this session were reads.

## Commands and results

Commands run from repository root unless they include a directory change. The fork runs require the pinned nodes and build steps in the linked deployment instructions.

| Command | Result |
|---|---|
| `cd contracts && forge build --sizes && forge test --summary` | Build passed with solc 0.8.26, via IR, Forge 1.7.1. 15 passed, 0 failed, 0 skipped (6 market, 4 policy, 5 Sentinel). Warnings include inherited NatSpec, intentional time checks and narrowing/payload casts. |
| `npm ci --workspace @peridot/keeper --workspace @peridot/chain-config --workspace @peridot/circuit-sdk && npm run build --workspace @peridot/keeper` | Fresh isolated install and build passed at 586c400. A root install dry run also passed against all four current workspace manifests. |
| `npm --prefix packages/circuit-sdk test` | Built and passed 9 tests, 0 failed, 0 skipped. Includes six actual public processor responses and policy boundary/encoding tests. A4 separately checked 262 upstream stateless rows and 12 fixture vectors against the TAP reference. |
| `npm --prefix packages/chain-config run generate && npm --prefix packages/chain-config run build && npm --prefix services/keeper run build` | Passed. A6 compared all ten ABI exports against Foundry (311 entries). |
| `python3 -u evidence/a1/verify-public.py` | 451 of 451 processor entries/receipts and six public eval vectors verified. |
| `python3 evidence/a1/replay-fork.py` | From a fresh pinned fork, nine local successful transactions, 12/12 Solidity probe vectors, 12/12 Peridot adapter vectors, and correct short-buffer, stateful and unknown-circuit failure handling. |
| `node contracts/script/deploy-demo.mjs sponsor-fork --source-commit=cc9445a` | 33 local child-fork receipts comprising 31 successful setup/position actions and two expected policy reverts. Journal successfully replayed its results without duplicate writes. |
| `node contracts/script/deploy-demo.mjs local --position` and `node contracts/script/deploy-demo.mjs local --source-commit=cc9445a` | Seeded local product and recovered its original receipts on resume. Verified clean-commit artifact match. Release and unknown deployment profiles rejected before RPC use. |
| `node packages/chain-config/scripts/check-manifest.mjs packages/chain-config/deployments/31337.json http://127.0.0.1:18545` | Verified 13 code addresses at block 40. Replacing the chain ID or a required address with a code-free address correctly failed both negative checks. |
| `KEEPER_CHAIN_ID=31337 KEEPER_RPC=http://127.0.0.1:18545 KEEPER_ACCOUNT=0x8e80FFe6Dc044F4A766Afd6e5a8732Fe0977A493 KEEPER_OPERATOR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 npm --prefix services/keeper run once -- --execute` | One receipt with the 20-mock-USD repayment above. Initial dry-run without --execute returned 20,000,000 raw units. Test uses Node 26.4.0. |
| `node services/keeper/test/local-concurrency.mjs` | Two concurrent instances, one mined repayment, remaining grant 0. |

[Deployment commands](../../contracts/script/DEPLOY.md) · [Architecture and keeper operations](../ARCHITECTURE.md) · [Independent review](../../evidence/a6/review.md)

## Risks, decisions and next work

1. **Organizer and founder.** Request an official chain 1952 deployment/component faucet or a reproducible, licensed source build. Ask whether a testnet lending demo plus public reads and fork-only Peridot circuit IDs qualifies. Sponsor eligibility is unresolved. The founder can use the unsent draft in TAPEOUT_INTEGRATION.md. Any future proposal for public circuit fabrication is a separate decision outside this authorization.
2. **Testnet deployment.** Fund the designated public testnet address using the official faucet. Then deploy using the chain-checked script, record receipts, publish the verified 1952 manifest and notify Fable. Use the named Peridot development reference processor unless an authorized, verified sponsor path becomes available.
3. **Frontend integration.** Fable can consume the ten exported ABIs and the attested local manifest. Wallet signing, frontend receipts and Fable's acceptance remain separate deliverables. The root lockfile includes the keeper workspace, and its clean install has been verified.
4. **Implementation choices.** Each market has one fixed approved pair and independent baseline pToken accounting under a new controller implementing the Peridot controller interface. P1 margin and other historical modules are excluded from the active build. The exact-underlying redeem rounds share burn up and zero-share mints revert. The development registrar attests compiler-spec correspondence. A processor proxy codehash alone cannot pin upgrade authority.
5. **Release.** The test deployment excludes mainnet at construction and script entry. There is no funded production deployment path. A release requires production governance, assets, reliable oracles, liquidation capacity, broader verification and founder approval. An ambiguous keeper broadcast retains a reservation until its hash/nonce are reconciled. [Security model](../SECURITY_MODEL.md) · [Risk model](../RISK_MODEL.md)

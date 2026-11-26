# STATUS

**Updated:** 2026-11-25 (UTC), by Claude
**Current milestone:** M0. The baseline, the chain and TapeOut spike, interface v0, the design system and the app shell are in progress.

## Leads and sessions
| Role | Runtime | Session / handle | State |
|---|---|---|---|
| Claude (orchestrator) | Claude Code, claude-opus-5-5 | this session | active |
| Astra 6.2 | Codex CLI 0.171.0, `gpt-6.2-astra`, sandbox workspace-write@repo, network on, multi_agent_v2 | see "Astra session" below | running |
| Fable 5.2 | Claude Code subagent, `fable` (claude-fable-5-2) | Claude background subagent | running |

Astra session: resume with `codex exec resume <id>`. The ID is recorded below after launch.
- astra-m0: `01a212ed-f090-7143-89e7-8b707c7b7631` (log: `/Users/joshua/Peridot/OKX/.agent-logs/astra-m0.log`)
- astra-s2: same Codex thread resumed (`codex exec resume 01a212ed-…`), JSON event log `/Users/joshua/Peridot/OKX/.agent-logs/astra-s2.jsonl`, brief `.agent-briefs/astra-s2.md`

## Commits
- `fae7cdad` = tag `pre-xlayer-hackathon`, the imported baseline from peridot-contracts-2-5@e08e5363.

## Completed
- Workspace and baseline inspection (see DECISIONS D1–D7).
- X Layer chain IDs verified: mainnet 196, block ~76.84M; testnet 1952, block ~47.15M.
- TapeOut TAP-10 candidates on mainnet all have code:
  - factory proxy 0x1f09, 130 B
  - impl 0x7495, 7671 B
  - beacon 0xf70d, 619 B, `implementation()` = 0x977f
  - processor impl 0x977f, 12562 B

  The same addresses on testnet have no code. The beacon's `owner()` returns 0x0, which still needs interpretation.

## Blockers
- No known TapeOut deployment on testnet 1952 (A1 is searching). See D8.
- Testnet deployer 0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67 holds 0 OKB and needs the faucet.
- No git remote (D5, founder decision).

## Tests and deployments
- Nothing built or deployed yet.

## Update: Astra delivered M0-interface-v1
- INTERFACES v1 committed at `58684b1` and relayed to Fable.
- **Process note:** the Codex sandbox blocks writes to `.git`, so Astra leaves its work in the working tree and Claude commits its reviewed paths with `Agent: astra` attribution.
- **Blocker (M0-testnet-gas):** the X Layer faucet is a web form at https://web3.okx.com/xlayer/faucet/xlayerfaucet (0.2 OKB/day). The founder needs to request OKB for `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67`. Local and fork work continues in the meantime.

## Update: M1 and M2 implemented locally; first real TapeOut evaluation
- **`fe0c60b`** contains Astra's M1 work (PolicyRegistry, TapeOutPolicyAdapter, DevelopmentReferenceProcessor, @peridot/circuit-sdk) and M2 work (MarketFactory, IsolatedController, MarketPToken, mocks).
  - Claude re-ran the tests: `forge test` on test/policies passed 4/4 and on test/markets passed 6/6; `npm --prefix packages/circuit-sdk test` passed 8/8. Nothing failed or was skipped.
  - Baseline deviation in PToken: exact-underlying redeems now round redeemTokens up (ceil), and mints that round to zero shares are rejected.
- **TapeOut mainnet, read-only (evidence/a1/mainnet-reads.json):**
  - Processor CPU 275 `0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`, circuit 1, block 76844958. Its eval matched the pinned TAP Python model on 4/4 truth-table inputs. eth_estimateGas came back at 50,601–51,183.
  - Trust finding: the official factory `0x1f09…` reports itself **unsealed**. Its owner is `0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138`, and the current proxy implementation `0x336e9f0f…ae2a` is not the TAP-10 candidate. The adapter must pin the processor and fail closed, and this belongs in SECURITY_MODEL.
- Still open: fork fabrication of the Peridot policy circuits (A1), any official testnet deployment, testnet gas, and Sentinel (M3).

## Update: TapeOut fork gate passed; M3 runs end to end on a local chain
- **`cc9445a`.** Claude re-ran `forge test` (15/15 passed across 3 suites) and `circuit-sdk` (9/9 passed).
- **TapeOut spike (A1).** On a fork of X Layer mainnet at block 76844958, both Peridot policy circuits were fabricated on the real TapeOut processor `0x4234…00b5`:
  - fork-only circuit IDs 2 and 3; market 63 NAND, account 87 NAND
  - all 12/12 vectors matched
  - Solidity eval gas: market ~176k, account ~230k
  - simulated fees 0.00326 OKB; new CPUs on the factory are priced in BEM
  - no public transaction was sent
- **M3.** SentinelAccount/Factory plus the deterministic keeper, on local Anvil. Keeper tx `0x6f12…62e9b6` repaid 20 mUSD and moved LTV from 5001 to 3751 bps.
- **Open:**
  - the local manifest was built from a dirty tree; Astra will rebuild it from a clean commit
  - testnet gas (founder faucet)
  - official testnet TapeOut deployment and eligibility (organizer)
  - decision D8(b): a mainnet fabrication would cost about 0.003 OKB of real fees

## Update: Astra session 1 ended (exit 0); session 2 started
- Session 2 scope:
  - fix the DEMO_MATRIX chain labels;
  - write the D8(b) mainnet fabrication proposal (prepare only);
  - build the Studio policy registration path (INTERFACES v1.2);
  - add demo operations scripts (price move, liquidation, second market, one-command setup);
  - add an activity read API;
  - run the keeper as a service;
  - deploy to testnet once funded.
- Sub-agent use could not be independently confirmed from the session 1 text log. Session 2 runs with `--json` event logging so that sub-agent activity can be audited.

## Update: M4 local product complete; D8(b) proposal ready for the founder
- **`43f3b60`:** INTERFACES v1.2, with permissionless Studio market templates (Merkle-root proof checked against the real on-chain netlist) and the PolicyAllowed event.
- **`9dcdd95`:**
  - Demo ops: fresh, price, isolate and liquidate.
  - Market B is unaffected by a liquidation in market A.
  - Keeper service with the `/v1/status` and `/v1/activity` endpoints.
  - New v1.2 local manifest.
- **Tests (re-run by Claude):** forge 21/21, circuit-sdk 11/11, keeper tsc ok.
- **D8(b):** `docs/coordination/D8b-mainnet-fabrication-proposal.md` holds three UNSIGNED calls on the existing public CPU 410 (TapeReel, third-party).
  - Estimated cost 0.00327868 OKB (~$0.25), ceiling 0.003321 OKB. No BEM needed.
  - The alternative, a Peridot-branded CPU, costs 0.11 BEM plus ~0.0026 OKB (~$2.30 indicative) and needs BEM bridged from BNB Chain.
  - **Founder approval required. Nothing has been sent.**
- **Sub-agents:** session 2 used A1, A2, A5 and A6, named per notice.

## Update: Astra session 2 closed (exit 0); session 3 started, bounded
- Session 2 closed at `d65e1ea`. The 1952 no-key preflight passed at `a0b0b88`, and the pinned deploy invocation is in `contracts/script/DEPLOY.md`.
- Session 3 (log `.agent-logs/astra-s3.jsonl`) covers four items:
  - answering open Fable requests;
  - `docs/P1_MARGIN_FEASIBILITY.md`, design only;
  - `docs/coordination/RELEASE_GAP_ANALYSIS.md`;
  - cheap targeted hardening.

  It has no deploy authority and no P1 implementation.
- Claude runs a background watcher on the 1952 deployer balance. When it is funded, Claude starts a pinned testnet deploy session.
- Blocked on the founder:
  - the faucet, for both addresses;
  - the D8(b) decision;
  - organizer answers.

## Update: session 3 analysis accepted (`6afa863`); session 4 fixing the rate cadence
- **P1 margin:** deferred. The legacy engine cannot attach to the P0 markets through configuration. A labeled local mock version is estimated at 32–56 agent-hours after P0.
- **Funded release:** all five §12 gates are open. Closing them is estimated at 104–178 agent-hours, so there is no basis for a funded mainnet launch by Dec 6/7. The recommendation is testnet only, plus D8(b) circuit-only evidence.
- **BUG (P0), found by Astra:** the demo rate model uses 2,102,400 blocks/year, but X Layer 196 and 1952 both run 1 block/s (Claude measured 1952: 86,400 blocks in 86,400 s). Accrual is therefore ~15× the displayed APR. Astra session 4 is fixing it before the testnet deploy. Fable has been warned, and the shared node will be redeployed after the fix.
- **Shared local node:** run by Claude at 127.0.0.1:18545, with state persisted. The keeper read service is on :8787 in simulate-only mode.

## Update: frontend integrated with real contracts (local); rate fix live on the shared node
- **`ac9b26a` (Fable).** A browser wallet E2E ran on the shared local chain: Studio create, then supply, activate, Sentinel create/fund/collateral/borrow, then the activity view. It sent 14 txs with 0 reverts. Both rejection states were shown via `eth_call` simulation.
  - Claude verified 4 receipts on chain and reviewed the screenshots in `evidence/screenshots/local-e2e/`.
- **`586af97`.** Rate-cadence fix: forge 24/24, plus a regression test that is red on the old model and green on the fix.
- **`78b2d1a`.** The shared node was redeployed from `ac9b26a`. `blocksPerYear` = 31,536,000 on chain.
- **Fable's next tasks:**
  - independent rejection scenarios (account-only deny; market-only deny via Sentinel)
  - Sentinel operator, revoke, trigger, repay and withdraw writes
  - the keeper API proxy
  - 390px chain-mode checks
- **Still open:**
  - founder: faucet, D8(b), organizer answers
  - Astra session 4 is finishing the preflight on the fix commit

## Update: Fable run 1 complete; Fable run 2 started
- **Run 1** delivered `a6860e6` … `1930865`.
  - All routes exist. In the default build (1952) every route runs in fixture mode.
  - In local chain mode, Studio, supply, activate and the Sentinel create/fund/collateral/borrow flow work, and activity is read from logs.
  - Tests: npm test 31/31, tsc clean, next build passes for both targets. The local E2E passed 3 runs, the latest with 16 txs and 0 reverts.
  - The derived APR matches on-chain `ratePerBlock × blocksPerYear`.
- **Run 2 tasks:**
  1. independent rejections (a 65% and a 50% market vs the 55% account policy);
  2. Sentinel owner writes plus the OwnerOnly view;
  3. a keeper API proxy;
  4. testnet readiness: per-target gating, paginated logs, chain-mode negatives;
  5. 390px chain checks.
- **Process note:** in run 1 the permission system denied Fable starting its own Anvil node. Fable did not work around it. Since then Claude has run a single shared local node (18545) and the keeper read service as orchestrator infrastructure, and Fable uses only that node.

## Update: M4 TESTNET DEPLOYED (X Layer 1952) + live keeper auto-repay
- The founder funded both testnet wallets with 0.2 OKB.
- Deployed from pinned `39c0a54`, after the keyless preflight passed, as `34797b2`:
  - 30 deployer txs (nonces 0..29, no duplicates), costing about 0.00045 OKB;
  - 13 code addresses verified.
- Public testnet auto-repay by the separate operator:
  - tx `0x38cb05f1…f5a77`, block 47161960;
  - LTV went from 5001 to 3751 bps, and the grant budget was consumed.
- **Public RPC flakiness:** some backends serve stale state or no block 0. I committed a bounded genesis-read retry as `39c0a54`, and the journaled resume handled the stale post-write checks.
- **Next:**
  - Fable makes the default 1952 build correct, then runs independent rejections and the owner writes.
  - DEMO_MATRIX 1952 cells still need filling.
  - A fresh testnet keeper demo position is needed before recording.
  - The D8(b) decision and the organizer answers are still pending.

## Update 2026-11-26: rebrand to Peridot Sentinel; scope expansion; M4 report
- **D11 rebrand:** the project is now Peridot Sentinel.
- **D12 scope expansion:** recorded.
- **D13 narrowed plan:** sent for review.
- **D14 D8(b) hold:** in effect.
- Tags: `m4-fallback` (6657771) and `m4-testnet-deployed-src` (39c0a54).
- Fable run 2 stopped on a transient API billing error. Its work was checkpointed in `6657771`, and the model is available again.
- Claude re-verified the independent rejections in `d334494`.
- Running now:
  - Astra session 5: design freeze, then adapters and MCP.
  - Fable run 3: 1952 correctness, rebrand, Automate.
- Docs added: PRIOR_WORK_AND_DIFF, SUBMISSION_EVIDENCE, DEMO_RUNBOOK. The relay report is in `reports/M4-testnet-and-scope.md`.

## Update 2026-11-26 (later): Connect flagship live on testnet; remote created; Astra s6 and Fable r4 running
- **`8ce2329`, Astra session 5 (additive v2):**
  - SentinelAccount v2 and typed adapters;
  - the Uniswap v3 swap, fork-verified against the real router;
  - the EXECUTION circuit;
  - Sentinel Connect MCP (12 tools, one restricted execute);
  - D8b-v2 (three circuits, unsigned, ceiling 0.004647 OKB).
  - Claude re-ran the suites: expansion 15/15, core 24/24, MCP 7/7.
- **Connect flagship on PUBLIC 1952:** tx `0xc5daaf34…0b0f`.
- **Fable run 3** (`3d56dde`…`32648c6`):
  - 1952 browser-verified (44 loads, 0 deployment banners);
  - rebrand, Automate, portfolio, and native mainnet eval for CPU 275.
- **Remote:** `joshschcom/peridot-sentinel`, private, pushed. A fresh-clone `npm ci` plus web build passes (Vercel simulation).
- **Running:**
  - Astra session 6: account-v2 operator enumeration, gas headroom, v2 testnet deploy, mined independent rejections on 1952, activity snapshot indexer, ERC-4626.
  - Fable run 4: Connect UI to "Available on testnet", native eval for the three circuits, v2 UI, Vercel readiness, negative checks.
- **Founder actions:**
  - Vercel import;
  - OKX API credentials;
  - D8b-v2 signing (Nov 28);
  - organizer answers;
  - eventual repo transfer and 2FA.

## Update: ChatGPT accepted M6 (D20); genuine-LLM MCP plan (D21)
- `81fb457`: account v2 now has operator enumeration and `revokeAllOperators` (epoch). Keeper gas headroom raised to +30k. Account tests 10/10.
- **Astra, session 6 (running).** In progress:
  - v2 testnet deploy
  - mined independent rejections
  - indexer
  - ERC-4626

  D20 additions:
  - check the constant-time epoch across every entry point
  - MCP v2 tools with a bounded amount, plus a mined-revert tool
  - indexer hardening
  - D8(b) pre-sign check and post-publish scripts
  - v2 running against the real published circuits on a 196 fork
- **Fable, run 4 (running).** Connect marked as available on testnet; native-eval config for the 3 circuits; v2 UI behind flags; Vercel readiness. D20 adds clean-browser hosted validation, bundle secret scan, and labelling (scripted vs LLM, simulated vs mined, evaluation vs enforcement).
- **Claude.** Will run the headless `claude -p --mcp-config` LLM session on 1952 once Astra's v2 MCP tools land.
- **Founder.** Needed for: Vercel import, OKX credentials (server-side), D8(b) signing on Nov 28 after the pre-sign check, organizer answers.

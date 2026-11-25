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

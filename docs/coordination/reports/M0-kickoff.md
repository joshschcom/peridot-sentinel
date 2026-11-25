# CLAUDE → CHATGPT | Peridot X Layer | M0 | 2026-11-25 (UTC), kickoff

## Executive status
- **Current milestone / overall status:** M0 is underway. The baseline is imported and tagged, the coordination system is live, and both leads are running at the same time.
- **Repository, branch, exact commit(s):** local repo `peridot-xlayer`, branch `main`, with no remote yet (decision 1 below).
  - `fae7cdad` = tag `pre-xlayer-hackathon`, the imported prior work.
  - `76721c6` = hackathon scaffold, agent rules, coordination docs and interface v0.
- **What changed since last message:** this is the first report.

### Actual agent configuration (verified, not assumed)
| Role | What is actually running | Verification |
|---|---|---|
| Claude (orchestrator) | Claude Code, `claude-opus-5-5` | this session |
| **Astra 6.2** | OpenAI **Codex CLI 0.171.0** with model id `gpt-6.2-astra` on the founder's ChatGPT account. Its sandbox can write only inside the repo, with network on. Its multi-agent feature is enabled so it can spawn specialist sub-agents for roles A1–A6. | Codex accepted `gpt-6.2-astra`, and a made-up model id was rejected as a control. In a probe it wrote a file, ran an RPC call and a git network call, and reported spawning a sub-agent. The model reports itself only as "GPT-6", so I cannot independently confirm the ".2" version beyond the id the CLI accepted. Its specialist sub-agents have not yet appeared in the live log. |
| **Fable 5.2** | Claude Code subagent on model `fable` (`claude-fable-5-2`) | Launched through the Agent tool with that model |

**Limitation:** Astra and Fable cannot message each other directly. Astra posts YAML notices to `docs/coordination/MILESTONE_LOG.md`, I watch that file and forward each notice to Fable, and Fable acknowledges in the same log. Astra's Codex session id is recorded in `STATUS.md`, so its work can be resumed after it stops.

## Astra 6.2 — contracts & infrastructure
- **Completed (actual functions/contracts, behavior):** nothing yet; Astra's first session started at kickoff. Claude did the baseline import.
  - Source: `PeridotFinance/peridot-contracts-2-5@e08e5363`, pushed to origin. It continues directly from `main@603e26f3`, 143 commits later.
  - Imported: the Compound-V2-style controller and pTokens, rate models, oracles, debt accounting, the isolated margin engine (55 files), interfaces, proxy, Lens, mock and pancakev3 adapters.
  - Excluded: DualInvestment, Governance, LayerZero, xPeridot, vendor and boosted.
  - Licenses: Compound-derived files are BSD-3-Clause and Peridot files are MIT. **There is no top-level LICENSE file; the founder should confirm the rights.**
- **Tests/build results:** none run yet.
- **TapeOut processor/circuit IDs, gas and chain evidence (Claude, read-only):**
  - X Layer mainnet chain id `196` and testnet `1952` are both confirmed against two RPCs each.
  - **Mainnet:** all four TAP-10 candidate addresses have code:
    - factory proxy `0x1f09…0761` (130 B)
    - implementation `0x7495…d17b` (7,671 B)
    - beacon `0xf70d…991C` (619 B); its `implementation()` returns the processor implementation `0x977f…29B2` (12,562 B)
  - The beacon's `owner()` returns `0x0`. That may mean upgrades are sealed or renounced, but it is not yet interpreted.
  - **Testnet 1952:** there is no code at those same addresses. That does not yet prove TapeOut has no testnet deployment.
  - No circuit has been evaluated yet; that is A1's first task.
- **Deployments and transaction evidence:** NOT DEPLOYED. The new testnet-only deployer `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67` holds **0 OKB**.
- **Known risks, deviations and blockers:**
  1. **TapeOut on testnet is unconfirmed. This is the P0 eligibility dependency.** A1 is searching TAPs, TapeKit and Cerebr for testnet deployments, and will then:
     - read the factory proxy's admin and implementation slots;
     - evaluate a real mainnet circuit and compare it with a local reference;
     - test fabrication on a mainnet fork;
     - check whether TapeOut's own open-source processor can be deployed on testnet. It would be clearly labeled "self-deployed reference, not the official sponsor deployment".
  2. The testnet deployer needs faucet OKB.
  3. **Security context:** a previous Peridot key compromise traces to the 2026-11-02 GitHub breach. In response:
     - every agent is barred from reading anything outside the repo;
     - a fresh testnet-only key was generated;
     - `PeridotV2-Frontend` is treated as untrusted, because its last push lands in the breach window. The frontend is being built fresh.

## Fable 5.2 — frontend
- **Integrated interface version / acknowledged milestone:** building against `INTERFACES v0-provisional`, which I wrote so fixtures share one schema. Astra now owns it and is producing v1.
- **Routes completed and live vs fixture status:** in progress. Scope is the Next.js, viem and wagmi scaffold, the monochrome light/dark design system, the landing page (`/`), the app shell, and every §10.3 route. Five typed services each switch between fixture and chain data. Fixture mode shows a persistent banner and blocks writes.
- **Build, wallet/E2E evidence, screenshots/URL:** pending. Screenshots at 390/768/1440 px in both themes will go to `evidence/screenshots/m0/`.
- **Remaining UI integration dependencies:** the Astra v1 interface, the generated ABIs and the testnet manifest.

## Decisions requested from ChatGPT / founder
1. **Git remote and visibility.**
   - Options: a private repo under PeridotFinance, or one under joshschcom.
   - Recommendation: a private PeridotFinance repo with 2FA enforced, made public at submission.
   - Consequences: a remote is needed for a live Vercel URL and for submission. Not urgent today.
   - Work continuing meanwhile: local commits continue.
2. **TapeOut evidence path, if there is no official testnet deployment (urgent, P0).**
   - Options:
     - (a) a mainnet-fork integration with the real processor, plus a self-deployed reference processor on testnet;
     - (b) the same, plus one founder-approved zero-financial-exposure mainnet fabrication and evaluation, with no custody contracts;
     - (c) ask the organizer to deploy on testnet.
   - Recommendation: run (a) now, ask the organizer for (c) today, and prepare (b) as a costed proposal for approval.
   - Consequences: this decides whether we can claim "real TapeOut integration".
   - Work continuing meanwhile: (a) proceeds.
3. **Organizer question (founder).** Does a testnet-only entry qualify? What X Layer evidence counts, and is there a TapeOut testnet factory or faucet?
4. **Testnet OKB.** Please fund `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67` from the X Layer testnet faucet if Astra cannot do it programmatically.
5. **License (founder).** Please confirm we may reuse the `peridot-contracts-2-5` code, which has no LICENSE file, and choose the hackathon repo license.

## Next milestone
- **Astra tasks (M0→M1):**
  - TapeOut spike evidence in `TAPEOUT_INTEGRATION.md`;
  - the Foundry build of the imported core;
  - INTERFACES v1;
  - `@peridot/circuit-sdk` (compiler and reference evaluator);
  - `@peridot/chain-config` (ABIs and manifests);
  - `PolicyRegistry` and `TapeOutPolicyAdapter`;
  - mock tokens and oracle.
- **Fable tasks:** M0 shell and landing page, then M1 work: the policy wizard, developer evidence views and landing polish.
- **Target / acceptance criteria:** M1 by Nov 28:
  - a real processor evaluation is proven, or the blocker is clearly flagged;
  - the compiler matches the reference evaluator exactly;
  - the UI runs on the v1 schema.

## Pitch-ready evidence
- **New feature or verified proof the founder can cite:** none yet beyond verified chain IDs and the presence of TapeOut contracts on mainnet.
- **Explicit limitations / do-not-claim:**
  - Do not claim a working TapeOut integration, any testnet deployment, or that a testnet-only entry is eligible.
  - Do not claim any audit, partnership or endorsement.

# Peridot Sentinel: prior work and hackathon work

_Maintained by Claude (orchestrator). Last updated 2026-11-26._

The organizers allow reuse of existing code, provided the prior baseline is disclosed. This page is that disclosure.

## The prior baseline

The baseline is everything at tag `pre-xlayer-hackathon`, commit `fae7cda`. None of it was developed during the hackathon.

| | |
|---|---|
| Source | `PeridotFinance/peridot-contracts-2-5` (public) |
| Source commit | `e08e53632fbc3a5f08f7f4d14f45b1ea90e4b2e3`, on origin. It is a linear descendant of `main@603e26f3`. |
| Imported path | `contracts/contracts/` → `contracts/src/core/` |
| Import method | `git archive`, committed tree only, pruned (see `contracts/src/core/BASELINE.md`) |
| What it contains | Compound-V2-derived controller (Peridottroller) and pTokens, interest-rate models, oracles, debt accounting, an isolated margin engine, interfaces, proxy, Lens and mocks. |
| Licenses | BSD-3-Clause (Compound-derived files) and MIT (Peridot files). There is no top-level LICENSE; rights belong to PeridotFinance, which the founder should confirm. |

**Changes to the imported baseline during the hackathon.** There is one file, `contracts/src/core/PToken.sol`, with +4/−1 lines:
- An exact-underlying redeem now rounds the burned shares **up** (it used to round down).
- A mint that would round to zero shares now reverts.

Both close known Compound-fork rounding issues.

**Not reused.** These were inspected but are not used:
- The Soroban/Stellar **Peridot Markets** launchpad. It is a separate product and brand.
- `PeridotV2-Frontend`. Its last push falls in the 2026-11-02 security-incident window, so it is untrusted.
- The legacy margin engine. It was assessed and deferred; see `docs/P1_MARGIN_FEASIBILITY.md`.

## Hackathon work (2026-11-25 onwards)

This is everything after `pre-xlayer-hackathon`, at the time of writing 48+ commits. Line counts are approximate and exclude generated ABIs, evidence and screenshots.

| Area | New code | What it does |
|---|---|---|
| Circuit Engine: `contracts/src/policies/` | PolicyRegistry, TapeOutPolicyAdapter, DevelopmentReferenceProcessor (~260 lines) | Registers TapeOut circuits under verified identity: processor codehash, netlist hash, dimensions and stateless check. Permissionless Studio registration is proven against a Merkle-committed template root. Bounded `staticcall` evaluation that fails closed for risk increases only. |
| Sentinel Studio markets: `contracts/src/markets/` | MarketFactory, IsolatedController, MarketPToken, TestProfile (~490 lines) | Isolated two-book lending markets created by any project. A market-policy hook runs at every risk-increasing entry point, including direct pToken calls. Repay, liquidation and seize are never gated by a circuit. |
| Sentinel accounts: `contracts/src/sentinel/` | SentinelAccountFactory, SentinelAccount (~225 lines) | The account is the real borrower and exposes typed operations only. Operator grants carry an op mask, a cumulative budget, an expiry and revocation. Withdrawals are owner-only. Automated repayment uses the account's own funds. |
| Policy compiler: `packages/circuit-sdk` | TypeScript | A deterministic compiler from PolicySpec to TapeOut NAND netlists, a TAP-02 reference evaluator, a context encoder, and Studio Merkle templates. |
| Chain config: `packages/chain-config` | TypeScript | Generated ABIs, per-chain manifests, and a manifest/bytecode checker. |
| Keeper: `services/keeper` | TypeScript (viem) | Deterministic simulate-then-submit auto-repay with a gas budget, scoped idempotency, a pinned signer key from env only, and a read API. |
| Deploy tooling: `contracts/script` | deploy-demo, verify-build, demo-ops | Pinned-commit, source-attested and journaled deployments, with a keyless preflight. |
| Web app: `apps/web` | Next.js 16, viem, wagmi (~9,300 lines) | Landing page, Sentinel, Markets, Studio and Circuits. Fixture, local and testnet modes. Distinct market-policy and Sentinel-policy rejection states. Browser-wallet E2E. |
| Evidence | `evidence/**` | Mainnet reads, fork fabrication and settlement, local and testnet receipts, screenshots. |

## Agents and attribution

Commits carry an `Agent:` line.
- **Astra 6.2** is `gpt-6.2-astra` via Codex CLI, plus Codex sub-agents A1–A6. Claude commits Astra's work, because the Codex sandbox cannot write to `.git`.
- **Fable 5.2** is `claude-fable-5-2`.
- **Claude** is `claude-opus-5-5`.

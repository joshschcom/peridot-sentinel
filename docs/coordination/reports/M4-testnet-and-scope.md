# CLAUDE → CHATGPT | Peridot Sentinel (X Layer) | M4 | 2026-11-26 UTC

## Executive status
- **Current milestone / overall status:** P0 core is integrated locally and **deployed on X Layer testnet 1952**, with a real public automated repayment. TapeOut evaluation is proven on mainnet (read-only) and on a mainnet fork. The rebrand (D11) and the scope expansion (D12) have been received. A narrowed delivery plan (D13) is proposed below, and work has already started on the parts that are not in dispute.
- **Repository, branch, exact commit(s):** local repo `peridot-xlayer`, branch `main`, no remote yet.
  - Baseline: `pre-xlayer-hackathon` = `fae7cda`.
  - Testnet source pin: `39c0a54`, tagged `m4-testnet-deployed-src`.
  - Fallback: `m4-fallback` = `6657771`.
  - Latest: `e3f039f`.
- **What changed since M0:**
  - M1 through M4 contracts, compiler, keeper and frontend.
  - Testnet deployment.
  - Rate-cadence bug found and fixed.
  - Independent rejections verified.

## Astra 6.2 — contracts & infrastructure
- **Runtime:** `gpt-6.2-astra` via Codex CLI. Codex session logs confirm that its specialist sub-agents A1–A6 really ran as child threads on the same model.
- **Completed:**
  - PolicyRegistry with Merkle-proven permissionless Studio templates, verified against the on-chain netlist.
  - TapeOutPolicyAdapter: bounded staticcall, fails closed for risk increases.
  - MarketFactory and IsolatedController: market hook at every risk entry, including direct pToken calls. Repay and liquidation are never gated.
  - SentinelAccount and its factory: typed ops, operator mask/budget/expiry/revoke, owner-only withdraw, auto-repay.
  - `@peridot/circuit-sdk` compiler and reference evaluator.
  - Deterministic keeper with a read API.
  - Pinned, source-attested, journaled deploy tooling.
- **Tests/build:**
  - Foundry: 24/24 passing, 0 failed, 0 skipped.
  - circuit-sdk: 11/11.
  - Claude re-ran every suite independently before each commit.
  - Targeted regressions cover: direct-entrypoint bypass, policy-offline repay and liquidation, a rejected borrow preserving the operator budget, and rate cadence (failed on the old code, passes on the fix).
- **TapeOut evidence:**
  - Public mainnet read and eval of CPU 275 circuit 1: matches the reference.
  - Peridot MARKET (63 NAND) and ACCOUNT (87 NAND) circuits fabricated on the real processor on a fork; 12/12 vectors match.
  - A Sentinel borrow on the fork was evaluated by both circuits, with one independent rejection from each.
  - Eval gas: about 176k (market) and 230k (account).
- **Deployments:**
  - **Testnet 1952 deployed:** 30 txs, about 0.00045 OKB; MarketFactory `0xEB32…4BC0`. Uses mock tokens, a mock feed and a **development reference processor, which is not TapeOut**.
  - **Public testnet auto-repay:** tx `0x38cb05f18271aae2cc7cb6e40e783f039ff267d72478a64cc92d792de76f5a77`. LTV went from 5001 to 3751 bps and the operator budget was consumed.
  - Mainnet: nothing deployed.
- **Risks and findings:**
  - **Bug found and fixed:** the demo rate model assumed 2.1M blocks/year, but X Layer runs at 1 block per second (31.5M/year), so interest would have accrued about 15× faster than the APR shown.
  - The TapeOut factory is unsealed (it has a UUPS owner). We pin the processor codehash.
  - The public testnet RPC is inconsistent. It is handled with read retries and journaled resume.
  - Gap analysis: all five funded-release gates are open (104–178 agent-hours), so a funded mainnet launch before the deadline is **not feasible**.

## Fable 5.2 — frontend
- **Integrated:** INTERFACES v1.2. Every Astra milestone was acknowledged, and fixes were applied for each correction.
- **Routes (live vs. fixture):**
  - All routes are built.
  - Local chain: live Studio create, supply, activate, the Sentinel flow, owner writes, and an activity view backed by real events.
  - Testnet: in progress. Read-hardening has been checkpointed; browser verification is under way in run 3.
- **Evidence:**
  - Browser-wallet E2E with real receipts.
  - Claude re-verified the **independent rejections**:
    - market cap 65% / account 55% → `AccountPolicyRejected` while the market allows;
    - market cap 50% / account 55% → `MarketPolicyRejected` while the account allows.
  - 50+ screenshots at 390/768/1440 px, light and dark.
- **Underway:** testnet 1952 correctness, rebrand to Peridot Sentinel, the Automate section (rule-based live; BYO agent in development; hosted AI planned), and the emergency revoke.
- **Availability note:** one Fable run stopped on a transient Claude API billing error. Its work was checkpointed, and the model is available again.

## Decisions requested from ChatGPT / founder

1. **D13: narrowed plan for the scope expansion. Please acknowledge or amend.**
   - **P0-expansion** (all additive; the deployed testnet set stays untouched):
     - adapter framework plus SentinelAccount v2;
     - a Peridot lending adapter;
     - **one** external adapter: a Uniswap v3 WOKB/USDC swap. This is the only external venue verified on X Layer so far, and testnet has no Uniswap or Aave code. It will be accepted on a mainnet-fork receipt plus a labelled testnet mock;
     - a minimal MCP server and SDK, with read and simulate tools plus **one** execute tool through the existing restricted operator path, producing a real testnet transaction;
     - OKX Onchain OS for quotes only.
   - **Next, if time allows:** ERC-4626, then Aave V3 (only if verified on chain 196).
   - **Deferred:**
     - concentrated-liquidity lifecycle (design note only);
     - leverage (Astra's study estimates 32–56 hours and recommends deferral);
     - hosted AI (needs a paid API that is not approved);
     - cross-protocol solvency claims.
   - **Cut line Dec 2:** anything not fork-verified and integrated into the UI by then ships disabled and is listed as roadmap.
   - **Rationale:** the handoff forbids multiple half-finished modules. This plan keeps the working demo safe.
   - Work continues meanwhile on the undisputed parts.
2. **D14: hold the D8(b) mainnet circuit signing for about one day** until Astra freezes the expanded policy schema, so that the public circuits are the ones the product actually uses. (It costs about $0.25 either way.)
3. **Git remote and live URL (founder).** P0 needs a public app URL for judges. Recommendation: a private PeridotFinance repo with 2FA enforced, plus Vercel preview, made public at submission.
4. **Organizer.**
   - Does a testnet-only financial demo, plus mainnet TapeOut circuits, qualify?
   - Do circuits on a third-party CPU count?
5. **Claude billing (founder).** A "payment past due / org not allowed" 403 briefly stopped Fable. Please check the Claude subscription, because it could also stop the orchestrator.

## Next milestone
- **Astra (session 5, running):**
  - design freeze: account v2, policy schema, venue verification;
  - adapter framework;
  - Uniswap v3 adapter (fork receipt plus testnet mock);
  - MCP server and SDK with one real testnet execute.
- **Fable (run 3, running):** testnet correctness, idempotent E2E, rebrand, Automate section, portfolio view for real position types.
- **Target:** M5 by Dec 2. It covers the external adapter fork receipt, an MCP agent executing one authorized testnet transaction, a rebranded UI live on testnet, and D8(b) executed if approved.

## Pitch-ready evidence
- **Citable now:**
  - The policy compiler is verified against TapeOut's reference.
  - A real TapeOut processor evaluates Peridot policies (mainnet fork), plus a public mainnet evaluation of an existing circuit.
  - Isolated markets with a non-bypassable market policy.
  - Independent market and user rejections.
  - Automated repayment that is unable to withdraw, with a **public testnet receipt**.
  - Deterministic, reproducible deployments.
- **Do not claim:**
  - public TapeOut IDs for Peridot circuits (pending D8(b));
  - that TapeOut is used on testnet (it is the development processor there);
  - any funded mainnet deployment, audit, partnership, yields or TVL;
  - external adapters, MCP, LP, leverage or hosted AI as live (until there are receipts).

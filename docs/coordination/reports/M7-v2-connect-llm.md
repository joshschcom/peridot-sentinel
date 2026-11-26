# CLAUDE → CHATGPT | Peridot Sentinel (X Layer) | M7 | 2026-11-26 UTC

## Executive status
- **Overall.** Every mandatory item from D15 has public X Layer testnet evidence except four, all of which depend on the founder:
  - the public URL (Vercel import);
  - native TapeOut publication (signing on Nov 28);
  - authenticated OKX quotes (credentials);
  - hosted-app validation (follows the URL).
- **Repository.** Private `joshschcom/peridot-sentinel`, branch `main`, latest commit `3cb36c5`. Tags:
  - `pre-xlayer-hackathon` (baseline)
  - `m4-testnet-deployed-src` (v1 deploy source, `39c0a54`)
  - `m4-fallback` (`6657771`)

  The history audit before the first push found 0 testnet-key hits, 0 private-key blocks and no env or key files.
- **Since M4.**
  - Sentinel v2 was built and deployed alongside v1, which is untouched.
  - Independent rejections are now mined on public testnet.
  - Scripted and **genuine-LLM** Sentinel Connect sessions both ran on public testnet.
  - The ERC-4626 vault sibling is deployed.
  - A constant-time emergency stop runs on public testnet.
  - An activity indexer was added.
  - Read-only D8(b) tooling is in place.

## Astra 6.2: contracts and infrastructure (Codex `gpt-6.2-astra`; sub-agents A1, A2, A5 and A6 are confirmed from Codex session logs)

### Sentinel V2 design decisions
- **Accounts and permissions.**
  - The account is the custodian and borrower, and exposes typed operations only.
  - Adapters are pinned by address, the recipient is always the account, and approvals are exact and cleared after use.
  - Operators get per-call and cumulative budgets with an expiry. Withdrawals are owner-only.
  - Operators cannot change grants, policies or adapters.
- **Policy circuits.**
  - EXECUTION is a **third, independent 20-bit circuit**. Market V1 and Sentinel V1 are unchanged, and existing accounts stay pinned to their versions.
  - Solidity derives every circuit input from on-chain state. Hard limits stay in Solidity: a 500 bps swap-loss maximum against a 100 bps policy maximum.
- **Emergency stop.** `revokeAllOperators()` is a **constant-time epoch increment**. It invalidates every grant across all entry points, including the three vault-operator paths and repay/redeem with live debt, and each has a test.
- **Scope of claims.** No cross-protocol solvency claim is made. Exposure comes from authoritative adapter reads.

### Public testnet 1952 evidence (verified on chain by Claude)

| Item | Transaction / address |
|---|---|
| v2 deployed: factory and account | Factory `0xbdd270a685596452557c8342ca3d39b1133ba7a0`, account `0x7dC8DD13f3C73DaeecAa37cB1f321A08AF741b5f`. 18 receipts; 11 runtime hashes matched |
| Owner lending supply through the adapter | `0x4c26a8c34f906d2979754b6310a529ea4272e845490d52bcc8ab165194f6138b` |
| Mined EXECUTION denial (101 bps loss); grant untouched | `0x2f813549a851fd50e4afc90349e961e39ea39e0115db7cf22e6568e00a8dfa12` |
| Operator swap on the **mock** venue: 1 mWOKB → 79.96 mUSDC to the account | `0x623c753bfc084e370bab5ddde0f3f729ba9372c5de00ea47f12029bb066a672d` |
| **Mined** independent rejection A: ACCOUNT denies at 58% while MARKET allows | `0x4d9730244f37960058310b2ec2d173546634aed58436fa70966e5c2d6a6d4c0b` |
| **Mined** independent rejection B: MARKET denies at 52% (Studio-created 50% market) while ACCOUNT allows | `0xb0981049d5c21deb724ac471709e459da14c81c634b12352925f7829023f4feb` |
| ERC-4626 sibling (**mock** vault): deposit 10, withdraw 2, redeem 4 shares | `0xf56ac33c…ef45`, `0xa0fa9c65…e62a`, `0x00b9a256…cda` |
| Emergency stop: `AllOperatorsRevoked(1)`, operatorCount 0, grant zeroed | `0xcd440b9f2d352d04019283158506f7c9ab40dd6d4b395515a38e8670b2c40f7f` |

### External adapters
- **Uniswap V3.**
  - On a mainnet **fork** of chain 196, against the real WOKB/USDC pool and router: 1 WOKB → 82.164632 USDC, and a 101 bps trade reverted without consuming the grant.
  - On testnet, the swap runs against a labelled mock inventory venue, because testnet has no Uniswap.
- **ERC-4626.**
  - Verified on a **fork** of 196 against the real Spark spUSDC vault: 50 USDC → 49.674782 shares, plus a mined minimum-shares denial.
  - Public testnet uses a mock vault. The UI stays disabled until Fable accepts it, by Dec 2.
  - The factory has only 180 bytes of headroom under the EIP-170 size limit.
- **Aave V3.** Liquid reserves were found on 196, but it is not implemented. It stays conditional, per D15.

### Indexer
- 100-block windows, 12-confirmation checkpoints, ancestry checks, and deduplication by (txHash, logIndex).
- Snapshot covers blocks 47,161,508–47,250,330: 108 events reconciled against 46 successful receipts. Reverts are evidenced separately, from their receipts.
- Refresh every 15 minutes during demos.

### Tests (re-run by Claude)

| Suite | Result |
|---|---|
| Core forge | 24/24 |
| Expansion forge | 23/23 |
| Indexer + MCP v1/v2 | 14/14 |
| D8(b) tools | 2/2 |
| circuit-sdk | 11/11 |

### Risks
- Every testnet asset, feed and venue is a mock. Testnet policy circuits run on the development reference processor.
- The TapeOut factory is unsealed. We pin codehashes.
- The vault factory is close to the contract size limit.
- No funded mainnet deployment exists or is planned before the deadline.

## Sentinel Connect (MCP)
- **Scripted MCP client (v1).** It ran the 7-step flow on public testnet and executed an authorized auto-repay: `0xc5daaf3401cde7a7b1e8f93c97290f8d9711825ba871097af074304340569b0f`.
- **Genuine LLM session (v2, D21).**
  - Setup: `claude-opus-5-5` via headless `claude -p`, with no built-in tools and only 7 restricted MCP tools. The operator key was isolated in the MCP server process. The LLM received only the owner's objective.
  - **The model chose** 0.5 mWOKB, which is within the 1.0 per-call limit and the 1.0 remaining budget, and kept half in reserve as instructed. It set minOut at 39.90 mUSDC, reasoning about the 5 bps fee and the 100 bps policy floor.
  - Swap `0x54d49999e12e1dd0eb6247c54cf76cfec0ec3945e7f2b6c96e994768d5dcb79f`: +39.98 mUSDC to the account; grant 1.0 → 0.5.
  - The borrow attempt was first a **simulated** denial, then a **mined revert**: `0xb50d45edea461c9f6d50e45e28f2faa9ffde4971f02f31909e591b5b1922f7f7` (`OperatorNotAuthorized`, state unchanged).
  - The OKX quote was reported **unavailable** and was not replaced by a mock.
  - Claude and Astra ran the verifier independently and got identical results.
  - Transcript: `evidence/session6-mcp-v2/claude-transcript-7ca689d463331169.ndjson`.
  - This is a **single agent-directed session, not continuous autonomous monitoring.**
- **Guarantees, enforced in contracts.** The agent has no owner key, no withdraw, no permission or policy changes and no arbitrary calldata, and the budget is enforced on-chain.

## OKX Onchain OS
- **Server-side only.** The quote and portfolio clients and the multichain design (X Layer, Ethereum, Base, Solana) are implemented. Unauthenticated probes return HTTP 401 (code 50103).
- **Blocked on founder credentials:** `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`.
- Quotes record timestamp, chain, tokens and amounts, and are informational only (not a solvency oracle).

## Native TapeOut publication (D8(b) / D16)
- **Proposal.** Four calls on existing CPU #410 (TapeReel) publish:
  - Market Policy V1 (63 NAND)
  - Sentinel Policy V1 (87 NAND)
  - Expanded Sentinel Policy V2 / EXECUTION (59 NAND)

  Estimated 0.00459 OKB, ceiling 0.004647 OKB. No BEM and no approvals are needed. 23/23 fork vectors passed.
- **Pre-sign check.** `docs/coordination/D8b-presign-check.sh` is read-only (audited: no signing calls). It passes at block 76,938,913.
- **Post-publish.** `D8b-postpublish.mjs` extracts the public IDs, checks parity against the development processor, measures gas and writes the pinned config for Fable.
- **After publication.** Next: the Sentinel v2 authorization path consuming the **real published circuits on a 196 fork**. A non-custodial mainnet demonstrator would be a proposal only, needing founder authorization.

## Fable 5.2: frontend (Claude `claude-fable-5-2`)
- **Run 3** (`3d56dde`…`32648c6`):
  - 1952 was browser-verified over 44 page loads with 0 deployment banners.
  - Rebrand to Peridot Sentinel, the Automate section with an emergency stop, the portfolio, and a native read-only mainnet eval page (CPU 275; ours show "Not yet published").
- **Run 4** (in progress; checkpoint `0913c4b`): Trade page, v2 portfolio rows, mined denials, activity snapshot, and Connect availability.
- **Labelling** keeps these pairs distinct: scripted vs. LLM, simulated vs. mined, evaluation vs. enforcement, V1 vs. V2, mock vs. real.
- **Build.** A fresh clone builds with `npm ci` plus `npm run build -w @peridot/web`. Hosted clean-browser validation follows the Vercel URL.

## Decisions / founder actions
1. **Vercel import.**
   - Settings: root `apps/web`; install `npm ci`; build `npm run build -w @peridot/web`; Deployment Protection off; no env vars required.
   - Blocks: the public URL and hosted validation.
2. **OKX credentials** (server-side env only). Blocks: the mandatory quote integration and the multichain stretch.
3. **D8(b) signing on Nov 28** after the pre-sign check. Blocks: public Peridot circuit IDs and native-enforcement-on-fork.
4. **Organizer.** Two questions: is testnet finance plus mainnet circuits eligible, and does a third-party CPU count?
5. **Later.** Transfer the repo to PeridotFinance, enforce 2FA, and repeat the full-history secret review before making it public.

## Next (feature freeze Dec 2)
- **Astra:**
  - D8(b) post-publish parity and the v2-on-fork path against the real circuits;
  - OKX quotes once credentials exist;
  - support for UI acceptance;
  - the final evidence pack.
- **Fable:**
  - finish run 4;
  - hosted validation;
  - vault UI acceptance (or keep it disabled);
  - native eval for our published circuits;
  - demo polish.
- **Claude:** integration, the demo runbook, the submission evidence, and the final secret review.

## Pitch-ready (cite)
- **Agent-directed finance with on-chain limits.** An LLM chose and executed a bounded trade, and an unauthorized action was mined as a revert. Both are on public testnet.
- **Independent market and user policies.** Each rejects separately, as mined reverts.
- **Constant-time emergency revoke**, run on public testnet.
- **Typed adapters:** Uniswap V3 and ERC-4626 verified against real mainnet contracts on a fork, with labelled mocks on testnet.
- **TapeOut.** Real-processor evaluation (public read plus fork). Public Peridot circuits are pending signing.

## Do not claim
- Public Peridot TapeOut IDs before Nov 28.
- TapeOut on testnet. It is the development processor.
- Real swaps or vault deposits on testnet. They are mocks.
- Continuous autonomous AI.
- OKX quotes as live.
- Aave, concentrated liquidity or leverage.
- Any audit, funded mainnet deployment, yields or partnership.

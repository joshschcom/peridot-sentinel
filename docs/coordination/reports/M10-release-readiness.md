# CLAUDE → CHATGPT | Peridot Sentinel (X Layer) | M10 release readiness | 2026-11-27 UTC

## Executive status
- **D24 items.** Every item that doesn't depend on the founder is done and independently verified by Claude, except one: registry discovery in the UI. That is Fable run 8, now in progress.
- **Repository.** Private `joshschcom/peridot-sentinel`, branch `main`, latest commit `d4bae74`.
- **Unchanged.** The public testnet v1/M4, v2 and vault deployments, and the enabled v2 and vault owner UI.
- **Founder dependencies:** the Vercel URL, the OKX credentials, D8(b) signing on **Nov 28**, and the organizer's answer.

## 1. Strategy-adoption signing gate (D24 §2): PASSED on the final code
- **What it is.** A single command, `apps/web/scripts/strategy-gate.mjs`, written by Fable. Claude **re-ran it independently** on `e95da1e` from a clean tree, against a fresh private fork of 1952 at block 47,318,780.
  - It uses the committed manifests and switches, with only the RPC re-pointed.
  - It uses three production builds: exact, tampered-lending and tampered-v2.
  - Result: **PASSED, not provisional.** 17 app transactions, 8 operator transactions sent by the script, 0 page errors.
  - Evidence: `evidence/fable/run7/strategy-gate-run-20261127-110740.json`. Fable's own pass on `5180c8b` matches.

| Property | debt-protection-v1 owner / fresh | restricted-swap-v2 owner / fresh |
|---|---|---|
| Unverified deployment cannot authorize (2 tampered builds + blanked `eth_getCode`) | PASS / PASS | PASS / PASS |
| Import grants nothing (paste and file; zero wallet requests, on-chain state unchanged) | PASS / PASS | PASS / PASS |
| Creator gets no authority (authority fields rejected; only the adopter-selected operator is granted) | PASS / PASS | PASS / PASS |
| Reviewed operation = mined calldata, byte for byte (operation, human-unit budgets, UTC expiry, full account and operator) | PASS / PASS | PASS / PASS |
| Unsupported schema, policy, adapter, factory, circuit, netlist or chain rejected with a visible reason | PASS / PASS | PASS / PASS |
| Revocation after adoption (plan revoke; v2 also `revokeAllOperators`; then a mined operator revert) | PASS / PASS | PASS / PASS |

- **Fresh wallet.** A newly generated wallet with no Sentinel account reached adoption through the app for both templates. Portfolio created its v1 account; Trade created its v2 account and minted test assets.
- **Bugs found and fixed by the gate:**
  - a plan could be requested before deployment verification finished (signing was already locked);
  - v2 templates now require full v2 verification;
  - the review now shows human units, the UTC expiry and full addresses;
  - refused imports now name the field;
  - a wallet with no account now gets a path forward.

## 2. Hosted-check environment (clarification)
- The completed "clean-browser hosted check" (run 6 and run 7) ran against **`next start` of the production build on loopback (127.0.0.1)**, with fresh browser profiles and a bundle scan. It was **not** run against a hosted URL.
- The public Vercel deployment still needs its own run: `BASE_URL=https://<url> node scripts/hosted-checks.mjs`. It runs immediately once the URL exists.

## 3. Activity snapshot: reproducible refresh and recovery
Astra session 9 added this to both the shared snapshot and the judge snapshot.
- **Append-only segments.** If the RPC prunes history, earlier verified events keep their original block hashes and receipts.
- **Re-anchoring.** A re-anchor needs two public RPCs to agree on the anchor block, its transactions and the receipt-backed events. It records a permanent `history-unavailable` gap with exact heights.
- **Fail closed.** Conflicts, missing receipts or network errors leave the last candidate intact.
- **Usage.** One portable command; `--output` previews, and only an explicit `--publish` updates the committed file.
- **Tests and live check.** 25/25 tests pass, including simulated pruning, re-anchoring and fail-closed cases. A public read-only preview kept all 108 committed events and found 59 new ones. The committed snapshots were not refreshed.
- **UI.** Fable's UI shows each segment and each gap with its reason and range. It never presents disjoint segments as one checked range, and it withholds the live merge when the checkpoint conflicts or can't be read.

## 4. Commercial copy (D24 §3), Fable run 7

| Where | Before | After |
|---|---|---|
| Landing, Build | "Export a strategy as JSON with a content hash" | "Create and share your own strategies, or launch a lending market with rules you define." |
| Landing, Discover | "No invented returns, TVL or user counts" | "Discover reusable financial strategies. See exactly what each one may do before you adopt it." |
| Landing, AI | "Your model. Your machine. A grant instead of a key." | "Connect your preferred compatible AI." (small print: no hosted model; nothing acts between sessions) |
| Strategies, import | "Import a strategy" | "Adopt a strategy someone shared … You stay in control." |

- **Disclosures.** One disclosure line always shows on `/`, `/discover`, `/strategies` and `/connect`: testnet · test tokens with no value · mock feeds and venues · development reference processor · not audited · only the owner can withdraw. Each item has detail behind "What this means", and the check scripts assert all six.
- **Available vs Planned.** "Available" is a filled pill. "Planned" is a dashed, muted band with no link or button, and the checks assert this from computed styles.
- **Unchanged.** The D23 headline, tagline, pillars and CTAs.

## 5. Public strategy registry (D24 §4): deployed on testnet; UI integration in progress
- **Contract.** `StrategyRegistry`, about 1.7 KB of runtime with no admin or upgrade functions and no fees.
  - Creator is `msg.sender`. Each creator series has sequential, immutable versions.
  - Full canonical JSON is stored on-chain (up to 8 KB), so retrieval does not depend on an indexer.
  - Indexed topics: chain, adapter version, policy key. The `StrategyPublished` event serves discovery.
  - Tests: 8/8 forge, including two 256-case fuzz targets on hashes and immutability.
- **SDK.** `packages/strategy-sdk/registry.ts` (18/18 tests). Before anything is adoptable, it verifies the pinned runtime, event identity, raw byte hash, canonical form, the unchanged existing validator and the index labels. A mismatch is a hard reject. Agent instructions stay inert text.
- **Rehearsal.** On a private fork, an independent wallet created its own accounts, adopted both templates and revoked them. The creator's authority stayed at zero.
- **Public 1952** (Claude reviewed the source, then deployed; creation and runtime hashes verified on both RPCs):
  - registry `0xB1BE0326E007e2719CdBBd61D8E26356d39F28ed`, tx `0x6c63df20779831a7c5e510a39198332917c467573b62fd8f9ad7ac1229e1f28d`, block 47,314,090;
  - curated v1 publications: debt protection `0x356c55ed170d00420f47c2e80e51bbaf3e4588fa0f2e0d50d7ddb7f628d57992` and restricted swap `0xa0a8274fe5166b349727be52263fad9cc921a876f19e00039be4b8d0f8dc457e`.
  - Claude checked independently that the stored bytes equal the canonical committed templates, and that the stored hash, event hash and recomputed keccak agree. No public adoption or grant was made.
  - Total test-OKB cost was about 0.00005.
- **UI (Fable run 8, in progress).**
  - A "Published on testnet" tier in Discover, showing creator and version, with adoption only after full verification and only through the existing review.
  - The gate is extended with a registry-sourced adoption and a tampered publication.
  - If this is not clean by Dec 1, it ships disabled, curated templates and import remain, and public publishing is listed as roadmap.

## 6. Native TapeOut (Nov 28)
- **Pre-sign check.** The read-only pre-sign check passed at 196 block 77,002,152. CPU #410 has 9,837 NANDs available and 209 are needed. The ceiling is still 0.004647 OKB.
- **Founder step before signing.** Re-run the check with the signing wallet's public address; its balance has not been checked yet.
- **Fork rehearsal (FORK) of the whole post-publication chain:**
  - 23/23 parity with the development processor;
  - 61 receipts, including 12 intended reverts;
  - all 18 financial traces made **zero development-processor calls**;
  - boundary cases: the next basis point fails, and repayment succeeds during a processor outage.
- **Separation of fork data.** Fork output can no longer write the app's public `tapeout-196.json`. All three public IDs are still null.
- **Non-custodial demonstrator.** This remains a proposal only and needs founder authorization.

## 7. Demo runbook (D24 §7)
`docs/DEMO_RUNBOOK.md` is rewritten to the requested 0:00–3:00 sequence, with the LLM-directed Connect session as the flagship.
- Every segment is labelled by environment and as "Live" or "Recorded <date>". Recorded on-chain steps show their tx hashes.
- The business model is described as revenue candidates only, none live.
- The longer judge walkthrough stays in `docs/JUDGE_DEMO.md`.
- Commands are portable, using `$PERIDOT_KEY_DIR` outside the repo.

## 8. Portability and secrets
- **Docs.** `AGENTS.md`, the runbook, STATUS and Astra's docs now use repo-relative paths and `$PERIDOT_KEY_DIR`.
- **Scans.** Tracked-file and git-index scans found no key files, `.env` files, credentials or private-key blocks.
- **Personal paths that remain** (flag for the go-public decision; no history rewrite):
  - one old MILESTONE_LOG entry (append-only);
  - two evidence files, one of which is the verbatim LLM transcript;
  - git history.
- **Repository size.** About 490 MB of tracked evidence screenshots. New evidence is now kept lean.

## Founder actions
1. Vercel import (root `apps/web`; `npm ci`; `npm run build -w @peridot/web`; Deployment Protection off), then send the URL.
2. OKX credentials as server-side env (`OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`).
3. **Nov 28:** run `sh docs/coordination/D8b-presign-check.sh` with the signing address, then sign the 4 transactions (ceiling 0.004647 OKB). After that, Claude and Astra run the documented post-publication sequence.
4. The organizer question about the testnet-finance plus mainnet-circuit arrangement.

## Do not claim
- Public Peridot TapeOut IDs before they are signed and verified.
- TapeOut on testnet.
- Real swaps or vaults on testnet.
- Continuous autonomous AI.
- Live OKX quotes.
- A hosted-URL validation.
- An audit, yields, users or partnerships.
- Registry discovery in the UI, until run 8 passes.

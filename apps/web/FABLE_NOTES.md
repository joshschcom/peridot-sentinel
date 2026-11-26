# Fable notes — apps/web

Working notes for the frontend lead. Read this first when resuming.

## Commands (run from `apps/web`)

| Command | What it does |
|---|---|
| `npm install -w @peridot/web` (from repo root) | Installs only this workspace. Hoists to root `node_modules`, touches the root lockfile (owned by Claude: never stage it). |
| `npm run dev -- -p 3210 -H 127.0.0.1` | Dev server. `predev` runs `scripts/sync-manifests.mjs`. |
| `npm run build` / `npm run typecheck` / `npm test` | Production build, `tsc --noEmit`, `node --test` unit tests (no extra test deps). |
| `npm run check:tokens` | Fails on hardcoded colours, gradients, shadows or default-palette classes in `src/`. |
| `PLAYWRIGHT_BROWSERS_PATH=0 npm run screenshots` | Route checks + interaction checks + evidence screenshots. Needs a server on `BASE_URL` (default `http://127.0.0.1:3210`). `--checks-only` skips PNGs. Browser lives in `node_modules` (`PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium-headless-shell`). |
| `NEXT_PUBLIC_WALLET_FIXTURE=wrong-network npm run dev` + `WALLET_CHECK=wrong-network npm run screenshots` | Exercises the wrong-network banner with the in-memory example wallet. |
| `NEXT_PUBLIC_PERIDOT_TARGET=local` | Targets the local Anvil deployment (31337, RPC `NEXT_PUBLIC_LOCAL_RPC_URL`, default `http://127.0.0.1:18545`). Label becomes "Local development chain". |
| `PERIDOT_DEPLOYMENTS_DIR=<dir>` | Override the manifest directory for testing the manifest-present path without touching `packages/`. |

Always kill only the dev server PID you started. Astra shares the machine: never `pkill node`.

## Architecture in one page

- `scripts/sync-manifests.mjs` copies `packages/chain-config/deployments/*.json` and the evidence files into `src/generated/` (gitignored). Nothing is statically imported from a path that may not exist.
- `src/lib/manifest.ts` validates a manifest (`absent | invalid | not-deployed | deployed`). `src/services/runtime.ts` resolves, once, the mode of each service: **chain only if the manifest is `deployed` AND `CHAIN_IMPL_READY[service]` is true**. The fixture banner, the write lock (`useWriteGate`) and the service registry (`src/services/index.ts`) all read that one object.
- Swapping a service to chain = implement it in `src/services/chain/`, flip its flag in `runtime.ts`. Components only use `services` / hooks in `src/hooks`.
- Chain stubs return `unavailable`, never fixture data. `Maybe<T>` (`src/lib/maybe.ts`) keeps "unavailable" distinct from zero everywhere.
- Amounts: `src/lib/amount.ts` (bigint only, strict parser that rejects instead of rounding). bps values are plain integers.
- Policies: `src/lib/policy.ts` wraps `@peridot/circuit-sdk` (real compiler, context encoder, NAND reference evaluator, v1.2 Studio template + Merkle proof). Local evaluation is always labelled "Local preview (reference evaluator)".
- Fixture decision order mirrors the contracts (`src/services/fixture/preview.ts`): Sentinel path = account policy → protocol (`Inactive`, caps, `InvalidOracle`, `InsufficientLiquidity`) → market policy. Direct path skips the account policy.
- Errors: `src/lib/errors.ts` maps contract error names to friendly text by category. `market-policy`, `account-policy`, `policy-unavailable` and `protocol` are four different UI states (`RejectionCallout`).
- Evidence (`src/lib/evidence.ts`) is real recorded data, not fixtures: public mainnet read, mainnet-fork policies + settlement, local auto-repay receipt. Each has a fixed provenance label; only the public mainnet fabrication tx gets an explorer link.
- Theme: `light-dark()` tokens in `globals.css`; `data-theme` only when the user chose; `localStorage["peridot-theme"]`.
- Tx feedback: `TxFeedback` renders a `TxState`. `useSimulatedTx` drives it in fixture mode ("Simulation · nothing sent"). A wagmi-backed driver must produce the same `TxState`.

## Honesty rules I hold myself to

- Fixture records have no addresses and no tx hashes. Explorer links only for live data on 1952/196.
- Anything from a fork or local chain carries its label and is never linked to a public explorer.
- The development reference processor is never called TapeOut.
- No APY promises, no audit badges, no sponsor logos. Landing "status" section is derived from evidence + manifest so it cannot drift.

## State after the local wallet E2E (2026-11-25)

- **Fixture mode (default target, testnet 1952):** unchanged. Manifest says not-deployed, so every route shows labelled example data and writes are locked.
- **Chain mode (`NEXT_PUBLIC_PERIDOT_TARGET=local`, shared Anvil at `http://127.0.0.1:18545`):** implemented and exercised.
  - `src/services/chain/client.ts`: generated ABIs, manifest addresses, `verifyDeployment()` (chain id, bytecode at every manifest address, template root == SDK root == manifest root). Reads and the write gate both require it.
  - `src/services/chain/reads.ts`: markets, positions, Sentinel accounts, policy identification (rules shown only when BOTH hashes match a compiled candidate; else "Rules unavailable"), `previewOnChain` (controller.previewPolicy + `simulateContract` of the real entrypoint as the wallet; the decisive error comes from the simulation).
  - `src/services/chain/tx.ts` + `src/hooks/use-chain-tx.ts`: write driver (simulate, send, receipt) producing `TxState`; invalidates all queries afterwards.
  - `src/services/chain/plans.ts`: the exact calls behind each action (exact-amount approve, fund-by-transfer, enter collateral, Studio v1.2 three-step flow, account creation, activation, test-token mint).
  - Activity: `PolicyAllowed` + `AutoRepayExecuted` logs with tx hashes. Local hashes are never explorer-linked.
- **E2E:** `scripts/e2e-local.mjs` (server: `NEXT_PUBLIC_PERIDOT_TARGET=local npm run dev -- -p 3211 -H 127.0.0.1`). Injected EIP-1193 test provider forwarding to Anvil's unlocked account #3; no private key. Re-runnable: it creates its own market each run and reuses the 55% policy once registered. `--activity-only` is read-only. Evidence: `evidence/fable/local-e2e.json`, `evidence/fable/local-e2e-first-full-studio-run.json`, `evidence/screenshots/local-e2e/`.
- **Not done:** keeper read API (`/v1/status`, `/v1/activity`) is not consumed; Sentinel policy/operator writes (`setPolicy`, `setOperator`, `revokeOperator`, `setAutoRepayTrigger`, `withdraw`) are still locked buttons; repay and withdraw were not exercised in the E2E (the code paths exist); `/sentinel/policy` in chain mode edits a draft but cannot register a new ACCOUNT policy (the registry is curated for account policies); real wallet extensions (OKX Wallet, MetaMask) have never been used; chain mode has no mobile-width checks.
- **Dev-server gotcha:** editing a component while `next dev` runs can leave the server render of some routes stale and produce a hydration mismatch. Restart the dev server before an evidence run.
- **APR:** `ratePerBlock * blocksPerYear()` read from chain; nothing is hard-coded, so the `M5-rate-cadence-fix` redeploy needs no code change.

## Run 2 (2026-11-26, commits dbd424e and checkpoint 6657771): DONE, was never written down here

- Independent rejections in `scripts/e2e-local.mjs` (market A 65% cap → `AccountPolicyRejected` while the market allows; market B 50% cap → `MarketPolicyRejected` while the account allows). Verified on chain by Claude's re-run (`evidence/fable/local-e2e-run-20261126-133424.json`).
- Sentinel owner writes (`setOperator`, `revokeOperator`, `setAutoRepayTrigger`, `repay`, `withdraw`) and the operator probe ("Check what it can do": eth_call as the operator, `OwnerOnly`).
- Keeper read route `src/app/api/keeper/route.ts` (server-side, `KEEPER_API_URL`, GET only, scope checks) and `KeeperPanel`.
- Testnet hardening: `src/lib/retry.ts` (reads only), `scripts/chain-checks.mjs` (negative paths + `testnet-live`), watch-only test wallet.

## Run 3 (2026-11-26): state

**Testnet 1952 is live in the default build** (manifest `deployed`, deploymentBlock 47161508). Verified in a real browser with `scripts/chain-checks.mjs testnet-live` against `next start` (reads only, two watch-only wallets, 1440 and 390 px): 36/36 page loads, 0 deployment banners, 0 page errors. Result and screenshots: `evidence/screenshots/testnet-1952/`.

- **RPC facts (measured 2026-11-26).** `eth_getLogs` is capped at 100 blocks on both official endpoints, with or without the documented `/terigon` suffix. Blocks come about once per second (about 86,000 per day), so a full scan from the deployment block is NOT possible from the browser: one day is ~860 requests per event filter. Block 0 is missing on roughly half the backends; bytecode reads were consistent in 32/32 samples.
- **Log scans read both ends** (`scanPlan` in `src/lib/log-pages.ts`, used by `scanLogs` in `src/services/chain/client.ts`): the first `LOG_EARLY_PAGES` (10) pages from the deployment block and the last `LOG_MAX_PAGES` (40) pages to the head. The unread gap is stated in the UI with exact block numbers (`LogCoverageText`), and "Scan more blocks" doubles both ends. The recorded public auto-repay (452 blocks after deployment) is found by the scan itself. **Open issue:** activity between the two ends is invisible until an indexer or a testnet keeper read API exists. The gap grows daily.
- **Explorer root** `https://www.okx.com/web3/explorer/xlayer-test` matches the official network-information page (rendered with Playwright 2026-11-26; the page is client-rendered, plain fetches see nothing). Faucet `https://web3.okx.com/xlayer/faucet/xlayerfaucet` resolves to "Claim test OKB on X Layer". The docs list the RPC as `https://testrpc.xlayer.tech/terigon`; the bare host used here (AGENTS.md) behaves the same.
- **Checker trap:** `locator.innerText()` on an absent element waits Playwright's 30 s default. `testnet-live` sets `page.setDefaultTimeout(2500)` after the page settles; without it one run takes about an hour.
- **Keeper on 1952:** no testnet keeper service exists. With `KEEPER_API_URL` pointed at the local keeper, the 1952 build answers `scope-mismatch` and shows no rows (asserted).
- **Testnet rejection, read-only:** as the demo owner (watch-only), a 12 mUSD Sentinel borrow on market #0 is stopped by the account policy (57.51% > 55%) while the market policy (65%) would allow it. It is an eth_call simulation, labelled "Simulation · nothing sent". The market-only rejection needs a second market with a lower cap, which needs a funded wallet: it stays local-only.

**Rebrand (D11):** copy only, routes unchanged. `src/lib/brand.ts` holds the names and the `Availability` type (`live | development | planned`). Wordmark in `src/components/shell/brand.tsx`. Navigation in `src/components/shell/app-shell.tsx`: Overview (`/sentinel`), Earn (`/markets?view=earn`), Borrow (`/markets?view=borrow`), Trade (planned, not a link), Automate (`/automate`), Studio; then Circuits, Connect (`/automate#connect`, "In development"), About. Phone: four tabs plus "More". Earn and Borrow are real views: different lead columns, and the market page opens on the matching action.

**Automate (`/automate`, `src/components/pages/automate.tsx`):** three modes with availability badges; the strategy outline maps six fields to what enforces them (live: objective/trigger, budget, operations mask, expiry; planned with no input: approved protocols, other objectives, slippage limits); the live inputs are the `Automation` panel (moved to `src/components/pages/automation.tsx`); **Emergency stop** = `emergencyStopPlan` (revoke every operator, then clear the trigger; steps that are already done are skipped; partial completion is shown per step). To flip Sentinel Connect to available, change `CONNECT_AVAILABILITY` in `automate.tsx` only after Astra's MCP flow is verified on testnet.

**Portfolio (`src/components/pages/portfolio.tsx`):** one position type, Peridot lending, per market, held by the Sentinel account or the wallet. Add rows for other types only when their adapters are deployed.

**Native TapeOut evidence (`src/components/pages/live-eval.tsx`, `src/services/chain/mainnet-eval.ts`):** on `/circuits`, the browser calls `circuitInfo`, `netlist` and `eval` on the public processor on chain 196 (CPU 275, circuit 1, from `evidence/a1/mainnet-reads.json`) and compares with the recorded reference. Labelled "not a Peridot circuit". Add Peridot's circuits when their mainnet IDs exist.

## Answers from Astra (M4-testnet-preflight-and-frontend-reads, f88817a)

- **Check order:** do not hand-order in chain mode. Resolve the first failure with `simulateContract` as the actual caller on the actual entrypoint. Facts: `Inactive` is borrow-only; supply/borrow caps come before the oracle and the adapter; Sentinel operator and account checks come before the pToken hook. (The fixture preview treats `Inactive` as blocking collateral supply too: fix when touching `fixture/preview.ts`.)
- **Rates:** per-block WAD rates. Simple APR (WAD) = `ratePerBlock * blocksPerYear()` from `DemoRateModelAbi`. Label "APR (simple, variable)". Never APY.
- **Manifest:** `capabilities.studioMarketTemplateRoot` and `deploymentBlock` are in every deployed manifest.
- **Explorer:** `/tx/<hash>` and `/address/<addr>` only for public-chain data. Never link local or fork hashes. No automated link checks (explorer 403s bots).
- **Operator withdrawals:** revert `OwnerOnly()`; revocation emits `OperatorRevoked(operator)`.

## Local deployment probe (read-only, 2026-11-25)

`packages/chain-config/deployments/31337.json` resolves to `deployed` under `src/lib/manifest.ts`. Manifest root == SDK `STUDIO_MARKET_ROOT` == on-chain `PolicyRegistry.MARKET_TEMPLATE_ROOT()` on `http://127.0.0.1:18545` (chain id 31337, 10/10 manifest contracts have code, `marketCount()` = 1 at probe time). `@peridot/chain-config` is NOT linked in root `node_modules` yet: adding it as a dependency needs a root install and a lockfile refresh (Claude owns the lockfile).

## Settled for the E2E (no longer open)

1. ABIs: add `@peridot/chain-config` to `apps/web/package.json`, `npm install -w @peridot/web` from the root, leave the root lockfile unstaged and name it in the report.
2. `PolicyRecord.spec` recovery: market policies from `MarketTemplateRegistered(policyId, processor, maxLtvBps, requireCashReserve, configHash)`; account policies by matching `configHash` against the manifest's ACCOUNT circuit / known sample spec, otherwise show "rules unavailable" with the hashes.
3. Test account: an unlocked Anvil account that is neither the demo owner (#0) nor the keeper operator (#1), with its own market and Sentinel account; injected EIP-1193 provider forwards to Anvil (no private key in the repo).
4. `TestnetToken.mint(address,uint256)` and `DevelopmentReferenceProcessor.addReferenceCircuit(bytes)` are permissionless (read from source), so a non-deployer can fund itself and add a circuit.

## Traps to remember when implementing chain mode

- Flip `market` and `account` readiness together: a fixture Sentinel account references `example-0`, which a chain MarketService will not have.
- The decisive rejection comes from `simulateContract` as the actual sender on the actual entrypoint. Do not port the hand-ordered fixture logic.
- pToken `redeem` is in shares. Hide Withdraw in chain mode until amounts are converted (or use `redeemUnderlying` for the direct path).
- The write gate currently checks only the wallet's chain id. Chain mode must also verify `eth_chainId` and bytecode at every manifest address in-app, and read `MARKET_TEMPLATE_ROOT()` for the Studio root gate (`studio-create.tsx` passes "unavailable" today, so Create can never enable).
- Keeper API (`/v1/status`, `/v1/activity`) through a server-side proxy route; show rows only when chain, factory, account and operator match the account being viewed.
- E2E screenshots go in a new folder (not `evidence/screenshots/m0/`); local hashes are never explorer-linked.
- Re-run the fixture-mode checks on the default target after every flag flip.

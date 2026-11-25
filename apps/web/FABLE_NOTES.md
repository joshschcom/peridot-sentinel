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

## Next (assigned by Claude after the E2E was accepted; NOT started)

1. **Independent rejections for the demo.** In the current E2E both caps are 55%, so neither rejection is independent. Needed, both through the Sentinel path: (a) market cap 65%, account policy 55%, borrow to ~60% → account rejects, UI says the market would have allowed it; (b) market cap 50%, account policy 55%, borrow to ~52% → market rejects while the account policy genuinely passes. Have `scripts/e2e-local.mjs` create both markets via Studio. Check that "Before you sign" shows the non-rejecting layer truthfully (a later layer currently reads "Not reached on chain. Local run of the same circuit: allow", which is fine as long as it stays labelled).
2. **Sentinel owner writes:** `setOperator` (repay-only, budget, expiry), `revokeOperator`, `setAutoRepayTrigger`, `repay`, `withdraw` (owner-only), plus an "operator cannot withdraw" view backed by an `OwnerOnly` simulation. Exercise them in the E2E.
3. **Keeper read API** via a Next.js server-side route proxying `127.0.0.1:8787` (env-configured, GET only, scope checks per INTERFACES v1.2). Show simulated / submitted / success on `/sentinel/activity`. Then ask Claude to run one execute cycle to capture a real auto-repay receipt in the UI.
4. **Chain-mode checks at 390 px** for the core demo routes, no horizontal scroll.

Rules: shared node only (`http://127.0.0.1:18545`), accounts #3-#9, no price moves or liquidations (ask Claude). The node was redeployed with the rate-cadence fix (`blocksPerYear()` = 31,536,000); the E2E was re-run on it and passed.

Also still open from before: chain-mode negative paths are untested (wrong network through the real wagmi path, a failing deployment check, a tampered manifest); `screenshots.mjs` assumes fixture mode (example ids, fixture banner) and will need a chain-mode variant before the 1952 manifest flips to `deployed`; log queries are not paginated.

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

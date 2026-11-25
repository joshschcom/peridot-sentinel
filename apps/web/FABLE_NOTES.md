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

## State at end of M0 run (2026-11-25)

- All routes built in fixture mode. Chain implementations for market/account/policy/activity are stubs.
- Interfaces consumed: INTERFACES v1, v1.1 supplement (Sentinel semantics), v1.2 (Studio template + root gate in the wizard; error names). Not yet consumed: generated ABIs from `@peridot/chain-config`, `PolicyAllowed` events, keeper read API.
- Local target plumbing exists (`NEXT_PUBLIC_PERIDOT_TARGET=local`, manifest validation accepts the local profile) but no on-chain reads yet.

## Next (in order)

1. `chain` MarketService against local Anvil: `marketCount/marketAt`, controller reads, `previewPolicy`, token metadata, prices. Verify chain id + bytecode before enabling writes. Add `@peridot/chain-config` as a dependency for ABIs.
2. wagmi write driver producing `TxState` (approve → sign → pending → receipt), cache invalidation on confirmation, decode reverts with the generated ABIs through `mapContractError`.
3. Studio v1.2 flow for real: `marketTemplatePolicy` → `addReferenceCircuit` (dev reference) → `registerMarketTemplate` → `createMarket`; read on-chain `MARKET_TEMPLATE_ROOT()` for the root gate.
4. Sentinel: `accountOf`, create/fund/supply/enter/borrow/repay/withdraw, `setOperator`/`revokeOperator`/`setAutoRepayTrigger`.
5. Activity: `PolicyAllowed` + `AutoRepayExecuted` logs with receipts; keeper `GET /v1/activity` (verify chain/factory/account/operator scope first).
6. Playwright E2E with an injected EIP-1193 test provider that forwards to Anvil's unlocked accounts (no private key in the repo).

## Answers from Astra (M4-testnet-preflight-and-frontend-reads, f88817a)

- **Check order:** do not hand-order in chain mode. Resolve the first failure with `simulateContract` as the actual caller on the actual entrypoint. Facts: `Inactive` is borrow-only; supply/borrow caps come before the oracle and the adapter; Sentinel operator and account checks come before the pToken hook. (The fixture preview treats `Inactive` as blocking collateral supply too: fix when touching `fixture/preview.ts`.)
- **Rates:** per-block WAD rates. Simple APR (WAD) = `ratePerBlock * blocksPerYear()` from `DemoRateModelAbi`. Label "APR (simple, variable)". Never APY.
- **Manifest:** `capabilities.studioMarketTemplateRoot` and `deploymentBlock` are in every deployed manifest.
- **Explorer:** `/tx/<hash>` and `/address/<addr>` only for public-chain data. Never link local or fork hashes. No automated link checks (explorer 403s bots).
- **Operator withdrawals:** revert `OwnerOnly()`; revocation emits `OperatorRevoked(operator)`.

## Local deployment probe (read-only, 2026-11-25)

`packages/chain-config/deployments/31337.json` resolves to `deployed` under `src/lib/manifest.ts`. Manifest root == SDK `STUDIO_MARKET_ROOT` == on-chain `PolicyRegistry.MARKET_TEMPLATE_ROOT()` on `http://127.0.0.1:18545` (chain id 31337, 10/10 manifest contracts have code, `marketCount()` = 1 at probe time). `@peridot/chain-config` is NOT linked in root `node_modules` yet: adding it as a dependency needs a root install and a lockfile refresh (Claude owns the lockfile).

## Decisions needed before the local wallet E2E

1. Lockfile: who runs the root install after `@peridot/chain-config` is added to `apps/web/package.json`.
2. `PolicyRecord.spec` on chain: the registry stores hashes only. Recover the spec from `MarketTemplateRegistered(policyId, processor, maxLtvBps, requireCashReserve, configHash)` for market policies; for account policies match `configHash` against candidate specs or make `spec` a `Maybe`.
3. Test account: use an unlocked Anvil account that is neither the demo owner nor the keeper operator, with its own market and Sentinel account, so the keeper's demo position is untouched. The injected provider forwards `eth_sendTransaction` to Anvil; no private key in the repo.


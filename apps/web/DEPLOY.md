# Deploying the web app (Vercel)

The app is a Next.js App Router project in `apps/web` of an npm-workspaces monorepo. It needs no database and no backend of its own: the browser reads X Layer through the public RPCs. It has one optional set of server-side secrets, the three OKX Onchain OS read credentials (DECISIONS D25, `docs/OKX_CREDENTIALS.md`), used only by the two Node routes under `api/onchainos`. Without them the app builds and runs unchanged, and those routes answer that the credentials are missing.

## Vercel project settings

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root Directory | `apps/web` |
| Include files outside the Root Directory | **On** (the build reads `packages/`, `evidence/`, `deployments/session7/1952/judge-01/`, `services/mcp*/tools.json`, the v2 onboarding files in `services/mcp-v2/`, `docs/JUDGE_DEMO.md`, and bundles `services/onchainos/` into the two `api/onchainos` routes) |
| Install Command | `cd ../.. && npm ci` |
| Build Command | `cd ../.. && npm run build -w @peridot/web` |
| Output Directory | default (`.next`) |
| Node.js version | 22.x or later (the repo requires `>=22`) |
| Deployment Protection | Off for the public demo (DECISIONS D17) |

The install and build commands are also in `apps/web/vercel.json`, so the dashboard fields can be left empty. `npm ci` at the repository root builds the two workspace packages the app imports (`@peridot/chain-config`, `@peridot/circuit-sdk`) through their `prepare` scripts. The build's `prebuild` step (`scripts/sync-manifests.mjs`) copies the manifests and evidence files into `src/generated/`. The strategy SDK is imported by source path from `packages/strategy-sdk/`. A clone built with exactly these two commands in a scrubbed environment (`env -i` with only `PATH` and `HOME`) is part of each run's verification (last: commit 42ee197, 2026-11-26).

## Environment variables

None is required. The `NEXT_PUBLIC_*` ones and `KEEPER_API_URL` are not secrets; leave them unset for the public demo. The three `OKX_*` variables are secrets and are set in Vercel only, as sensitive server-side variables.

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_PERIDOT_TARGET` | unset = X Layer testnet 1952 | `local` builds against a local Anvil chain. **Never set on Vercel.** |
| `NEXT_PUBLIC_TESTNET_RPC_URL` | `https://testrpc.xlayer.tech` | Another public RPC for chain 1952. A public URL, never one with a key in it: it ships to every browser. |
| `NEXT_PUBLIC_LOG_PAGE_BLOCKS`, `NEXT_PUBLIC_LOG_MAX_PAGES`, `NEXT_PUBLIC_LOG_EARLY_PAGES` | 100, 40, 10 | Paging of `eth_getLogs` scans. |
| `NEXT_PUBLIC_PERIDOT_DATA` | unset | `fixture` forces labelled example data and turns chain reads off. For design review only. |
| `NEXT_PUBLIC_WALLET_FIXTURE` | unset | In-memory example wallet for screenshots. Never set on Vercel. |
| `KEEPER_API_URL` | unset | Server-only URL of a keeper read API. **Leave unset on Vercel**: no keeper service exists for testnet. Unset, the keeper panel is not rendered and the route answers `not-configured`. |
| `NEXT_PUBLIC_PERIDOT_OTHER_NETWORKS` | unset | `off` hides everything the app shows from OKX Onchain OS (the "Other networks" section of Portfolio and the indicative quote on Trade), whatever is committed in `src/lib/okx-switches.ts`. It can only turn things off: no value turns anything on. The two routes exist either way. |
| `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` | unset | **Secrets. Server-side only, marked sensitive in Vercel, never with a `NEXT_PUBLIC_` prefix, never in a file of this repository.** Read only by `services/onchainos/` behind `GET /api/onchainos/portfolio` and `GET /api/onchainos/quote`. Unset, both routes answer HTTP 200 with `credentials: "missing"` (the quote: `reason: "credentials-missing"`), send nothing to OKX, and the answer is `no-store`. A change takes effect only for new deployments. |

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so a change needs a redeploy.

## What the hosted build does and does not talk to

- From the browser: the app's own origin, `https://testrpc.xlayer.tech` (chain 1952) and `https://rpc.xlayer.tech` (chain 196, read-only). Explorer and faucet links open in a new tab and are not fetched.
- From the server: `https://web3.okx.com`, only from the two `api/onchainos` routes and only when the three OKX credentials are set (allowlisted GET reads, signed on the server; the reader is `services/onchainos/reader.mjs`). `/api/keeper` makes a request only when `KEEPER_API_URL` is set. Otherwise nothing.
- The browser asks `api/onchainos/portfolio` only when a user presses the lookup button on Portfolio, and `api/onchainos/quote` only when the quote switch is on. With every switch in `src/lib/okx-switches.ts` off (the committed state until each network is verified), no page asks either route.
- A testnet build contains no loopback address. The local RPC URL exists only in a `NEXT_PUBLIC_PERIDOT_TARGET=local` build.
- Mainnet (196) is read-only by construction: the app never asks a wallet to switch to it and blocks writes while a wallet is on it.

## Files that change what the hosted app shows

These are read at build time. Updating one needs a redeploy.

| File | Controls |
|---|---|
| `packages/chain-config/deployments/1952.json` | The v1 testnet deployment. Absent or not `deployed` = labelled example data, writes locked. |
| `packages/chain-config/expansion/tapeout-196.json` | **The one place for Peridot's public circuit IDs.** Set `publishedId` and `publicReceipt` (the publication transaction hash) of a circuit; `/circuits` then verifies it on chain 196 and offers the native read-only evaluation. Until both are set it shows "Not yet published". |
| `packages/chain-config/expansion/deployments/1952.json` | Sentinel v2 on testnet. Absent = Trade stays "Planned" and v2 rows are hidden. |
| `packages/chain-config/activity/1952.json` | Indexed activity snapshot. Absent = the snapshot card is hidden. Refresh it and redeploy during a demo (`services/indexer/README.md`). |
| `evidence/session5-mcp/flagship-1952.json`, `tools.json` | Sentinel Connect. Absent = Connect falls back to "In development". |
| `apps/web/src/lib/okx-switches.ts` | Which mainnet networks the "Other networks" section of Portfolio offers (per network) and whether Trade shows the indicative OKX quote. All off = one "Planned" line and no quote card. A switch is turned on only after an authenticated observation on the deployed app was verified for that network. |

## Checks before and after a deploy

Run from `apps/web`:

```sh
npm run typecheck && npm test && npm run check:tokens
npm run build && npm run start -- -p 3220 -H 127.0.0.1
PLAYWRIGHT_BROWSERS_PATH=0 BASE_URL=http://127.0.0.1:3220 node scripts/hosted-checks.mjs          # local production build
PLAYWRIGHT_BROWSERS_PATH=0 BASE_URL=https://<deployment-url> node scripts/hosted-checks.mjs       # the hosted app
```

`scripts/hosted-checks.mjs` loads every route in a clean browser profile at desktop and phone width, in light and dark, records every network host the pages contact, and fails on a host outside the list above, on a page error, on horizontal overflow, or on a response that asks for authentication. Given `NEXT_DIR=.next` it also searches the built bundle for loopback addresses, private-key-shaped values and provider credential names: the OKX credential names may occur only in server chunks that the two `api/onchainos` routes load and nothing else loads, never in `.next/static` or a prerendered file. It then calls the two routes directly (the portfolio one for the public demo owner address on chain 196) and fails if an answer that reports missing credentials, or any refused request, could be cached. Against a deployment that has the credentials this sends real read requests to OKX.

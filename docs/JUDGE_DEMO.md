# Reproduce the Peridot Sentinel judge demo

This walkthrough uses X Layer testnet **1952**, valueless tokens, a mock oracle, a swap venue backed by minted test inventory, and the development reference processor. A prepared campaign contains two fresh Studio markets, two v1 Sentinel accounts and one v2 account. The first v1 account holds the lending position and repay-only grant. The v2 account holds the bounded swap grant. Judge and operator pay their own transaction gas from separate testnet wallets. The previously recorded flagship model session uses a different account. [Flagship transcript and receipts](../evidence/session6-mcp-v2/README.md)

## Prepare the campaign

Start in the repository root with workspace dependencies installed. Build the existing artifacts with `forge build --root contracts --offline`, `forge build --root contracts/expansion --offline`, `npm --prefix packages/circuit-sdk run build` and `npm --prefix packages/chain-config run build`. The setup verifies the creation bytecode against the public expansion source pin. Keep the campaign's directory across restarts.

The coordinator provisions a fresh judge wallet and supplies its public address in `JUDGE_OWNER`. The preparation process receives `JUDGE_OWNER_KEY` and the approved 1952 deployer in `PERIDOT_TESTNET_KEY` through its private environment. The disposable owner key is available to the preparation operator as well as the judge. A judge can import that testnet-only owner into an isolated browser wallet. Use an empty, dedicated wallet for this shared demo. Only the coordinator needs the deployment credential. The D9 operator key stays on the separate signer host. All three signer addresses must be distinct. The grant expires seven days after preparation. A new campaign needs a fresh judge address and a unique campaign name.

**One-command setup** creates both markets through Studio’s compiler, registration and factory methods and leaves both grants unspent. This path submits the same typed transactions a Studio wallet uses. Step 1 below lets the judge create market A in the browser instead.

```sh
node services/judge-demo/run.mjs testnet setup judge-01
```

It funds the judge to at least **0.006 test OKB**, funds the operator to at least **0.001 test OKB** and transfers at least **0.0001 test OKB** to each new campaign participant. The journal records the two exact transfers and the deployer's starting and final native balances. On the shared M4 feed it keeps the quoted prices and refreshes their timestamps. It deploys new jWOKB and jUSDC contracts, a dedicated mock feed and an inventory-backed venue, with 3 jWOKB in the judge’s v2 account. Both M4 collateral books receive freshly minted original test tokens. Each market gets its own controller and books. New MARKET and ACCOUNT circuit IDs use the existing M4 development processor. A separate development processor receives the new EXECUTION circuit.

The resulting `deployments/session7/1952/judge-01/manifest.json` lists addresses, prepared block, policies, setup receipts, original grants and funding. The setup journal records signer, explicit nonce, calldata hash, value and canonical receipt. A repeat run preserves the original grants. It writes current readiness separately, including whether either operation has already been consumed or revoked. The signer reconciles an uncertain public submission by its original hash. Keep its journal intact. For an independent verification or a later same-price feed refresh:

```sh
node services/judge-demo/verify.mjs testnet judge-01
node services/judge-demo/run.mjs testnet refresh judge-01
```

Verification takes no signer. Refresh requires the testnet deployer; it renews the price timestamps once they are at least one hour old. The readiness report includes the current head and native balances. Funding checks current gas price against pre-measured fork gas budgets and both planned transfers. It reports the minimum required deployer balance before sending if a faucet top-up is needed.

## 1. Create market A in Studio with the judge wallet

For a **new** campaign, first run the funding phase with the intended fresh judge address and deployer environment. A separate campaign name keeps the prepared public demo reusable.

```sh
node services/judge-demo/run.mjs testnet fund judge-browser-01
```

Open the 1952-target web app at `/studio/create`. Switch the wallet to network 1952 and connect the same `JUDGE_OWNER`. Choose the approved **mCOL / mUSD** lending pair. Select the custom market template with the market A circuit cap in `plan.caps.A` printed by the funding command and enable the reserve check. For example, the first private-fork run selected 6350 bps (63.50%). Enter **75% protocol borrow LTV**, **85% liquidation LTV**, supply caps of **1,000 mCOL** and **1,000 mUSD**, a **900 mUSD** borrow cap and **10 mUSD** minimum cash. Submit each wallet prompt. Save the **MarketFactory.createMarket** transaction hash. The code verifies the owner, factory, parameters, fresh circuit registration and block before supplying liquidity to this exact market. Complete the kit using the same campaign:

```sh
node services/judge-demo/run.mjs testnet setup judge-browser-01 --adopt-market="$STUDIO_CREATE_TX"
```

Use that campaign name for every command below. The default `judge-01` campaign already has its own market A and B. A hosted frontend URL is managed by Claude. A local build of the web app can target the public 1952 network too. [Web deployment settings](../apps/web/DEPLOY.md)

## 2. Connect an external MCP client

The generic client uses the official MCP SDK's stdio transport. Public reads and simulated proposals require no signer.

```sh
node services/judge-connect/client.mjs testnet judge-01 read
node services/judge-connect/client.mjs testnet judge-01 simulate
```

For a model-directed run, start the restricted MCP server on the signer host. Supply `SENTINEL_OPERATOR_KEY` only in that private process environment. It must match the dedicated D9 operator. The public `JUDGE_OWNER` identifies the campaign owner. Keep the owner and deployer keys out of this environment. The server prints a private socket path.

```sh
JUDGE_CONNECT_EXECUTE=1 node services/judge-connect/listen.mjs testnet judge-01
```

In a separate clean shell set `JUDGE_MCP_SOCKET` to that path. The Claude process and its stdio bridge receive the socket address. The signer retains the operator key. From the repository root:

```sh
claude -p --strict-mcp-config --mcp-config services/judge-connect/claude.mcp.json \
  --tools '' --permission-mode dontAsk \
  --allowedTools mcp__judge__judge_read mcp__judge__judge_propose mcp__judge__judge_execute mcp__judge__judge_receipt \
  -- 'Read my judge account, propose the authorized repayment, execute the proposal and verify its receipt.'
```

## 3. Run a permitted operation

The v1 repay proposal spends up to **2 mUSD** from the borrowing account. The setup starts near 40% LTV with an inclusive 35% trigger. The v2 swap proposal uses **0.25 jWOKB** with a **19.80 jUSDC** minimum. Its fixed mock venue settles **19.99 jUSDC** to the v2 account. The grant permits **1 jWOKB** per call and **2 jWOKB** cumulatively. The campaign runner permits one recorded swap and one repayment. Use the model procedure above or the generic signer-side invocation.

```sh
JUDGE_CONNECT_EXECUTE=1 node services/judge-connect/client.mjs testnet judge-01 repay
JUDGE_CONNECT_EXECUTE=1 node services/judge-connect/client.mjs testnet judge-01 swap
```

Check `repay.json` and `swap.json` in the campaign directory. They record the canonical receipt, account, output, grant and balances before and after the mined operation. The operator and account are separate addresses. Signed commands are run by Claude/D9 or the assigned signer operator. The prepared public campaign can remain unspent until the judge is ready.

## 4. Show both independent policy rejections

Use the owner-only shell, with the judge's public address and private `JUDGE_OWNER_KEY`. With the current campaign feeds fresh, run:

```sh
node services/judge-demo/run.mjs testnet policy-denials judge-01
```

Market A’s owner borrow aims at 58% post-operation LTV. Its MARKET rule allows the borrow and its 55% ACCOUNT rule rejects. Market B’s owner borrow aims at 52%. Its ACCOUNT rule allows and its stricter MARKET rule rejects. The script checks each typed revert in simulation, sends with an explicit gas limit, checks the mined reverted receipt and replays the error. `policy-denials.json` records both independent processor outputs, actual LTV and unchanged borrow balances. A reverted EVM receipt contains no policy events.

## 5. Show a mined unauthorized operator action

On the D9 signer host, the only intentional negative action offered is `borrow(1)` against the fresh v2 account. The signer checks that there is no borrow grant and requires `OperatorNotAuthorized()` in pending-state simulation before submission.

```sh
JUDGE_CONNECT_EXECUTE=1 node services/judge-connect/client.mjs testnet judge-01 deny-operator
```

Inspect `deny-operator.json` for a reverted canonical receipt, zero logs, the typed replay and equal balances, books, grants and allowances. An earlier simulated denial is independently labelled.

## 6. Revoke all agent permissions

The judge's owner shell scans all v1 OperatorSet events since these accounts were created, in pages of at most 100 blocks. It checks every discovered operator on both markets, revokes every configured grant, clears enabled v1 triggers and calls `revokeAllOperators()` on v2 when an operator is configured. A final canonical read verifies all three accounts. The initial judge kit gives D9 a single v1 authorization on market A. Other M4, v2 and vault accounts have separate permissions.

```sh
node services/judge-demo/run.mjs testnet revoke judge-01
node services/judge-demo/verify.mjs testnet judge-01
```

Inspect `revoke.json` and the verifier. V1 returns a zero operator mask, budget and expiry. The v2 grant returns all zeros and `operatorCount()` is zero. Starting the same prepared campaign again preserves those revocations.

## 7. Read activity and refresh recorded history

```sh
node services/judge-activity/refresh.mjs testnet judge-01
```

Read the campaign’s `activity.json` with its start, end, terminal block hash and confirmation gap. Refresh after each demonstration reaches its public confirmation depth, or every 15 minutes when showing a running demo. Use the mined-rejection files for failed calls and the MCP results for simulations. The canonical M4 history can also be refreshed with `node services/indexer/refresh.mjs`. The campaign profile includes its own new v2 factory and venue. [Historical activity schema](../services/indexer/README.md)

## Evidence and rehearsal

To reproduce the isolated rehearsal, start this dedicated loopback node in one shell. Keep `--chain-id 1952` because the existing registry includes chain ID in its policy identities. Fork mode verifies the Anvil backend and upstream URL and uses locally impersonated actors. It requires no signing credentials.

```sh
anvil --host 127.0.0.1 --port 19750 --chain-id 1952 --fork-url https://testrpc.xlayer.tech --fork-block-number 47252205 --no-storage-caching --silent
```

In a second shell run the following from the repository root. Each independent fork gets a different instance ID and a separate journal. Stop the dedicated Anvil node when finished.

```sh
node services/judge-demo/run.mjs fork setup judge-01
node services/judge-demo/run.mjs fork setup judge-01
node services/judge-demo/run.mjs fork policy-denials judge-01
node services/judge-connect/client.mjs fork judge-01 exercise
node services/judge-demo/run.mjs fork revoke judge-01
node services/judge-demo/verify.mjs fork judge-01
node services/judge-activity/refresh.mjs fork judge-01
```

The private 1952 fork rehearsal pinned upstream block **47,252,205**. Setup mined 49 transactions. A repeat submitted zero additional transactions and observed both grants ready. The independent generic MCP client then executed the three typed actions through stdio. Repayment used 224,693 gas, paid 2 mUSD and moved LTV from 4001 to 3876 bps. Swap used 262,198 gas and returned 19.99 jUSDC. The intentional unauthorized borrow used 48,786 gas and left the monitored state unchanged. The separate independent policy checks observed 5800 and 5200 bps. After revocation an idempotent setup observed both grants unavailable. The fork activity snapshot recorded 56 events from blocks 47,252,206–47,252,262. These transactions exist only on the disposable fork. Its market creation used the scripted Studio transaction path. Earlier browser evidence covers the wizard on an unforked local Anvil instance. [Earlier browser Studio wallet evidence](../evidence/fable/local-e2e-first-full-studio-run.json) [Fork manifest and journal](../deployments/session7/fork-c3ff76c553e75afa/judge-01/manifest.json) · [Stdio client results](../evidence/session7-judge/fork-mcp.json) · [Fork policy rejections](../deployments/session7/fork-c3ff76c553e75afa/judge-01/policy-denials.json)

For a browser-driven rehearsal, use a private Anvil on port 19750 and a 1952-target frontend on loopback. On a fresh fork, the following commands prepare a second disposable owner, exercise the actual Studio wizard and adopt the exact market from its receipt. The public address below is an impersonated fixture on the private fork. It needs no key. The default browser origin is `http://127.0.0.1:3220`. Supply another loopback origin through `JUDGE_BROWSER_ORIGIN` when needed. The runner requires a host that can launch Playwright Chromium. It checks an existing browser receipt before reuse and refuses to overwrite evidence from another fork instance. Use a clean checkout for an independent recording.

```sh
export JUDGE_OWNER=0xcde7e5989D66405234Cc0FAEFe5A2740795Ce824
node services/judge-demo/run.mjs fork fund studio-join
PLAYWRIGHT_BROWSERS_PATH=0 node evidence/session7-browser/studio-fork.mjs
studio_tx=$(node -p "require('./evidence/session7-browser/creation.json').transactions.at(-1).hash")
node services/judge-demo/run.mjs fork setup studio-join --adopt-market="$studio_tx"
node services/judge-demo/verify.mjs fork studio-join
```

Use `studio-join` in the operator, rejection, revocation and activity commands for this walkthrough. Check the actual `MarketCreated` event and the screenshot in `evidence/session7-browser` before attributing the transaction to the browser.

### Prepared public campaign

Claude ran the one-command setup once on public 1952 for `judge-01`. It completed at **block 47,253,173** with **49 successful setup receipts**. The judge owner is `0x36bdf2AF3aAa8113c34a6d0168769F6Cc695D50B`. Its market A borrower is `0xb7eBAF22BDf9099fE38636A101115a5c9CfeEDf2`, and its swap account is `0x154815582Eae6b49B7F0f3cABD16adCA0227d269`. Some contract addresses coincide with the private fork because their factories and creation nonces matched. Use the public manifest, block hashes, owner and receipts to identify this public run. [Public manifest and all setup hashes](../deployments/session7/1952/judge-01/manifest.json)

| Testnet wallet | Before setup (test OKB) | At the prepared block (test OKB) |
|---|---:|---:|
| Deployer | 0.198897101304855068 | 0.192597542314877119 |
| Fresh judge | 0 | 0.005657257202862861 |
| D9 operator | 0.199979643798982190 | 0.200079643798982190 |

Both public grants expire **December 3, 2026 at 16:50:32 UTC (Unix 1796316632)**, before the provisional December 7 submission. Shared and private mock feeds have a 24-hour freshness window. On demo day run the deployer-only feed refresh and the keyless verifier before connecting the judge. A feed refresh cannot extend a grant. After expiry or consumption, historical receipts remain valid evidence at their recorded blocks.

For submission, Claude can schedule a separate preparation on December 4–6 or on presentation day with a **new disposable owner**, a **new campaign name** and fresh keys supplied through their designated server/owner environments. The new seven-day expiry must cover the actual judge presentation window. Keep the existing judge-01 journal, receipts and manifest for historical verification. Keep the earlier campaign's owner and operator credentials out of the new judge's browser and process logs. Only the new owner key belongs in that judge's isolated browser wallet. Set the following shell variable in the coordinator shell and use it in place of judge-01 for all seven steps:

```sh
judge_campaign=judge-02
node services/judge-demo/run.mjs testnet setup "$judge_campaign"
node services/judge-demo/run.mjs testnet refresh "$judge_campaign"
node services/judge-demo/verify.mjs testnet "$judge_campaign"
```

These are preparation instructions for the later authorized run. Session 7 created only the public judge-01 campaign. A consumed or revoked authorization stays consumed or revoked across restarts.

The deployer sent **0.006 test OKB** to the judge in `0x808fb23d88fbca6bc4d98254134668dd7ac5eda867b9d67c5d1c83f1f528da67` and **0.0001 test OKB** to D9 in `0xb7973328946f7a116792e101d4101e57f58c2112a7e9f3855334b7c1d7e98139`. Market A binds controller `0xfa1b92bdA3eDE700a38917238749D1d47990A1C4` to the v1 borrower above. Market B binds `0x356da76Dd963d1468Cd88c0276e30a5d401c01A1` to v1 account `0xB5392B3ae038a7de7d57eE6450c33E734391b4d2`. D9 is `0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88` on both grants. The judge then paid gas for account, market and grant creation. At the prepared block, the repay-only grant held **2 mUSD** and the bounded swap grant held **2 jWOKB**, with **1 jWOKB** per-call limit. Public setup left both grants available for judges. Compare historical setup balances with a current read before executing. [Judge gas transfer](https://www.okx.com/web3/explorer/xlayer-test/tx/0x808fb23d88fbca6bc4d98254134668dd7ac5eda867b9d67c5d1c83f1f528da67) · [Operator gas transfer](https://www.okx.com/web3/explorer/xlayer-test/tx/0xb7973328946f7a116792e101d4101e57f58c2112a7e9f3855334b7c1d7e98139)

The keyless verifier independently matched all 49 public setup intents and receipts on `testrpc.xlayer.tech` and `xlayertestrpc.okx.com`. It verified new circuit and policy identities against the initial funding block, checked all eleven v2 runtime hashes, and observed both grants ready at block **47,253,353**. [Two-host verification and balances](../deployments/session7/1952/judge-01/verified.json)

The first public campaign activity snapshot contains 47 emitted events from blocks **47,252,767–47,253,214**. At that refresh the last 12 blocks awaited confirmation. Later scans can extend the range independently of the historical setup manifest. [Public campaign activity snapshot](../deployments/session7/1952/judge-01/activity.json)

A second private fork verified the *adoption* branch with an independent **scripted wallet**. Three signed transactions published the MARKET template and created market A. The setup adopted the pre-existing creation receipt `0xfe6d20446c688ab60824feefa826a842682c37d9c9c6d8923dd9bc19a80fd074` and reused its exact controller and judge owner. It completed 46 setup transactions; repeating the same adoption left all three signer nonces unchanged. The keyless verifier confirmed both grants were ready. To replay this regression, start a separate private Anvil on port 19752 with the same upstream block and chain ID as the fork command above, then run `node evidence/session7-judge/rehearse-adoption.mjs`. [Scripted wallet receipts and final readback](../evidence/session7-judge/scripted-adoption.json)

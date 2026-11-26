# Peridot Sentinel: demo runbook (draft)

_Maintained by Claude. Last updated 2026-11-26. This runbook will be finalized at M6 (Dec 6)._

The demo is 3 minutes, following handoff §14. Every step must state its environment on screen: **Testnet**, **Local** or **Fork**.

## Before recording (T-1 day)

1. **Fresh testnet demo state.** Demo price feeds go stale after one day, and operator grants expire after one day. Claude runs this:
   ```sh
   DEMO_OPERATOR=0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88 \
   PERIDOT_TESTNET_KEY="$(cat /Users/joshua/Peridot/OKX/.testnet-keys/deployer.key)" \
     node contracts/script/deploy-demo.mjs testnet --source-commit=<pin> --ops=fresh
   ```
   Do not run `--ops=price` yet. The price move happens live in step 5.
2. **Recording wallet.** Fund it with test OKB from the faucet (https://web3.okx.com/xlayer/faucet/xlayerfaucet) and add X Layer testnet (1952). Mock tokens are minted in the app.
3. **Keeper service in execute mode**, run by Claude with the operator key from env only. Confirm its `/v1/status`.
4. **Fallback footage.** Pre-record every step once. Real receipts are already on record (see SUBMISSION_EVIDENCE). Replayed footage must never be presented as live.


## Judge campaign (reproducible, Astra session 7)

- **Current campaign:** `judge-01` on public 1952. Its manifest is `deployments/session7/1952/judge-01/manifest.json`.
  - Judge owner: `0x36bdf2AF3aAa8113c34a6d0168769F6Cc695D50B`.
  - Lending accounts A and B, and swap account v2.
  - Fresh Studio market caps.
  - An unused repay-only grant and an unused swap-only grant, both **expiring 2026-12-03 16:50:32 UTC**.
- **For recording or judging after Dec 3,** create a new named campaign with a fresh owner. Claude runs this, with keys supplied via env only:
  ```sh
  JUDGE_OWNER=<fresh testnet EOA> JUDGE_OWNER_KEY=<env only> PERIDOT_TESTNET_KEY=<env only> \
    node services/judge-demo/run.mjs testnet setup judge-02
  ```
  - It uses about 0.0063 test OKB from the deployer.
  - Replaying `judge-01` does not revive expired authority.
  - Refresh the price feeds on demo day.
- **Judge walkthrough:** see `docs/JUDGE_DEMO.md`. It covers the Studio market, connecting an MCP client, the permitted swap and repay, both independent rejections, the unauthorized operator action, revoke-all, and the activity view.

## Script

| Time | Step | Environment | Shown | Evidence |
|---|---|---|---|---|
| 0:00–0:25 | Problem: projects can't easily launch configurable markets, and automation today requires too much trust. | — | Landing page ("Your money. Your rules. Your intelligence.") | — |
| 0:25–0:55 | Studio: create an isolated market and attach the TapeOut-format market policy. Show the processor and circuit ID. | Testnet (development processor) plus a fork/public TapeOut evidence panel | `/studio/create` → `/studio/[id]` | Fabrication is shown honestly: public IDs if D8(b) is executed, otherwise the fork |
| 0:55–1:25 | Sentinel: create an account, deposit collateral, authorize a personal policy, borrow. | Testnet | `/sentinel`, `/markets/[id]` | tx hashes |
| 1:25–2:05 | Two rejections. The account policy blocks while the market allows; the market policy blocks while the account allows. Then an allowed borrow. | Testnet or local (labelled) | Distinct rejection states plus circuit evidence | E2E evidence |
| 2:05–2:35 | Automation: a labelled mock price move, then the keeper repays from the account's funds, debt goes down and health goes up. Show that the operator cannot withdraw, and the emergency revoke. | Testnet | `/sentinel/activity` | keeper receipt |
| 2:35–3:00 | The flywheel: Studio markets feed Sentinel, plus Sentinel Connect (BYO agent via MCP) and the roadmap. | — | Automate and Connect screens; only live items are shown as live | — |

## Must say or show

- "Testnet: test tokens, mock price feed."
- On testnet: "Policy circuits on testnet run on a development reference processor."
- "Real TapeOut processor evaluation: X Layer mainnet (read and fork) and the public IDs if D8(b) is executed."
- Never claim guaranteed liquidation prevention, yields, an audit or an endorsement.

# Peridot Sentinel: demo runbook

_Maintained by Claude. Last updated 2026-11-27 (revised for the strategy-first narrative, DECISIONS D23–D24). Finalized at the Dec 6 freeze._

There are two deliverables:
1. **A 3-minute video** for the submission (below). The genuine LLM-directed Sentinel Connect session is the flagship.
2. **A longer technical walkthrough for judges.** This is [`docs/JUDGE_DEMO.md`](JUDGE_DEMO.md), which is reproducible end to end with its own fresh campaign.

Every on-screen segment carries its environment label: **Testnet 1952**, **Local**, **Private fork of 1952/196** or **X Layer mainnet (read-only)**. It also says whether it is **Live** or **Recorded <date>**.

## Honesty rules for the video
- Wallet prompts and block confirmations may be cut or sped up. Show a small "sped up" or "cut" marker when you do.
- **Recorded footage must be labelled with its recording date.** It is never presented as live. Every recorded on-chain step shows its tx hash, so viewers can check it on the explorer.
- **Always say:**
  - "Testnet: test tokens, mock price feed, mock swap venue and mock vault."
  - "Policy circuits on testnet run on a development reference processor. Real TapeOut processor evaluation is on X Layer mainnet."
- **Never claim:**
  - guaranteed liquidation prevention, yields or performance;
  - an audit, a partnership or users;
  - continuous autonomous AI. The LLM session is a single agent-directed session.
  - live OKX quotes, unless the credentials are live and the quote is shown with its timestamp;
  - managed vaults or public strategy publishing, unless they are actually live.

## Before recording (T-1 day)
Run from the repository root. Keys come only from the environment. `PERIDOT_KEY_DIR` is a directory **outside the repository** that holds the testnet-only keys. Never commit or print a key.

1. **Fresh judge campaign.** `judge-01` grants expire 2026-12-03 16:50:32 UTC. Create a new one with a fresh testnet owner:
   ```sh
   JUDGE_OWNER=<fresh testnet EOA> JUDGE_OWNER_KEY=<env only> \
   PERIDOT_TESTNET_KEY="$(cat "$PERIDOT_KEY_DIR/deployer.key")" \
     node services/judge-demo/run.mjs testnet setup judge-02
   node services/judge-demo/verify.mjs testnet judge-02
   ```
   This uses about 0.0063 test OKB from the deployer. Refill from the faucet if needed: https://web3.okx.com/xlayer/faucet/xlayerfaucet.
2. **Fresh v1 demo state** (price feeds and keeper grant):
   ```sh
   DEMO_OPERATOR=0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88 \
   PERIDOT_TESTNET_KEY="$(cat "$PERIDOT_KEY_DIR/deployer.key")" \
     node contracts/script/deploy-demo.mjs testnet --source-commit=<pin> --ops=fresh
   ```
3. **Recording wallet.** Use a dedicated browser profile and wallet on X Layer testnet (1952) with faucet test OKB. Mock tokens are minted in the app.
4. **Activity snapshot.** Refresh it and confirm "Indexed through block …" shows on `/activity` (see `services/indexer/README.md`). If historical reads are unavailable, follow the recovery section there; the displayed gap is expected.
5. **Native TapeOut.** If D8(b) was signed on Nov 28, check that `/circuits` shows the three public Peridot circuit IDs on CPU #410. If it was not signed, show only the third-party mainnet evaluation and the fork evidence, labelled as such.
6. **Record the flagship LLM session** (segment 3) the day before. It uses the restricted MCP server on the signer host, a fresh bounded swap grant from the judge campaign, and the procedure in `services/mcp-v2/README.md` and `docs/JUDGE_DEMO.md` §2. Keep the full transcript and verify the receipts before using the footage. If the new session fails, use the Nov 26 session (`evidence/session6-mcp-v2/`) labelled "Recorded 2026-11-26".

## Video script (3:00)

| Time | Segment | Environment / mode | Shown | Evidence |
|---|---|---|---|---|
| 0:00–0:20 | **Problem and value.** Managing a DeFi portfolio means constant watching, and handing it to a bot or AI today means handing over your keys. Sentinel: "Put your portfolio on autopilot. Your money. Your rules. Your intelligence." | — | Landing `/` | — |
| 0:20–0:45 | **Portfolio, then strategies.** One portfolio view across lending, swap and vault positions. Create a strategy from a template: debt protection or a restricted agent swap. Then Discover reusable strategies, with available and planned items clearly labelled. | Testnet 1952 · Live (UI) | `/portfolio`, `/strategies`, `/discover` | — |
| 0:45–1:35 | **Flagship: an LLM directs your account, within your rules.** An external AI connects through Sentinel Connect (MCP). It reads the account and its remaining budget, chooses a bounded swap, simulates it, executes it, and reads the result. It then tries an action it is not permitted, and the contract rejects it as a mined revert. Point out that the agent never holds the owner key and cannot withdraw. | Testnet 1952 · **Recorded <date>**, sped up | Terminal transcript beside `/connect` and `/activity` | Swap tx and revert tx from the recording (Nov 26 fallback: swap `0x54d49999…b79f`, revert `0xb50d45ed…f7f7`) |
| 1:35–2:10 | **Why it's safe.** (a) Native TapeOut: policy circuits evaluated on a real TapeOut processor on X Layer mainnet. (b) Independent policies: the market's policy and the user's policy each reject on their own, both mined. (c) Emergency stop: one transaction revokes every agent permission. | (a) X Layer mainnet read-only (public IDs if D8(b) signed; otherwise third-party circuit plus Private fork of 196). (b, c) Testnet 1952 · Recorded | `/circuits`, `/activity` | Rejection A `0x4d973024…`, rejection B `0xb0981049…`, emergency stop `0xcd440b9f…` |
| 2:10–2:40 | **Share and build.** Export a strategy and import it in another wallet. Importing grants nothing: the adopter reviews the exact operation, budget, expiry and account, then signs it themselves. Studio lets financial product creators launch an isolated market with its own policy circuit. | Testnet 1952 · Live UI, or recorded fork footage labelled "Private fork of 1952" | `/strategies` (import/review), `/studio/create` | Strategy gate evidence (`evidence/fable/run7/`) |
| 2:40–3:00 | **Business model and roadmap.** Revenue candidates (planned, none live): automation execution fees, Studio market creation and management fees, a protocol reserve share, and later circuit licensing. Roadmap: public strategy publishing (if it isn't live by then), multichain portfolio via OKX Onchain OS, the native mainnet demonstrator, then audits before any funded mainnet. | — | Roadmap slide | — |

Full tx hashes and addresses are in [`SUBMISSION_EVIDENCE.md`](SUBMISSION_EVIDENCE.md).

## Live vs recorded plan
- **Live in the video:** UI navigation (landing, portfolio, strategies, discover, studio, connect, circuits, activity). These are reads only; no wallet confirmations are needed.
- **Recorded:**
  - the LLM session;
  - the mined rejections;
  - the emergency stop;
  - strategy adoption signing.

  Each has a real tx hash shown on screen. If time allows, re-record them on demo day against `judge-02`; otherwise use the existing public receipts with their recording dates.

## Judge walkthrough
[`docs/JUDGE_DEMO.md`](JUDGE_DEMO.md) is the longer, reproducible path. It covers:
1. Create a market in Studio.
2. Connect an MCP client, generic or Claude Code.
3. Run a permitted swap and repay.
4. Show both independent rejections.
5. Attempt an unauthorized operator action.
6. Revoke all.
7. Read the activity.

The coordinator runs the signer-host steps. Operator keys never reach the browser or the model process.

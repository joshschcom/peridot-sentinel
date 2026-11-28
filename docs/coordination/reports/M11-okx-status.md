# CLAUDE → CHATGPT | Peridot Sentinel (X Layer) | M11 OKX credentials and multichain status | 2026-11-28 UTC

## Status
- **Credentials.** The founder reports the OKX Onchain OS read credentials are set as sensitive server-side env on Vercel. Claude has not seen them and will not.
- **Authenticated quotes on the deployed app: NOT YET VERIFIED.** The deployed app has no server route that calls OKX yet. The only quote code is `services/onchainos/quote.mjs`, used by the local MCP servers. No deployed URL has been given to Claude yet.
- **Multichain portfolio (X Layer 196, Ethereum 1, Base 8453, Solana 501): NOT YET VERIFIED.** It was designed earlier and is now being built (D25). Every per-network UI switch is committed **off** until Claude verifies an authenticated observation on the deployed app, cross-checked against an independent RPC at a recorded block or slot.
- **Release state (M10) unchanged.** Strategy gate 48/48 on `9d124e2`, plus `testnet-live` passed on the final build (`14cbd34`).

## Work started (D25)
- **Astra, session 11.** `services/onchainos/reader.mjs`, with:
  - injected env and fetch;
  - allowlisted reads (supported chains, token inventory, wallet-token USD subtotal) and the fixed WOKB/USDC quote on 196;
  - at most 4 subjects, at most 2 provider calls each, concurrency 2, a 60 s cache and a per-instance rate cap;
  - a fixed response schema with an enum `reason`, never provider text;
  - credential-leak tests using fake credentials.

  Also `verify-live.mjs`, which reads the deployed routes and cross-checks native balances on all four networks against independent public RPCs, for public watch addresses only. Astra never holds the credentials.
- **Fable, run 9.**
  - Node route handlers `api/onchainos/{portfolio,quote}`.
  - A Portfolio section "Other networks · mainnet · read-only via OKX Onchain OS": opt-in, with per-network status, timestamps, a stale label and "OKX estimate" subtotals. Mainnet values are never added to testnet values.
  - An indicative WOKB→USDC price on 196 behind its own switch.
  - The hosted check now asserts that no `OKX_API` names appear in client chunks.
- **Order.** The founder sends the deployed URL; Vercel deploys main; Claude runs `verify-live.mjs` against it; Claude enables only the networks that verified; Claude re-runs the release checks.
  - "Unsupported" or "not entitled" is reported per network, not as a failure.
  - If nothing is verified by end of Dec 1, the feature ships disabled (Dec 2 freeze).

## Local MCP credentials (secure method)
- **Where they live.** The founder creates `../.okx-credentials/onchainos.env` outside the repo (directory 700, file 600) with an editor. No value passes through chat or shell history.
- **Launcher.** `services/onchainos/with-okx-env.sh <command>` refuses unless the file is outside the repo, owned by the user and mode 600. It refuses any variable other than the three OKX names. It parses the file instead of sourcing it, so nothing in the file executes, and it exports the values only to the one command it starts.
- **MCP.** `sh services/onchainos/with-okx-env.sh node services/mcp-v2/host.mjs`. `host.mjs` already passes the three names to the MCP server process only, never to the model process.
- **Who may use it.** Claude only, as an exception to AGENTS.md. Astra and Fable never read the file or have the variables.
- **Testing.** Tested with synthetic values: wrong mode, an extra variable, a file inside the repo and an injection attempt are all refused or inert.
- Documented in `docs/OKX_CREDENTIALS.md`.

## D8(b) native TapeOut: founder signing today
- **Where the founder's OKB goes.** It stays in the founder's mainnet EOA on 196 and is spent only by the four reviewed calls:
  - **0.00066 OKB** to the NAND component `0x3896076BE165d6a7eC2a70CCF6876673fE245007` (mint 209 NAND);
  - **3 × 0.0013 OKB** to TapeOut CPU #410 `0x423446EEFAa885B804C7bD9B0bdD130cE2Ee00B5` (`tapeout` of Market V1, Sentinel V1 and Execution V2);
  - the remainder is gas, with **0.004647 OKB** all-in as the ceiling.
- **What the signer receives.** The NANDs and the three circuit NFTs go to the sender (`msg.sender`). Claude checked that no calldata word contains a recipient address.
- **Tool.** `docs/coordination/D8b-founder-send.sh <public sender>`, run by the founder in their own terminal with a cast prompt, a Ledger or a keystore. It:
  - refuses unless each envelope's target, value, gas, fees and selector equal the reviewed ones, on chain 196;
  - asks for "yes" per call;
  - waits for each receipt and checks its status and signer;
  - stops on any mismatch;
  - prints the four tx hashes.

  A dry run stopped at the first prompt as designed.
- **Before signing.** `sh docs/coordination/D8b-presign-check.sh <public sender>`.
- **After signing.** Claude and Astra run `D8b-postpublish.mjs --published …` and the native7 checks before any public circuit ID is shown.

## Founder actions
1. Send the **deployed Vercel URL**. Confirm it deploys from `main` and that Deployment Protection is off for the production URL.
2. D8(b): run the presign check with the sender address, then `D8b-founder-send.sh`, then send the four tx hashes.
3. Optional: create the local credentials file for the MCP quote tool.
4. The organizer question, still open.

## Do not claim (unchanged, plus)
- Live OKX quotes or a multichain portfolio, until verified on the deployed app.
- A hosted-URL validation.
- Public TapeOut IDs before the post-publication verification.
- Everything on the M10 list.

# Peridot Sentinel: submission evidence

_Maintained by Claude. Last updated 2026-11-26._

Every entry records where it happened, using one of these labels:

| Label | Meaning |
|---|---|
| **PUBLIC-MAINNET** | A real X Layer mainnet transaction or read |
| **PUBLIC-TESTNET** | A real X Layer testnet 1952 transaction |
| **FORK** | A local fork of X Layer mainnet. Not a public transaction, so there is no explorer link. |
| **LOCAL** | Unforked Anvil |

Mock components are always named as mocks. A hash is never presented as public unless it is.

## X Layer chains (verified 2026-11-25)

| Chain | Chain ID | RPC |
|---|---|---|
| Mainnet | 196 | `https://rpc.xlayer.tech` |
| Testnet | 1952 | `https://testrpc.xlayer.tech` |

The testnet RPC backends are inconsistent: some reads come back stale, and block 0 is sometimes missing.

## TapeOut integration

| # | Evidence | Label | Chain | Processor / circuit | Details | Source |
|---|---|---|---|---|---|---|
| T1 | A Peridot read and evaluation of an existing TapeOut circuit | PUBLIC-MAINNET (read-only) | 196 @ 76,844,958 | CPU 275 `0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`, circuit 1 | `eval` output matched the TAP reference model on all inputs. Gas was about 51k. 451 processor-creation records were verified. This is not a Peridot circuit. | `evidence/a1/mainnet-reads.json` |
| T2 | Peridot MARKET (63 NAND) and ACCOUNT (87 NAND) policy circuits fabricated on the real TapeOut processor | FORK | Fork of 196 @ 76,844,958 | CPU `0x4234…00b5`, fork-only circuit IDs #2 and #3 | 12/12 vectors matched. Solidity eval gas is about 176k (market) and 230k (account). Simulated fees were 0.00326 OKB. | `evidence/a1/fork-policy-evaluations.json` |
| T3 | Sentinel borrow evaluated by both real TapeOut circuits with an identical context | FORK | Fork of 196 | #2 and #3 | Allowed borrow `0x83c774cc…c563`, gas 771,264. Account-policy revert `0xe59dd279…fa92`. Direct pToken market-policy revert `0x7a766e64…3dd4`. | `evidence/a5/settlement-ea66a81d55e7.json` |
| T4 | Unsigned proposal to fabricate both Peridot circuits publicly on CPU 410 | Proposal only; NOT SENT | 196 | CPU 410 (TapeReel, third-party) | About 0.0033 OKB. Rehearsed 3/3 on a fresh fork. On hold pending the policy-schema freeze (D14). | `docs/coordination/D8b-mainnet-fabrication-proposal.md` |

**Trust finding.** The official TapeOut factory `0x1f09…0761` reports itself unsealed; it has a UUPS owner and its implementation has changed since TAP-10. The circuit beacon's owner has been renounced. Peridot pins the processor codehash and fails closed. See `docs/TAPEOUT_INTEGRATION.md`.

## Peridot Sentinel deployment on X Layer testnet

| # | Evidence | Label | Details | Tx / address |
|---|---|---|---|---|
| D1 | Full deployment from source pin `39c0a54`, after a keyless preflight that matched 36 source hashes and 11 artifacts | PUBLIC-TESTNET | 30 deployer txs, about 0.00045 OKB. Mock tokens, an owner-set mock price feed, and a **development reference processor (not TapeOut)**. | Manifest `packages/chain-config/deployments/1952.json` (block 47,161,508). MarketFactory `0xEB32e6bA03D8B92d6bB0d5283A59263a50674BC0`, SentinelAccountFactory `0x37157221a5fA97d3f3EC1AA2375032d578Db182f`, PolicyRegistry `0x681A4aEA609E9c85a88EC07Eb3B2cD5FcA5De9aC` |
| D2 | Automated repayment by a restricted, repay-only operator after a labelled mock price move | PUBLIC-TESTNET | 20 mock USD were repaid from the account's own funds. LTV went from 5001 to 3751 bps and the operator budget was consumed. | `0x38cb05f18271aae2cc7cb6e40e783f039ff267d72478a64cc92d792de76f5a77`, block 47,161,960 · `evidence/testnet/keeper-auto-repay-1952.json` |

| D3 | **Sentinel Connect (MCP) flagship**: an external MCP client in a separate process runs the 7-step agent-directed flow | PUBLIC-TESTNET | (1) read account and positions, (2) read policy and grant, (3) OKX quote (blocked: credentials missing), (4) simulate, (5) execute an authorized repay, (6) operator borrow rejected by the contract (read-only eth_call of the real entry point), (7) read the receipt and the updated grant. The only executable tx is a zero-value `autoRepay()`. There is no owner key and no arbitrary calldata. 2 mUSD repaid, LTV 5001 to 4876 bps, grant 2 to 0. `verify-demo.mjs` replay passed. | `0xc5daaf3401cde7a7b1e8f93c97290f8d9711825ba871097af074304340569b0f`, block 47,246,674 · `evidence/session5-mcp/flagship-1952.json` |
| D4 | Re-arm for Connect: owner borrow, then a fresh 2 mUSD repay-only grant | PUBLIC-TESTNET | Owner = testnet deployer | `0xa63a27ff…3985`, `0x6d58d23a…460d` |

## Product behaviour (local and fork)

| # | Evidence | Label | Source |
|---|---|---|---|
| P1 | Browser-wallet E2E: Studio market creation, then supply, activate and the Sentinel borrow | LOCAL | `evidence/fable/local-e2e-run-*.json`, `evidence/screenshots/local-e2e/` |
| P2 | **Independent rejections.** Market A (65% cap, 55% account policy): `AccountPolicyRejected`, while the market circuit allows. Market B (50% cap): `MarketPolicyRejected`, while the account circuit allows. | LOCAL (simulation of the real entry point) | `evidence/fable/local-e2e-run-20261126-133424.json` |
| P3 | Isolation. A liquidation in market A leaves market B unchanged. | LOCAL and FORK | `evidence/session2-ops/` |
| P4 | An operator cannot withdraw (`OwnerOnly`). Revocation works. A rejected borrow does not spend the operator budget. | Foundry tests (24/24) | `contracts/test/` |
| P6 | **Sentinel v2 Uniswap v3 swap adapter.** A restricted operator swapped 1 WOKB for 82.164632 USDC through the **real Uniswap v3 router** on chain 196. The account received the output and the approvals were cleared. A 101 bps trade reverted without consuming the grant (EXECUTION policy). | FORK (of 196) | `evidence/session5-swap/fork.json` |
| P7 | Three versioned policy circuits (Market V1, Sentinel V1, Execution V2) rehearsed for public fabrication on CPU 410: 23/23 vectors. Unsigned; ceiling 0.004647 OKB. | FORK (of 196) | `docs/coordination/D8b-v2-three-circuits.md` |
| P5 | The interest-rate cadence matches X Layer at 1 block per second, so the displayed APR equals real accrual. | Test plus on-chain check | Commit `586af97` |

## Do-not-claim list

- No Peridot circuit has a public TapeOut ID yet (T4 is pending).
- On testnet, policy circuits run on the development reference processor, which is not TapeOut.
- No funded mainnet deployment. No audit. No partnership with or endorsement from OKX, X Layer or TapeOut.
- No real yields and no TVL. All amounts are test tokens.
- Margin, the LP lifecycle, hosted AI, Aave and ERC-4626 are **not implemented** unless they appear in this file with a receipt. The Uniswap swap is mainnet-FORK only; on testnet it is a labelled mock.
- Sentinel Connect is **agent-directed execution** of one restricted operation. It is not autonomous continuous monitoring.

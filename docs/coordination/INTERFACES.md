# Peridot interfaces v1.2

Document revision `v1.2`, 2026-11-25. This is the integration contract for the test profile. Check the generated ABIs in `@peridot/chain-config` for the signatures supported by each build. An absent deployment keeps wallet writes disabled.

## Policy and units

The uint8 operation IDs in order are SUPPLY (0), REDEEM (1), BORROW (2), REPAY (3), ENTER_COLLATERAL (4), EXIT_COLLATERAL (5), MARGIN_OPEN (6), MARGIN_CLOSE (7), REBALANCE (8), TRANSFER (9). IDs 6–8 are reserved. Operator masks use bit `1 << op`. MARKET is kind 0 and ACCOUNT is kind 1.

```ts
type Common = { schema: 'peridot.policy/v1', templateVersion: 0, label?: string }
type PolicySpec = Common & (
  | { kind: 'MARKET', templateId: 'market-max-ltv-v0',
      params: { maxLtvBps: number, requireCashReserve: boolean } }
  | { kind: 'ACCOUNT', templateId: 'account-guard-v0',
      params: { maxLtvBps: number, allowedOps: Op[] } }
)
```

maxLtvBps is an integer from 0 through 10000, inclusive. configHash is Keccak-256 of compact UTF-8 JSON with recursively sorted keys, no label, and allowedOps sorted by numeric value. Duplicate operations are invalid. netlistHash is Keccak-256 of the raw TAP-02 records. A threshold, reserve option or mask change produces a newly compiled policy. Thresholds and masks are circuit constants.

Context wire 0 is the low bit of byte 0. Wires 0–3 carry the operation (least significant bit first), 4 carries oracleFresh, 5–18 carry postLtvBps (least significant bit first), and 19 carries cashOk. Bits 20–23 are zero. Send exactly three bytes. BORROW at 5000 bps with both flags set encodes as `0x12710a`. LTV is ceil(post debt value × 10000 / post eligible collateral value). Zero debt gives 0. An unrepresentable or above-10000 risk increase fails closed before encoding. The caller derives context from market accounting. Configuring a policy confers no authority to supply live risk inputs. Market allow requires fresh prices and LTV at or below the cap, plus cashOk for BORROW if reserve checking is configured. Account allow requires fresh prices, LTV at or below the cap and the op bit enabled.

Both circuits have 20 inputs, one output, zero state bits and only backwards-referencing NAND records. A valid response contains exactly one byte, 00 for deny or 01 for allow. The Solidity ABI return is exactly 96 bytes (offset 32, length 1, zero padded). A deny reverts with MarketPolicyRejected(bytes32,uint8) or AccountPolicyRejected(bytes32,uint8), reason code 1 for a binary deny. Invalid responses or an unavailable processor revert with PolicyEvaluationFailed(bytes32). Reverted transactions have no surviving evaluation log.

SUPPLY is subject to exposure caps and policy; borrowing and collateral removal with outstanding debt require the applicable checks. Ordinary repayment, valid liquidation, seize, collateral entry and safe exits bypass discretionary circuit checks. Solvency, cash and authentication still apply. A cash reserve target applies to new borrowing. The same controller preview is used for direct pToken operations and Sentinel actions. pToken redeem and transfer use raw shares. Mint, borrow, repay, caps and cash reserves use raw underlying token units. Prices are USD per whole token scaled by 1e18 in the test feed. Exchange rates and Compound-style rate mantissas follow the generated contracts. Use bigint for amounts, including the integer strings in JSON manifests.

## Registry and adapter

PolicyRegistry(owner) on 31337/1952 is a curated registry. The registrar approves processor contracts and registers compiler outputs after checking the spec-to-bytecode correspondence off chain. Registration checks dimensions, gate bounds, bytecode records and hash on chain. Each immutable entry binds chainId, processor, circuitId, processor codehash, kind, schema version 1, template version 0 (template selected by kind), netlistHash, configHash, metadataHash, gateCount and publisher. Content hashes are bytes32. Ownership of a processor NFT confers no Peridot administration powers. External beacon upgrade state is a separate trust dependency.

`requirePolicy(bytes32 id,uint8 kind)` validates a usable entry. `enforce(bytes32 id,uint8 kind,uint8 op,bool oracleFresh,uint256 postLtvBps,bool cashOk)` performs a bounded read-only evaluation and reverts on failure. PolicyRegistered and ProcessorTrustSet identify the creation of an entry and its evaluation eligibility. The controller and account decide when risk evaluation applies.

## Market and account integration

MarketFactory.createMarket(policyId,borrowLtvBps,liquidationLtvBps,collateralSupplyCap,debtSupplyCap,borrowCap,minCash) returns the isolated controller address. Registry reads are marketCount(), marketAt(index), isMarket(controller). Read owner(), active(), policyId(), collateralMarket() and debtMarket() on the controller. A market starts inactive and needs funded liquidity, a valid feed and owner activation. Market owners set their policy. No frontend should infer activation from creation.

Controller previewPolicy(account,op,pToken,amount) returns (applies,oracleFresh,postLtvBps,cashOk). accrue() updates both legs before a Sentinel check. For owner-dispatched actions the account holds collateral and debt. Operator grants bind a market, op mask, amount limit and expiry. Owner controls withdrawals. Ordinary debt repayments use available account funds and continue during processor outages. See generated Sentinel ABI before enabling account actions.

## Deployments

`packages/chain-config/deployments/<chainId>.json` has schemaVersion (1), chainId, abiVersion ("v1"), profile ("local", "testnet", or "read-only"), status ("deployed" or "not-deployed"), commit, contracts (name to address), markets (controller and collateral/debt pTokens), tapeout (mode, processor, circuits), and mocks. Chain 31337 is local simulation, 1952 is experimental X Layer testnet, and 196 is read-only. Empty address maps and null processor are valid for undeployed manifests. Fable must verify chain ID and code before wallet writes. Every evidence label distinguishes official deployment, local fork and development reference processor.

X Layer uses OKB on both networks. Explorer roots are https://www.okx.com/web3/explorer/xlayer-test and https://www.okx.com/web3/explorer/xlayer. RPCs are https://testrpc.xlayer.tech and https://rpc.xlayer.tech.

## Version history

| Version | Date | Change |
|---|---|---|
| v0-provisional | 2026-11-25 | Claude seeded fixture interfaces. |
| v1 | 2026-11-25 | Threshold moved into each circuit, one-bit output, canonical three-byte context, numeric op mask and TRANSFER ID, curated immutable registry and manifest readiness. |

## Implementation supplement v1.1

This additive publication keeps schema `peridot.policy/v1` and manifest abiVersion `v1`. It records the signatures and permissions implemented after the first v1 handoff. The exported ABI constants are named `<ContractName>Abi` in `@peridot/chain-config`. Run `npm --prefix packages/chain-config run generate` after compiling Foundry.

- The registrar calls setProcessorTrust(processor,trusted) and register(processor,circuitId,kind,expectedNetlistHash,configHash,metadataHash). The policy ID is Keccak-256 over ABI encoding of chainId, registry address, processor, circuitId, uint8 kind, uint8 schemaVersion, uint8 templateVersion, netlistHash and configHash. getPolicy(id) returns the entry and requirePolicy(id,kind) returns (processor,circuitId). Registration requires exactly 20 inputs, 1 output, 0 state bits and 1–256 NANDs. Adapter evaluation forwards up to 1,500,000 gas.
- MarketCreated indexes uint256 marketId, address owner and address controller and includes policyId, collateralMarket and debtMarket. marketAt(0) returns the first controller. MarketPolicySet and MarketActivated are emitted by the controller. Exact underlying redemption rounds the shares burned up. Limits are immutable for the market. A user enters collateral using the controller's enterMarkets([collateralMarket]).
- SentinelAccountFactory.createAccount(controller,policyId) creates a single Sentinel per (owner, controller). Lookup uses accountOf(owner,controller). Fund the account with an ordinary transfer of an approved underlying. supply(rawCollateral), enterCollateral(), redeem(rawShares), repay(maxRawDebt), withdraw(underlying,rawAmount), setPolicy(id), setAutoRepayTrigger(bps), setOperator(operator,opsMask,maxAmount,expiry) and revokeOperator(operator) are owner actions. Withdrawal always pays the owner. Setting policyId to zero suspends account risk increases. borrow(rawDebt) pays the account and permits delegated borrowing.
- Grant masks support BORROW (4) and REPAY (8). The two operations share a cumulative raw debt-token budget. Expiry is exclusive. operators(operator) returns mask, remaining, expiry. Owner-controlled trigger zero disables auto-repay. autoRepay() from an authorized REPAY operator requires current accrued LTV ≥ trigger and spends min(account funds, outstanding debt, remaining grant). The owner's manual repay has no trigger or oracle dependency. AutoRepayExecuted(operator,amount,ltvBeforeBps,ltvAfterBps) comes from the account. The receipt's log address identifies the account.
- Indexed account creation event: AccountCreated(owner,controller,account,policyId). The account emits AccountPolicySet(policyId), OperatorSet(operator,opsMask,maxAmount,expiry), OperatorRevoked(operator) and AutoRepayTriggerSet(bps). Missing user policy reverts AccountPolicyMissing(). Expiry, allowance exhaustion and owner-only violations use OperatorExpired(), ExceedsOperatorLimit() and OwnerOnly(). Sender checks happen before a wallet-side call can observe a policy denial.
- The two dev contracts exposed to UI as mock assets and price feed are TestnetToken and TestnetOracle. TestnetOracle accepts positive USD WAD prices and treats quotes over one day old as stale.

Revision v1.1, 2026-11-25: registry fields, published contracts, Sentinel execution and event semantics. Existing v1 policy specs and manifest schema remain valid.

## v1.2 Studio and activity

The new registry exposes MARKET_TEMPLATE_ROOT(). Its bytes32 value and the SDK export STUDIO_MARKET_ROOT must equal the manifest's capabilities.studioMarketTemplateRoot. The v1.2 root is `0xec7861345eb0b7eb7e7c96d5ceec277180b86ef226c2c8c064e18576879e0a60`. The manifest and policy schema retain their v1 wire formats. Older registries lack this capability.

**Studio wallet flow**

1. The project owner picks an integer maxLtvBps in 0–10000 and a boolean requireCashReserve. Call `studioMarketTemplate(maxLtvBps,requireCashReserve)` in @peridot/circuit-sdk. The result contains spec, compiled (including netlist, configHash and netlistHash) and a 15-element proof. Protocol hard limits continue to apply.
2. Read `marketTemplatePolicy(processor,compiled.configHash)`. If it returns a usable entry, reuse it. Otherwise obtain a circuit with those exact bytes on the selected processor. A development-reference manifest uses `addReferenceCircuit(compiled.netlist)` and the mined ReferenceCircuitAdded ID. A sponsor deployment requires its own fabrication workflow and fees. Show the processor mode before the user signs.
3. From the owner's wallet call `registerMarketTemplate(processor,circuitId,maxLtvBps,requireCashReserve,compiled.netlistHash,compiled.configHash,proof)`. This registration is permissionless. It accepts a committed market template on a trusted CPU. An invalid proof reverts InvalidTemplateProof(). The first canonical registration emits MarketTemplateRegistered(policyId,processor,maxLtvBps,requireCashReserve,configHash). A concurrent registration can reuse an existing entry. Always resolve marketTemplatePolicy after confirmation, then read getPolicy and requirePolicy(id,0) for the canonical processor and circuit ID.
4. Call MarketFactory.createMarket with that id and read MarketCreated from the receipt. The project wallet is the market owner. To change an existing market, the owner calls controller.setPolicy(newId). MarketPolicySet takes effect in the same successful transaction. Other wallets cannot set it. Only the registrar can approve CPUs or register arbitrary curated policies.

**Policy activity and receipts**

On manifests with capabilities.policyAllowedEvents=true, the Sentinel account and controller emit the same event after their respective checks. The emitter identifies the policy layer. An ordinary direct borrow emits one controller approval. A Sentinel borrow with both checks emits two. Successful repayment, liquidation and circuit-free exits have no such approvals. For earlier deployments use settlement receipts and separately labelled traces if available.

```ts
// Bound a page to the RPC's log limit. Start at manifest.deploymentBlock, track block hashes for reorgs.
const approvals = await client.getContractEvents({
  address: [sentinelAddress, controllerAddress],
  abi: IsolatedControllerAbi, eventName: 'PolicyAllowed', args: {account: sentinelAddress},
  fromBlock, toBlock, strict: true,
})
const receipt = await client.getTransactionReceipt({hash})
```

Decoded event arguments are indexed bytes32 policyId, indexed address account, indexed uint8 op, uint256 postLtvBps, bool oracleFresh and bool cashOk. Key logs by chain, blockHash, transactionHash and logIndex. Query only known account/controller emitters and confirm receipt status. Failed transactions discard all events. A mined revert has a receipt with status reverted. Show a specific policy error only when returned by the original simulation or transaction trace and label the source. A keeper repay simulation failure is an automation attempt.

**Keeper reads**

GET /v1/status and GET /v1/activity?limit=50 are read-only JSON routes for one configured account/operator. Both return schemaVersion:1, environment (anvil, anvil-fork or xlayer-testnet), instanceId (null on testnet), chainId, factory, account and operator. Compare the scope with the connected market before displaying data.

Activity returns `items` newest first and a boolean `truncated`. Limit is 1–100. Each entry includes ISO timestamp `at` and `state`, with optional fields `amount,trigger,ltv,fee,balance,reason,hash,block,gas,outcomes`. Amount, fee, balance, LTV, block and gas quantities are decimal strings, trigger is an integer in bps, reason is an error name. Outcomes contain operator, amount and before/after LTV in bps as decimal strings. Off-chain states include disabled, simulated, simulation-failed, gas-budget, another-transaction-pending and awaiting-confirmation. Submitted has a transaction hash. Success and reverted are reported after a mined receipt and use lowercase state names. Consumers may deduplicate receipt rows by transaction hash and state. An empty list means this service has no matching activity in its recent window.

Status includes execute, intervalMs, maxRetries, phase, attempt, cycles, startedAt, lastAt, lastOutcome and nextAt. A tick-failed outcome signals a read/configuration/transport error. See ARCHITECTURE.md for retry and journal behavior.

Revision v1.2, 2026-11-25. Added verifiable parameterized Studio registration, successful policy events, opt-in manifest capability fields and the keeper read service. All ABI additions are additive.

### Frontend reads and first-error ordering for v1.2

Simulate the selected pToken or Sentinel entrypoint from the wallet that will sign. `previewPolicy` computes circuit inputs from stored balances. It does not exercise all authorization, accrual, cap or token settlement checks. The controller authenticates the calling pToken before the hook checks shown here.

| Operation | Order within the authenticated controller hook |
|---|---|
| Borrow | Debt book, active market, accrue both books, total borrow cap, policy preview, fresh prices, sufficient cash after minimum reserve and hard LTV limit, market circuit. |
| Supply | Accrue both books, supply cap for this book, preview, fresh prices, market circuit. Inactive markets accept seed liquidity. |
| Redeem or transfer | Accrue both books, preview the sender’s remaining shares, then for a positive removal of pledged collateral with outstanding debt check fresh prices, hard LTV and market circuit. Removing more pledged shares than held can fail during the preview arithmetic. |
| Exit collateral | Verify collateral leg and membership, accrue and apply the removal check to the entire entered position. A positive debt against the removed collateral exceeds the hard LTV limit. |
| Repay, seize or liquidate | Repay and seize authenticate the appropriate books. Liquidation additionally requires the correct pair, fresh prices, a position past the liquidation threshold and repayment within the close factor. These operations bypass custom circuits. |

A Sentinel borrower using an operator first checks the operation mask, expiry and remaining grant. The account then checks the amount, accrues, previews and calls its account circuit before calling into the pToken and controller. A successful pToken call also depends on its own balance, cash and token settlement checks. Grant revocation emits `OperatorRevoked(operator)`. An operator calling `withdraw(asset, amount)` gets `OwnerOnly()`. A successful owner withdrawal always pays the immutable owner.

For a book’s **model-based simple APR**, read `borrowRatePerBlock()` or `supplyRatePerBlock()` using `MarketPTokenAbi`. Read `interestRateModel()` from the same book, then `blocksPerYear()` using `DemoRateModelAbi` for the manifest’s demo model. Pin the reads to the same block. Multiply the per-block WAD by `blocksPerYear` with bigint and format the result as a percentage. New demo deployments pass `31_536_000` to `DemoRateModel(uint256 blocksPerYear_)`, based on one block per second over 365 days on X Layer. Local 31337 uses the same simulated cadence. Earlier deployments return 2,102,400. During the coordinated redeploy, refresh cached reads and check the getter even if the addresses match. At 40% utilization with a 10% reserve factor, both models target approximately 4.00% simple borrow APR and 1.44% simple supply APR. The corrected per-block rates and interest accrued over a given block interval are about one-fifteenth of the earlier values. Read the connected model at the same block as the rates. A different rate model needs its own annualization convention.

New deployed demo manifests publish `deploymentBlock`, `capabilities.studioMarketTemplateRoot` and `capabilities.policyAllowedEvents`. Missing fields on an older deployment disable the corresponding feature. An empty public manifest has no deployment fields. For a confirmed public receipt or address, append `/tx/<hash>` or `/address/<address>` to `xLayer.blockExplorers.default.url` or `xLayerTestnet.blockExplorers.default.url` from chain-config. Link local and fork activity to the recorded local evidence. OKX preserved all four public path shapes on redirect, then returned HTTP 403 to the automated page check.

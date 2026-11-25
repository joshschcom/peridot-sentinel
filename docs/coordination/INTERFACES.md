# Peridot interfaces v1

Version `v1`, 2026-11-25. This is the integration contract for the test profile. Check the generated ABIs in `@peridot/chain-config` for the signatures supported by each build. An absent deployment keeps wallet writes disabled.

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

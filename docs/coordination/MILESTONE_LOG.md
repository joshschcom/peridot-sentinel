# MILESTONE_LOG — append-only

Astra posts a YAML notice (format below) on every milestone and on every ABI, behavior, address, schema or event change. Fable replies in a separate appended entry with `received`, then `integrating`, then `integrated` or `blocked` (with web commit, route, screenshots and tx evidence). Claude relays each notice to Fable and records acceptance. Never edit a previous entry.

```yaml
milestone: M<n>-<name>
from: astra | fable | claude
status: implemented | testnet_verified | blocked | received | integrating | integrated
commit: <real SHA>
chain_id: <actual chain>
abi_version: <version or hash>
manifest: <repo-relative path>
contracts: [<verified addresses or NOT_DEPLOYED>]
new_functions: [<signatures>]
changed_events_errors: [<details>]
units_and_permissions: <details>
frontend_actions: [<required screens/hooks/state changes>]
verification: [<commands, result, tx hashes>]
known_limitations: [<specifics>]
next_dependency: <owner and task>
```

---

```yaml
milestone: M0-kickoff
from: claude
status: implemented
commit: fae7cdad57017b37786c0824ede53bd1744e3ea2 (tag pre-xlayer-hackathon = imported baseline)
chain_id: 1952 (testnet), 196 (mainnet read-only)
abi_version: v0-provisional (docs/coordination/INTERFACES.md)
manifest: NONE YET; frontend runs in FIXTURE MODE
contracts: [NOT_DEPLOYED]
known_limitations:
  - No TapeOut code found on testnet 1952 at the TAP-10 mainnet addresses. Mainnet factory proxy, implementation, beacon and processor impl all have code. Beacon owner() returns 0x0, which still needs interpretation.
  - Testnet deployer 0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67 has a balance of 0 OKB and needs the faucet.
next_dependency: Astra runs the A1 TapeOut spike plus interface v1. Fable builds design system, landing, app shell and typed services against v0 fixtures.
```

```yaml
milestone: M0-interface-v1
from: astra
status: implemented
commit: 7c93b4545d00dd548bc947cb322d80c3bb991cc2 (base only, working tree delivery; sandbox denies git index writes)
chain_id: [31337, 1952, 196]
abi_version: v1
manifest: packages/chain-config/deployments/<chainId>.json (pending)
contracts: [NOT_DEPLOYED]
new_functions: ["requirePolicy(bytes32,uint8)", "enforce(bytes32,uint8,uint8,bool,uint256,bool)", "previewPolicy(address,uint8,address,uint256)"]
changed_events_errors: ["Binary deny code 1; separate MarketPolicyRejected and AccountPolicyRejected; no surviving events on reverts"]
units_and_permissions: "Three context bytes, LSB-first. Threshold and op mask baked into template. Transfer=9. Test-profile custody limited to 1952/31337."
frontend_actions: ["Migrate fixtures to peridot.policy/v1 in INTERFACES.md; dispatch writes only from generated ABIs and a verified deployed manifest."]
verification: ["TAP-02 wire spec read at 527477ecb7cf68ee9e86d8292669d57fe1680572; example borrow 5000 bps = 0x12710a"]
known_limitations: ["Testnet deployment pending. Git index is read-only in the agent sandbox."]
next_dependency: Claude relay to Fable; Claude can commit reviewed paths in writable checkout.
```

```yaml
milestone: M0-testnet-gas
from: astra
status: blocked
commit: 7c93b4545d00dd548bc947cb322d80c3bb991cc2 (base)
chain_id: 1952
abi_version: v1
manifest: pending
contracts: [NOT_DEPLOYED]
new_functions: []
changed_events_errors: []
units_and_permissions: "Fresh testnet deployer has 0 wei."
frontend_actions: ["Keep testnet wallet writes disabled."]
verification: ["https://testrpc.xlayer.tech returned eth_chainId 0x7a0 and eth_getBalance 0x0 for 0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67."]
known_limitations: ["Official OKX faucet documents a web form, up to 0.2 OKB/day. No supported unauthenticated programmatic claim identified."]
next_dependency: "Founder or Claude can enter the public address at https://web3.okx.com/xlayer/faucet/xlayerfaucet. Local and fork work continues."
```

```yaml
milestone: M1-registry-adapter-sdk
from: astra
status: implemented
commit: 58684b1 (interface commit; implementation in working tree awaiting Claude checkpoint)
chain_id: 31337
abi_version: v1
manifest: packages/chain-config/deployments/1952.json (not-deployed)
contracts: [NOT_DEPLOYED]
new_functions: ["register(address,uint256,uint8,bytes32,bytes32,bytes32)", "getPolicy(bytes32)", "setProcessorTrust(address,bool)", "encodeContext(uint8,bool,uint256,bool)", "enforce(bytes32,uint8,uint8,bool,uint256,bool)"]
changed_events_errors: ["PolicyRegistered(bytes32,address,uint256,uint8)", "ProcessorTrustSet(address,bytes32)", "UnavailablePolicy(bytes32)", "InvalidContext()"]
units_and_permissions: "Only immutable registrar can register and attest compiler hash correspondence. Processor withdrawal of trust stops new risk. Output validation accepts exactly 96 canonical ABI bytes; eval budget 1.5M gas."
frontend_actions: ["Use @peridot/circuit-sdk compilePolicy/encodeContext; sample market 6500 bps 63 NAND, account 5500 bps 87 NAND in fixtures/policies-v1.json. Treat examples as fixtures."]
verification: ["cd contracts && forge test --match-path test/policies/Policy.t.sol: 4 passed, 0 failed/skipped", "npm --prefix packages/circuit-sdk test: 8 passed, 0 failed/skipped", "A4 checked 262 upstream stateless rows and all 12 fixture vectors against TAP reference."]
known_limitations: ["DevelopmentReferenceProcessor is a restricted test interpreter. Sponsor fork integration tracked separately."]
next_dependency: "Claude checkpoint contracts/src/policies and contracts/test/policies (astra), packages/circuit-sdk (astra/A4). Fable consume SDK."
```

```yaml
milestone: M2-market-factory
from: astra
status: implemented
commit: 58684b1 (interface commit; implementation pending Claude checkpoint)
chain_id: 31337
abi_version: v1
manifest: packages/chain-config/deployments/1952.json (not-deployed)
contracts: [NOT_DEPLOYED]
new_functions: ["createMarket(bytes32,uint16,uint16,uint128,uint128,uint128,uint128)", "activate()", "setPolicy(bytes32)", "accrue()", "currentLtvBps(address)", "marketAt(uint256)", "collateralEntered(address)"]
changed_events_errors: ["MarketCreated(uint256,address,address,bytes32,address,address)", "MarketActivated(address)", "MarketPolicySet(address,bytes32)", "InvalidOracle()", "Inactive()", "InsufficientLiquidity()", "BorrowCapExceeded()", "SupplyCapExceeded()"]
units_and_permissions: "Permissionless creation of fixed approved pair; creator activates after debt liquidity is seeded. Per-market policy and independent lending books. Borrow and liquidation thresholds separate."
frontend_actions: ["Seed debt liquidity before activation; controller address identifies a market. Redeem in raw pToken shares. Read position and accrued balances from the generated ABI."]
verification: ["cd contracts && forge test --match-path 'test/markets/*' -vv: 6 passed, 0 failures/skips on local fixtures. Direct pToken policy hooks, isolation, repayment, liquidation, stale feed, caps and interest exercised."]
known_limitations: ["New two-book controller implements imported controller interface; uses imported PErc20 accrual and settlement core. Flash loans paused. Development profiles only."]
next_dependency: "Claude checkpoint A2 paths with required attribution; Astra integrates Sentinel and deploys locally."
```

```yaml
milestone: M0-tapeout-mainnet-read
from: astra
status: implemented
commit: 58684b1 (interface commit; evidence working tree)
chain_id: 196
abi_version: v1
manifest: evidence/a1/mainnet-reads.json
contracts: ["Official factory 0x1f09DAeFA827f02CBb40967cc91b259763760761", "CPU 275: 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF circuit 1"]
new_functions: ["circuitInfo(uint256)", "netlist(uint256)", "eval(uint256,bytes)"]
changed_events_errors: []
units_and_permissions: "Read-only block 76844958. Factory reports unsealed, owner 0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138; proxy implementation now 0x336e9f0f4c3fee7c8c803377e4dea00293f4ae2a. TAP-10 candidate has code but is not the current factory implementation."
frontend_actions: ["The live evidence view can cite this processor/circuit/block as a sponsor circuit evaluated read-only. Peridot policy fabrication on fork is separate."]
verification: ["All 4 truth-table inputs matched pinned TAP Python model. Two length probes confirmed permissive processor input behavior. Canonical eth_estimateGas 50601–51183."]
known_limitations: ["Real processor evidence does not establish an official testnet deployment or an immutable factory."]
next_dependency: A1 finish fork policy fabrication and organizer request.
```

```yaml
milestone: M3-sentinel-interface
from: astra
status: integrating
commit: 58684b1 (interface v1 base)
abi_version: v1
chain_id: 31337
manifest: packages/chain-config/deployments/1952.json
contracts: [NOT_DEPLOYED]
new_functions: ["createAccount(address,bytes32)", "accountOf(address,address)", "setAutoRepayTrigger(uint16)", "setOperator(address,uint16,uint256,uint64)", "operators(address)", "revokeOperator(address)", "autoRepay()", "supply(uint256)", "enterCollateral()", "borrow(uint256)", "redeem(uint256)", "repay(uint256)", "withdraw(address,uint256)"]
changed_events_errors: ["AccountCreated(address,address,address,bytes32)", "AutoRepayExecuted(address,uint256,uint256,uint256)"]
units_and_permissions: "One account per owner and controller. Grant mask supports borrow (4) and auto-repay (8), with a cumulative budget in raw debt units and timestamp expiry. Trigger in LTV bps; zero disables. Withdrawal destination is always owner."
frontend_actions: ["Fund via token transfer to Sentinel; borrow and redeem settle into the account. Simulate as the actual sender. Use accountOf(owner,controller)."]
verification: ["A3 published typed interface; implementation and integrated verification pending."]
known_limitations: ["Displayed LTV uses accrued book state and may change at execution."]
next_dependency: "A3 runtime verification, generated ABI export and A5 deployment."
```

```yaml
milestone: M0-tapeout-spike
from: astra
status: implemented
commit: fe0c60b (SDK templates and core; full fork evidence pending checkpoint)
chain_id: "196 read-only; 31337 fork of 196 block 76844958"
abi_version: v1
manifest: evidence/a1/fork-policy-evaluations.json
contracts: ["Real processor on fork 0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5; fork-only circuit IDs 2 and 3"]
new_functions: ["Sponsor eval(uint256,bytes) from Solidity"]
changed_events_errors: ["Stateful and unknown circuits rejected; raw sponsor inputs can be short or long. V1 caller enforces canonical inputs."]
units_and_permissions: "Market 63 NAND, account 87 NAND. Actual sponsor component burn on local fork. Combined native fees 0.00326 simulated OKB. No public transaction."
frontend_actions: ["Show fork circuits separately from public sample circuit and local development reference. Factory fees for new CPUs are denominated in BEM; legacy circuit fabrication on this fork used native OKB."]
verification: ["451 CPU creation events enumerated through pin; 12/12 fork vectors matched; market Solidity eval gas 175392–175942, account 229723–230273."]
known_limitations: ["Official testnet deployment and sponsor eligibility for our mixed evidence are unconfirmed."]
next_dependency: "Organizer confirmation, A1 final spike document and A5 product-path fork rehearsal."
```

```yaml
milestone: M3-sentinel-and-keeper
from: astra
status: implemented
commit: fe0c60b (core/SDK base; Sentinel, keeper and local receipts pending Claude checkpoint)
chain_id: "31337 unforked Anvil, local simulation"
abi_version: "v1; INTERFACES documentation supplement v1.1"
manifest: packages/chain-config/deployments/31337.json
contracts: ["MarketFactory 0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82", "SentinelAccountFactory 0x9A676e781A523b5d0C0e43731313A708CB607508", "Demo account 0x8e80FFe6Dc044F4A766Afd6e5a8732Fe0977A493"]
new_functions: ["Generated ABIs available as <ContractName>Abi in @peridot/chain-config; use interface supplement v1.1"]
changed_events_errors: ["OwnerOnly(), AccountPolicyMissing(), OperatorExpired(), ExceedsOperatorLimit(), TriggerNotMet(); AutoRepayExecuted has amount and actual pre/post-action LTV in bps"]
units_and_permissions: "After mock price drop, repay-only operator spent 20000000 raw mUSD from the account; event LTV 5001 to 3751 bps, including accrual."
frontend_actions: ["Local-only manifest records exact build digest and base commit under provenance because contracts were built from a dirty tree; commit null. Accept only with matching local RPC and bytecode, or wait for a verified clean rebuild. Public writes remain disabled. New generated ABI and TypeScript builds ready."]
verification: ["15/15 Foundry tests passed; 22 successful deployment/seed receipts. Keeper tx 0x6f124ca0bbf991ed202280dd1b0ff3a6fb9319253c964a7caaf58ef21462e9b6 block 32, status success, gas 231318. See deployments/local."]
known_limitations: ["Unforked product uses DevelopmentReferenceProcessor. One early local borrow exhausted its gas limit; A5 recorded the receipt and verified a successful retry with headroom."]
next_dependency: "Claude checkpoint Astra paths, A3 Sentinel and A5 deployment with attribution; Fable integrates actual ABIs and chain checks. Root lockfile should include @peridot/chain-config and @peridot/keeper workspace entries."
```

```yaml
milestone: M3-real-processor-settlement
from: astra
status: implemented
commit: cc9445a (M3 core and A1 sponsor fork; A5 product evidence in working tree)
chain_id: "31337 local child fork; public ancestor 196 at 76844958"
abi_version: "v1 (documentation v1.1)"
manifest: evidence/a5/settlement-ea66a81d55e7.json
contracts: ["Sponsor CPU 0x423446eefaa885b804c7bd9b0bdd130ce2ee00b5, fork IDs #2 MARKET and #3 ACCOUNT"]
new_functions: []
changed_events_errors: ["Mined fork reverts contain AccountPolicyRejected or MarketPolicyRejected"]
units_and_permissions: "A Sentinel borrow evaluated the account and market with identical context 0x12f409 and funds settled to the account."
frontend_actions: ["Use evidence/a5/settlement-ea66a81d55e7.json for allow trace and both revert receipts. Label all three as fork-only. Mainnet public read evidence remains the separate historic circuit."]
verification: ["Successful fork borrow 0x83c774cc5a499b38166c38bff7f6094a80830f726235ddc1fcb2b4e5c796c563, gas 771264", "Account revert 0xe59dd2799250e4ff2d77d4e40664aef98abfd6957994190ede89650dfad1fa92", "Direct market revert 0x7a766e64787d79ed7e7b3249bc63dd296bd85651eeecaab6b9761b6964a53dd4", "Separate unforked two-process keeper test settled once with five mock USD, recorded in evidence/astra/local-keeper-concurrency.json"]
known_limitations: ["Public testnet gas remains zero. No organizer response."]
next_dependency: "Claude relay evidence, checkpoint final A1/A5 artifacts, A6 review, keeper concurrency check, DEMO_MATRIX Astra cells and ASTRA_REPORT. Fable to verify wallet path separately."
```

```yaml
milestone: M3-build-provenance
from: astra
status: implemented
commit: 7ded29d85ebdcb4ef761b11009087b7e1a471d17
chain_id: 31337
abi_version: "v1 (INTERFACES v1.1)"
manifest: packages/chain-config/deployments/31337.json
contracts: ["Local-only addresses from 31337 manifest, loopback RPC http://127.0.0.1:18545"]
new_functions: []
changed_events_errors: []
units_and_permissions: "Existing local deployment now has a verified build commit."
frontend_actions: ["Consume the normal manifest.commit = cc9445a79877c406fc9f107b9fcfb440c6db91f6; no dirty-manifest exception needed. Local address checks passed. Keep testnet writes disabled."]
verification: ["36 transitive source hashes and policy fixture hash matched. Clean rebuild from cc9445a reproduced creation/runtime bytes for all ten compared artifacts. Wrong-network and missing-code checks both failed as intended."]
known_limitations: ["Testnet deployer balance 0 at block 47156264. Public chain manifests remain not-deployed. Root package-lock.json at this checkpoint omits services/keeper."]
next_dependency: "Claude refresh root npm lockfile with workspace keeper included and checkpoint ASTRA_REPORT; Fable verify wallet E2E. Founder request test OKB and organizer eligibility using drafted question."
```

```yaml
milestone: M3-workspace-install
from: astra
status: blocked
commit: 7ded29d85ebdcb4ef761b11009087b7e1a471d17
chain_id: 31337
abi_version: v1
manifest: packages/chain-config/deployments/31337.json
contracts: ["Existing local deployment"]
new_functions: []
changed_events_errors: []
units_and_permissions: "Root package-lock.json is Claude-owned."
frontend_actions: ["No ABI changes; a clean root npm ci needs the keeper workspace entries."]
verification: ["Fresh isolated npm ci --dry-run --ignore-scripts failed EUSAGE, missing @peridot/keeper. With only the two missing entries regenerated, the identical dry run passed."]
known_limitations: ["This affects clean installs from the current checkpoint. Existing compiled workspaces and deployed contracts passed."]
next_dependency: "Claude: git apply .research/keeper-workspace-lock.patch (or npm install --package-lock-only --ignore-scripts), then checkpoint your root lockfile. Patch contains only the two missing workspace entries."
```

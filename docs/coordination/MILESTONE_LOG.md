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

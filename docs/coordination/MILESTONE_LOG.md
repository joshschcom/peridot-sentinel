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

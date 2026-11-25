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

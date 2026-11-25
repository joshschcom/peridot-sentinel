# Peridot X Layer — rules for every agent working in this repo

The master specification is `/Users/joshua/Peridot/OKX/PERIDOT_XLAYER_CLAUDE_HANDOFF.md`. Read it in full before your first change. This file sets the operating rules that apply to every agent.

## Roles (actual runtime, verified 2026-11-25)
- **Claude (orchestrator)** runs Claude Code on `claude-opus-5-5`. It owns integration, merges, milestone acceptance, `STATUS.md`, `DECISIONS.md` and founder reports.
- **Astra 6.2 (contracts and infrastructure lead)** runs `gpt-6.2-astra` through OpenAI Codex CLI 0.171.0 with `multi_agent_v2`. It may spawn Codex sub-agents for specialist roles A1–A6.
- **Fable 5.2 (frontend and product lead)** runs as a Claude Code subagent on `claude-fable-5-2`.
- **No direct Astra↔Fable channel exists.** Agents communicate through `docs/coordination/MILESTONE_LOG.md` (append-only), and Claude relays notices to Fable.

## Hard safety rules
1. **Never read, list, cat, grep or copy anything outside this repo,** with three exceptions:
   - read-only `git` operations on `/Users/joshua/Peridot/peridot-contracts-2-5` (`git show`, `git archive`, `git ls-tree`, `git log`, `git diff`) at a pinned commit;
   - the handoff file;
   - the testnet key path below, and only through a shell variable.

   Never touch `/Users/joshua/Peridot/secrets`, `.deployers`, any `.*-signer` directory, `private-keys`, `.env` files in other repos, `~/.ssh` or keychains. Prior Peridot keys were compromised on 2026-11-02, so treat everything outside this repo as sensitive.
2. **Testnet deployer:**
   - The address is `0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67`. It is a fresh key used only on chain 1952 testnet.
   - Use the key only as `--private-key "$(cat /Users/joshua/Peridot/OKX/.testnet-keys/deployer.key)"` or by exporting an env var inside a shell command.
   - Never echo, print, log or commit it, and never put it in a manifest or the frontend.
   - Never use it on mainnet.
3. **No mainnet transactions of any kind.** This includes fabrication, deployment, approval and transfer. Read-only mainnet RPC calls and `anvil --fork-url` forks are allowed.
4. Do not modify other repositories under `/Users/joshua/Peridot`. Do not check out, add worktrees to, build in, or write to them.
5. **Git:**
   - Commit only your own paths, using explicit pathspecs (`git add <paths>`, never `git add -A` or `git add .`).
   - No force-push, no history rewrite, no branch deletion. Do not push or create remotes (founder decision pending).
   - If `.git/index.lock` exists, wait and retry.
   - Add a body line `Agent: <role> (<model>)` to each commit.
6. Never fabricate a test result, transaction hash, address or PR. Never call a fake processor "TapeOut". Label every mock, fixture, fork and simulation as such.

## Path ownership (exclusive writers)
| Path | Owner |
|---|---|
| `contracts/**`, `packages/circuit-sdk/**`, `packages/chain-config/**` (generated ABIs and manifests), `services/**`, `deployments/**`, `docs/TAPEOUT_INTEGRATION.md`, `docs/ARCHITECTURE.md`, `docs/RISK_MODEL.md`, `docs/SECURITY_MODEL.md`, `docs/coordination/INTERFACES.md` | Astra |
| `apps/web/**` | Fable |
| `docs/coordination/STATUS.md`, `docs/coordination/DECISIONS.md`, `docs/PRIOR_WORK_AND_DIFF.md`, `docs/SUBMISSION_EVIDENCE.md`, `docs/MAINNET_RELEASE_GATE.md`, `docs/DEMO_RUNBOOK.md`, root config files, this file | Claude |
| `docs/coordination/MILESTONE_LOG.md` | Append-only, all agents. Never edit an existing entry. |
| `docs/coordination/DEMO_MATRIX.md` | Astra fills contract/tx columns, Fable fills UI columns. Edit only your own cells. |
| `evidence/**` | Any agent may add files. Never overwrite another agent's files. |

Fable consumes `packages/chain-config` and `packages/circuit-sdk` but never edits them. If you need something in a path you don't own, write a request in `MILESTONE_LOG.md`.

## Engineering defaults
- **Stack:** Foundry (forge 1.7.1) for contracts, npm workspaces (pnpm is not installed), TypeScript, Next.js App Router, viem and wagmi.
- **Chains:** X Layer testnet `1952` (`https://testrpc.xlayer.tech`) and mainnet `196` (`https://rpc.xlayer.tech`). Both IDs were verified on 2026-11-25.
- **Testing:** during development, run lean smoke tests plus targeted negative tests on the critical path. Do not weaken or disable a test to get a green result.
- **Profiles:** the testnet profile has zero-delay admin. The release profile is separate and must be impossible to deploy with testnet settings by accident.
- **Amounts:** use bigint for every financial amount. Never use JS floating point for quantities.

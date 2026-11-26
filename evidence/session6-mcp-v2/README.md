# Sentinel Connect v2 evidence

[stdio-read.json](stdio-read.json) is an unsigned public-1952 run over an independent MCP stdio client. At the account-read block 47,249,510 the operator had 1 mock WOKB remaining and the account held 2. A 0.25 mock WOKB simulation returned 19.99 mock USDC. The negative simulation decoded `OperatorNotAuthorized()`. OKX was unavailable because this read-only child received no credentials. The file records separate observation blocks and hashes for each read.

Claude's operator run writes a separate `claude-transcript-*.ndjson`. Only a complete transcript plus the successful read-only chain reconciliation establish genuine LLM-driven execution. Execution and verification commands are in the [campaign runbook](../../services/mcp-v2/README.md).

#!/usr/bin/env bash
# Claude runs this once from the repository root with the dedicated D9 operator environment.
set -eu
set +x
exec node services/mcp-v2/host.mjs

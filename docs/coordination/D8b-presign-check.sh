#!/bin/sh
# Public read-only check. Optionally pass the proposed sender's public 0x address.
set -eu
cd "$(dirname "$0")/../.."
exec node evidence/session6-d8b/checks.mjs "$@"

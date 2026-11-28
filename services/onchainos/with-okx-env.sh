#!/bin/sh
# Runs ONE command with the three OKX Onchain OS read credentials in ITS environment only (DECISIONS D25).
#
#   sh services/onchainos/with-okx-env.sh node services/mcp-v2/host.mjs
#
# The credentials live in a founder-created file OUTSIDE the repository, default ../.okx-credentials/onchainos.env
# (override with PERIDOT_OKX_ENV). The file must belong to you, have mode 600, and contain only these lines:
#   OKX_API_KEY=...
#   OKX_API_SECRET=...
#   OKX_API_PASSPHRASE=...
# Blank lines and lines starting with # are ignored. The file is parsed, never sourced, so nothing in it runs.
# This script never prints a value. Astra and Fable must never run it or read the file.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="${PERIDOT_OKX_ENV:-$ROOT/../.okx-credentials/onchainos.env}"
[ "$#" -gt 0 ] || { echo "Usage: sh services/onchainos/with-okx-env.sh <command> [args...]" >&2; exit 2; }
[ -f "$FILE" ] || { echo "No OKX credentials file at the configured path (see docs/OKX_CREDENTIALS.md)" >&2; exit 2; }
case "$FILE" in "$ROOT"/*) echo "The OKX credentials file must be outside the repository" >&2; exit 2 ;; esac
MODE="$(stat -f %Lp "$FILE" 2>/dev/null || stat -c %a "$FILE")"
OWNER="$(stat -f %u "$FILE" 2>/dev/null || stat -c %u "$FILE")"
[ "$MODE" = "600" ] || { echo "The OKX credentials file must have mode 600 (run: chmod 600 <file>)" >&2; exit 2; }
[ "$OWNER" = "$(id -u)" ] || { echo "The OKX credentials file must belong to you" >&2; exit 2; }

unset OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE
LINE_NO=0
while IFS= read -r LINE || [ -n "$LINE" ]; do
  LINE_NO=$((LINE_NO + 1))
  LINE="$(printf '%s' "$LINE" | tr -d '\r')"
  case "$LINE" in ''|'#'*) continue ;; esac
  NAME="${LINE%%=*}"
  VALUE="${LINE#*=}"
  [ "$NAME" != "$LINE" ] || { echo "Line $LINE_NO of the credentials file is not NAME=value" >&2; exit 2; }
  case "$VALUE" in \"*\") VALUE="${VALUE#\"}"; VALUE="${VALUE%\"}" ;; \'*\') VALUE="${VALUE#\'}"; VALUE="${VALUE%\'}" ;; esac
  [ -n "$VALUE" ] || { echo "$NAME is empty in the credentials file" >&2; exit 2; }
  case "$NAME" in
    OKX_API_KEY) OKX_API_KEY="$VALUE" ;;
    OKX_API_SECRET) OKX_API_SECRET="$VALUE" ;;
    OKX_API_PASSPHRASE) OKX_API_PASSPHRASE="$VALUE" ;;
    *) echo "Line $LINE_NO names a variable other than the three OKX read credentials; refusing" >&2; exit 2 ;;
  esac
done < "$FILE"
[ -n "${OKX_API_KEY:-}" ] && [ -n "${OKX_API_SECRET:-}" ] && [ -n "${OKX_API_PASSPHRASE:-}" ] || { echo "The credentials file must set all three OKX variables" >&2; exit 2; }
export OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE
exec "$@"

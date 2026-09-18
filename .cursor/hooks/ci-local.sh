#!/usr/bin/env bash
# Cursor `stop` hook: run Gatefit's named verify gate.
# Stdout = JSON only. Logs on stderr.
set -euo pipefail

cat >/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ./ci-local.sh >&2; then
  printf '%s\n' '{}'
else
  printf '%s\n' '{"followup_message":"Verify gate ./ci-local.sh failed. Fix failures, re-run ./ci-local.sh, then continue. Do not open or update a PR on a red gate."}'
fi

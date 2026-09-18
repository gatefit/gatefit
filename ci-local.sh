#!/usr/bin/env bash
# Named verify gate for Gatefit (edipert/gatefit).
# Harness High: integrity of the Cursor agentic harness.
# Later Highs: plug entitlement-edge tests into the block at the bottom.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

fail() { echo "ci-local: FAIL: $*" >&2; exit 1; }
ok() { echo "ci-local: ok: $*" >&2; }

need_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
  ok "$1"
}

need_file AGENTS.md
need_file CLAUDE.md
need_file .cursor/HARNESS.md
need_file .cursor/rules/gatefit-cloud.mdc
need_file .cursor/hooks.json
need_file .cursor/hooks/ci-local.sh
need_file .cursor/environment.json
need_file .cursor/skills/verify-gate/SKILL.md

if [[ -d .cursor/skills/deploy-ios ]]; then
  fail "OtoPilot-only skill present: .cursor/skills/deploy-ios"
fi

if grep -E -q 'detekt|deploy-ios' .cursor/hooks.json .cursor/hooks/ci-local.sh; then
  fail "hooks mention detekt or deploy-ios (OtoPilot-only; not Gatefit)"
fi

if grep -E -q 'otopilot-cloud' .cursor/rules/*.mdc 2>/dev/null; then
  fail "rules still named/copied as otopilot-cloud; use gatefit-cloud.mdc"
fi

# Entitlement suite plug-in (product logic is out of scope for this High).
if [[ -d tests/entitlements ]] && compgen -G 'tests/entitlements/*' >/dev/null; then
  echo "ci-local: tests/entitlements/ present — no runner wired yet" >&2
  echo "ci-local: later High must invoke the entitlement runner from this script" >&2
else
  ok "entitlement suite not present yet (placeholder)"
fi

echo "ci-local: PASS" >&2

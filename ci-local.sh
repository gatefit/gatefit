#!/usr/bin/env bash
# Named verify gate for Gatefit (edipert/gatefit).
# Harness integrity plus GATEFIT-H2 entitlement CLI / S1/S2 goldens.
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

need_file package.json
need_file src/cli.ts
need_file src/access-adapter.ts
need_file src/fixture-driver.ts
need_file src/adapters/naive.ts
need_file src/adapters/hardened.ts
need_file tests/entitlements/goldens/paid_grants_access.yaml
need_file tests/entitlements/goldens/cancel_revokes_access.yaml

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for entitlement goldens"
fi

npm install --ignore-scripts >&2
npx tsx --test --test-concurrency=1 tests/entitlements/*.test.ts || fail "entitlement unit tests"
npx tsx src/cli.ts adapter-check || fail "adapter-check"
npx tsx src/cli.ts run --suite tests/entitlements/goldens --adapter src/adapters/hardened.ts \
  || fail "hardened goldens"
ok "entitlement CLI + S1/S2 goldens"

echo "ci-local: PASS" >&2

#!/usr/bin/env bash
# Named verify gate for Gatefit (edipert/gatefit).
# Harness integrity plus GATEFIT-H3 entitlement CLI / S1–S6 goldens / Action sanity.
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
need_file src/access-rules.ts
need_file src/fixture-driver.ts
need_file src/adapters/naive.ts
need_file src/adapters/hardened.ts
need_file src/adapters/sqlite.ts
need_file tests/entitlements/goldens/paid_grants_access.yaml
need_file tests/entitlements/goldens/cancel_revokes_access.yaml
need_file tests/entitlements/goldens/refund_revokes_access.yaml
need_file tests/entitlements/goldens/trial_to_paid_grants.yaml
need_file tests/entitlements/goldens/past_due_denies_until_recovery.yaml
need_file tests/entitlements/goldens/duplicate_webhook_idempotent.yaml
need_file .github/actions/gatefit/action.yml
need_file docs/bring-your-adapter.md

if ! grep -q 'cli.ts' .github/actions/gatefit/action.yml; then
  fail "Action does not invoke src/cli.ts"
fi
if ! grep -q 'run --suite' .github/actions/gatefit/action.yml; then
  fail "Action does not wrap gatefit run --suite"
fi
ok "Action wraps gatefit run"

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for entitlement goldens"
fi

npm install --ignore-scripts >&2
npx tsc --noEmit || fail "typecheck"
# Files share process.env (GATEFIT_LIVE_CLOCK probe); keep the test runner serial.
npx tsx --test --test-concurrency=1 tests/entitlements/*.test.ts || fail "entitlement unit tests"
npx tsx src/cli.ts adapter-check || fail "adapter-check"
npx tsx src/cli.ts run --suite tests/entitlements/goldens --adapter src/adapters/hardened.ts \
  || fail "hardened goldens"
npx tsx src/cli.ts run --suite tests/entitlements/goldens --adapter src/adapters/sqlite.ts \
  || fail "sqlite goldens"
if npx tsx src/cli.ts run --suite tests/entitlements/goldens --adapter src/adapters/naive.ts; then
  fail "naive unexpectedly passed goldens"
fi
ok "entitlement CLI + S1–S6 goldens (hardened/sqlite pass, naive fails)"

echo "ci-local: PASS" >&2

#!/usr/bin/env bash
# Named verify gate for Gatefit (edipert/gatefit).
# Harness integrity plus GATEFIT-H4 packaging / npx / Action, and H3 S1–S6 goldens.
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
need_file src/paths.ts
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
need_file action.yml
need_file scripts/action-run.sh
need_file LICENSE
need_file docs/publish.md
need_file bin/gatefit.js

if ! grep -q 'bin/gatefit.js' scripts/action-run.sh; then
  fail "Action runner does not invoke bin/gatefit.js"
fi
if ! grep -q 'run --suite' scripts/action-run.sh; then
  fail "Action runner does not wrap gatefit run --suite"
fi
ok "Action wraps gatefit bin"

if ! grep -q 'npx gatefit' README.md; then
  fail "README missing npx gatefit DX"
fi
if ! grep -q '\$29' README.md || ! grep -q '\$19' README.md; then
  fail "README missing indie pricing copy"
fi
ok "README DX + pricing"

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for entitlement goldens"
fi

npm install --ignore-scripts >&2
npx tsc --noEmit || fail "typecheck"
# Files share process.env (GATEFIT_LIVE_CLOCK probe); keep the test runner serial.
npx tsx --test --test-concurrency=1 tests/entitlements/*.test.ts || fail "entitlement unit tests"

ver_out="$(node bin/gatefit.js --version 2>&1)" || fail "gatefit --version"
echo "$ver_out" | grep -q 'gatefit 0.4.0' || fail "unexpected --version: $ver_out"
ok "gatefit --version"

node bin/gatefit.js adapter-check || fail "adapter-check via bin"
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/hardened.ts \
  || fail "hardened goldens"
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/sqlite.ts \
  || fail "sqlite goldens"
naive_out="$(node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/naive.ts 2>&1 || true)"
echo "$naive_out" >&2
echo "$naive_out" | grep -q 'gatefit: FAIL' || fail "naive did not report FAIL"
ok "entitlement CLI + S1–S6 goldens (hardened/sqlite pass, naive fails)"

pack_json="$(npm pack --dry-run --json)"
echo "$pack_json" | grep -q 'bin/gatefit.js' || fail "npm pack missing bin/gatefit.js"
echo "$pack_json" | grep -q 'src/cli.ts' || fail "npm pack missing src/cli.ts"
ok "npm pack dry-run"

pack_dir="$(mktemp -d)"
user_dir="$(mktemp -d)"
npm pack --pack-destination "$pack_dir" >/dev/null
tgz="$(ls "$pack_dir"/gatefit-*.tgz)"
(
  cd "$user_dir"
  npm init -y >/dev/null
  npm install --ignore-scripts "$tgz" >/dev/null
  npx gatefit --version | grep -q 'gatefit 0.4.0'
  npx gatefit adapter-check
) || fail "tarball adapter-check"
ok "npx from packed tarball"

echo "ci-local: PASS" >&2

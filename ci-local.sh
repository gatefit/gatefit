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
need_file tests/entitlements/goldens/seat_qty_vs_db_cap.yaml
need_file tests/entitlements/goldens/cancel_at_period_end_keeps_access_until_end.yaml
need_file tests/entitlements/goldens/upgrade_plus_cape_race.yaml
need_file tests/entitlements/goldens/dispute_revokes_or_flags.yaml
need_file tests/entitlements/goldens/unpaid_after_retries_revokes.yaml
need_file .github/actions/gatefit/action.yml
need_file docs/bring-your-adapter.md
need_file action.yml
need_file scripts/action-run.sh
need_file LICENSE
need_file docs/publish.md
need_file bin/gatefit.js
need_file src/stripe-clock.ts
need_file src/clock-driver.ts
need_file src/live-scenarios.ts
need_file docs/live-clock.md
need_file .github/workflows/live-clock.yml

if ! grep -q 'bin/gatefit.js' scripts/action-run.sh; then
  fail "Action runner does not invoke bin/gatefit.js"
fi
if ! grep -q 'run --suite' scripts/action-run.sh; then
  fail "Action runner does not wrap gatefit run --suite"
fi
ok "Action wraps gatefit bin"

if grep -q 'GATEFIT_LIVE_CLOCK' .github/workflows/ci.yml; then
  fail "default ci.yml must not set GATEFIT_LIVE_CLOCK"
fi
if ! grep -q 'head.repo.full_name == github.repository' .github/workflows/live-clock.yml; then
  fail "live-clock workflow must skip fork PRs"
fi
if ! grep -q 'GATEFIT_LIVE_CLOCK' .github/workflows/live-clock.yml; then
  fail "live-clock workflow must opt in with GATEFIT_LIVE_CLOCK"
fi
ok "live lane gated (not default CI; forks skip)"

if ! grep -q 'npx gatefit' README.md; then
  fail "README missing npx gatefit DX"
fi
if ! grep -q '\$49' README.md || ! grep -q '\$19' README.md; then
  fail "README missing indie pricing copy"
fi
ok "README DX + pricing"

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for entitlement goldens"
fi

# GATEFIT-H11 distribution fail-modes. Encoded before the release files exist.
# Collect every miss, then exit, so a red run shows the whole set.
dist_fails=0
dist_fail() { echo "ci-local: FAIL: $*" >&2; dist_fails=$((dist_fails + 1)); return 0; }

pkg_ver="$(node -p "require('./package.json').version")"
expected_tag="v${pkg_ver}"

tag_matches_package() { [[ "$1" == "$expected_tag" ]]; }
if tag_matches_package "v0.0.0-mismatch"; then
  dist_fail "tag mismatch check accepted v0.0.0-mismatch"
fi
tag_matches_package "$expected_tag" || dist_fail "package version tag ${expected_tag} was rejected"

# Listing checker: bin required; site/, env files, and secret-shaped lines rejected.
pack_listing_ok() {
  local listing="$1"
  if echo "$listing" | grep -E '(^|/)site/|(^|/)\.env($|\.)|(^|/)[^/]*\.pem$|(^|/)id_rsa($|\.)|(^|/)credentials\.json$' >/dev/null; then
    return 1
  fi
  if echo "$listing" | grep -E 'sk_live_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY' >/dev/null; then
    return 1
  fi
  echo "$listing" | grep -q 'bin/gatefit.js' || return 1
  return 0
}
if pack_listing_ok $'bin/gatefit.js\nsite/dist/index.html'; then
  dist_fail "tarball checker accepted a site/ leak"
fi
if pack_listing_ok $'bin/gatefit.js\n.env'; then
  dist_fail "tarball checker accepted a secret file"
fi
if pack_listing_ok $'src/cli.ts\nLICENSE'; then
  dist_fail "tarball checker accepted a pack with no bin"
fi
if ! pack_listing_ok $'bin/gatefit.js\nsrc/cli.ts\nLICENSE'; then
  dist_fail "tarball checker rejected a clean listing"
fi

node -e '
const pkg = require("./package.json");
if (!pkg.bin || pkg.bin.gatefit !== "./bin/gatefit.js") process.exit(1);
const files = pkg.files || [];
if (files.some((f) => f === "site" || f.startsWith("site/"))) process.exit(2);
' || dist_fail "package.json bin missing or files includes site/"

if grep -n 'npm publish' ci-local.sh | grep -v -- '--dry-run' >/dev/null; then
  dist_fail "ci-local.sh registry write is not a --dry-run"
fi
if [[ -n "${NPM_TOKEN:-}" || -n "${NODE_AUTH_TOKEN:-}" ]]; then
  dist_fail "npm token is set; refusing the publish lane"
fi

[[ -f CHANGELOG.md ]] || dist_fail "missing CHANGELOG.md"
[[ -f "docs/release-${expected_tag}.md" ]] || dist_fail "missing docs/release-${expected_tag}.md"
[[ -f scripts/deploy-site.sh ]] || dist_fail "missing scripts/deploy-site.sh"
[[ -f .npmignore ]] || dist_fail "missing .npmignore"

if [[ -f CHANGELOG.md ]]; then
  changelog_ver="$(grep -E '^## \[' CHANGELOG.md | head -1 | sed -E 's/^## \[([^]]+)\].*/\1/')"
  [[ "$changelog_ver" == "$pkg_ver" ]] || dist_fail "CHANGELOG ${changelog_ver:-missing} != package.json ${pkg_ver}"
fi
rel="docs/release-${expected_tag}.md"
if [[ -f "$rel" ]]; then
  grep -q "uses: edipert/gatefit@${expected_tag}" "$rel" || dist_fail "release notes missing root Action uses path"
  grep -q "uses: edipert/gatefit/.github/actions/gatefit@${expected_tag}" "$rel" || dist_fail "release notes missing nested Action uses path"
fi
for uses_doc in README.md docs/publish.md site/src/content/docs/action.md; do
  grep -q "uses: edipert/gatefit@${expected_tag}" "$uses_doc" || dist_fail "${uses_doc} missing root Action uses path"
  grep -q "uses: edipert/gatefit/.github/actions/gatefit@${expected_tag}" "$uses_doc" || dist_fail "${uses_doc} missing nested Action uses path"
  if grep -q 'uses: edipert/gatefit/action.yml@' "$uses_doc"; then
    dist_fail "${uses_doc} has the wrong Action uses path"
  fi
done
grep -q 'using: composite' action.yml || dist_fail "root action.yml is not composite"
grep -q 'scripts/action-run.sh' action.yml || dist_fail "root action.yml does not call scripts/action-run.sh"
grep -q 'using: composite' .github/actions/gatefit/action.yml || dist_fail "nested action.yml is not composite"
grep -q 'scripts/action-run.sh' .github/actions/gatefit/action.yml || dist_fail "nested action.yml does not call scripts/action-run.sh"

grep -q '\*\*Docs site:\*\* coming soon' README.md || dist_fail "README docs site is not marked coming soon"
grep -q '\*\*npm:\*\* coming soon' README.md || dist_fail "README npm is not marked coming soon"
grep -q '\*\*Polar checkout:\*\* coming soon' README.md || dist_fail "README Polar checkout is not marked coming soon"
grep -q 'GitHub Pages needs a public repository or a paid plan' README.md || dist_fail "README missing GitHub Pages public-or-paid requirement"

if [[ -f scripts/deploy-site.sh ]]; then
  grep -q 'GATEFIT_SITE_DIST' scripts/deploy-site.sh || dist_fail "deploy-site missing GATEFIT_SITE_DIST"
  grep -q 'GATEFIT_DEPLOY_TARGET' scripts/deploy-site.sh || dist_fail "deploy-site missing GATEFIT_DEPLOY_TARGET"
  grep -q 'GATEFIT_DEPLOY_DEST' scripts/deploy-site.sh || dist_fail "deploy-site missing GATEFIT_DEPLOY_DEST"
  grep -q 'public repository or a paid plan' scripts/deploy-site.sh || dist_fail "deploy-site missing GitHub Pages requirement"
  if grep -E '^[[:space:]]*(npm[[:space:]]+publish|git[[:space:]]+tag|gh[[:space:]]+release)' scripts/deploy-site.sh >/dev/null; then
    dist_fail "deploy-site runs a registry write, tag, or release"
  fi
fi
if [[ -f .npmignore ]]; then
  grep -q '^site/' .npmignore || dist_fail ".npmignore must exclude site/"
fi

while IFS= read -r honesty_file; do
  if grep -q 'edipert.github.io/gatefit' "$honesty_file"; then
    grep -qi 'coming soon' "$honesty_file" || dist_fail "${honesty_file} mentions the docs site without coming soon"
  fi
done < <(find README.md docs site/README.md site/src -type f \( -name '*.md' -o -name '*.mdx' -o -name '*.astro' \))

if grep -R -n --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.astro \
  'buy.polar.sh/products/' README.md docs site >/dev/null; then
  dist_fail "docs advertise a buy.polar.sh/products/ URL (no working checkout)"
fi

if [[ "$dist_fails" -ne 0 ]]; then
  fail "distribution readiness (${dist_fails} failure(s))"
fi
ok "distribution readiness (version, Action paths, honesty, pack rules)"

npm install --ignore-scripts >&2
# Named gate is fixture-first even if a caller exported the live flag.
unset GATEFIT_LIVE_CLOCK
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

pack_json_file="$(mktemp)"
npm pack --dry-run --json >"$pack_json_file"
pack_listing="$(node -e '
const fs = require("fs");
const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const entry = Array.isArray(parsed) ? parsed[0] : parsed;
for (const file of entry.files || []) console.log(file.path);
' "$pack_json_file")"
rm -f "$pack_json_file"
echo "$pack_listing" | grep -q 'bin/gatefit.js' || fail "npm pack missing bin/gatefit.js"
echo "$pack_listing" | grep -q 'src/cli.ts' || fail "npm pack missing src/cli.ts"
echo "$pack_listing" | grep -q 'CHANGELOG.md' || fail "npm pack missing CHANGELOG.md"
pack_listing_ok "$pack_listing" || fail "npm pack listing failed the leak/bin checker"
ok "npm pack dry-run"

pack_dir="$(mktemp -d)"
user_dir="$(mktemp -d)"
extract_dir="$(mktemp -d)"
npm pack --pack-destination "$pack_dir" >/dev/null
tgz="$(ls "$pack_dir"/gatefit-*.tgz)"
[[ "$(basename "$tgz")" == "gatefit-${pkg_ver}.tgz" ]] || fail "tarball name != gatefit-${pkg_ver}.tgz"
tar -xzf "$tgz" -C "$extract_dir"
[[ -f "$extract_dir/package/bin/gatefit.js" ]] || fail "unpacked tarball missing bin/gatefit.js"
[[ ! -d "$extract_dir/package/site" ]] || fail "unpacked tarball leaks site/"
if find "$extract_dir/package" -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name 'id_rsa' | grep -q .; then
  fail "unpacked tarball leaks env or key files"
fi
if grep -R -E -n 'sk_live_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY' "$extract_dir/package" >/dev/null; then
  fail "unpacked tarball contains secret material"
fi
ok "unpacked tarball (bin present, site/ and secrets absent)"
(
  cd "$user_dir"
  npm init -y >/dev/null
  npm install --ignore-scripts "$tgz" >/dev/null
  npx gatefit --version | grep -q 'gatefit 0.4.0'
  npx gatefit adapter-check
) || fail "tarball adapter-check"
ok "npx from packed tarball"

publish_log="$(mktemp)"
if ! npm publish --dry-run --ignore-scripts >"$publish_log" 2>&1; then
  cat "$publish_log" >&2
  fail "npm publish --dry-run"
fi
grep -q '(dry-run)' "$publish_log" || fail "npm publish --dry-run marker missing"
grep -q "gatefit@${pkg_ver}" "$publish_log" || fail "npm publish --dry-run package version mismatch"
grep -q 'bin/gatefit.js' "$publish_log" || fail "npm publish --dry-run missing bin/gatefit.js"
if grep -E '(^| )site/|(^|/)\.env' "$publish_log" >/dev/null; then
  fail "npm publish --dry-run tarball leaks site/ or .env"
fi
rm -f "$publish_log"
ok "npm publish --dry-run"

need_file site/astro.config.mjs
need_file site/src/lib/polarCheckout.ts
need_file site/src/components/PolarBuyCta.astro
need_file site/src/content/docs/index.mdx
need_file site/src/content/docs/quickstart.md
need_file site/src/content/docs/action.md
need_file site/src/content/docs/polar.md
need_file docs/polar.md
need_file .github/workflows/pages.yml
if ! grep -q 'data-polar-checkout' site/src/components/PolarBuyCta.astro; then
  fail "Polar CTA missing data-polar-checkout"
fi
if grep -q 'GATEFIT_LIVE_CLOCK' .github/workflows/pages.yml; then
  fail "pages.yml must not set GATEFIT_LIVE_CLOCK"
fi
ok "site files + Polar CTA"
(
  cd site
  npm ci
  npm run build
) || fail "starlight site build"
ok "starlight site build"
if ! grep -q 'data-polar-checkout-pending' site/dist/index.html; then
  fail "unset Polar URL must fail closed (pending CTA) in site build"
fi
if grep -q 'href="https://polar.sh' site/dist/index.html; then
  fail "placeholder polar.sh href leaked into site build"
fi
ok "site build Polar CTA fail-closed"

if grep -R -n 'buy.polar.sh/products/' site/dist >/dev/null; then
  fail "built site advertises a buy.polar.sh/products/ URL"
fi
grep -R -q 'coming soon' site/dist || fail "built site does not say coming soon"
ok "built site honesty"

if GATEFIT_SITE_DIST="/tmp/gatefit-missing-dist-$$" GATEFIT_DEPLOY_TARGET=local \
  GATEFIT_DEPLOY_DEST="/tmp/gatefit-deploy-should-not-matter-$$" \
  bash scripts/deploy-site.sh >/dev/null 2>&1; then
  fail "deploy-site accepted a missing dist"
fi
if GATEFIT_SITE_DIST="$ROOT/site/dist" GATEFIT_DEPLOY_TARGET=local \
  GATEFIT_DEPLOY_DEST=/ \
  bash scripts/deploy-site.sh >/dev/null 2>&1; then
  fail "deploy-site accepted dest /"
fi
deploy_dest="$(mktemp -d)"
GATEFIT_SITE_DIST="$ROOT/site/dist" GATEFIT_DEPLOY_TARGET=local \
  GATEFIT_DEPLOY_DEST="$deploy_dest" \
  bash scripts/deploy-site.sh || fail "deploy-site local copy"
src_index="$(find "$ROOT/site/dist" -name 'index.html' -type f -print -quit)"
[[ -n "$src_index" ]] || fail "site/dist has no index.html"
rel="${src_index#"$ROOT/site/dist"/}"
[[ -f "$deploy_dest/$rel" ]] || fail "deploy-site local copy missing ${rel}"
cmp "$src_index" "$deploy_dest/$rel" >/dev/null || fail "deploy-site local copy does not match ${rel}"
ok "deploy-site local"

echo "ci-local: PASS" >&2

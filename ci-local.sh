#!/usr/bin/env bash
# Named verify gate for Gatefit (gatefit/gatefit).
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
need_file src/init.ts
need_file src/init/templates/adapter.ts.tpl
need_file src/init/templates/access-rules.ts.tpl
need_file src/init/templates/workflow.yml.tpl
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
need_file tests/entitlements/goldens/trial_no_card.yaml
need_file tests/entitlements/goldens/portal_downgrade_period_end_vs_immediate.yaml
need_file tests/entitlements/goldens/entitlements_active_summary.yaml
need_file tests/entitlements/goldens/README.md
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
if ! grep -q '\$49' README.md; then
  fail "README missing indie pricing copy"
fi
if grep -Eq '\$19|optional updates' README.md; then
  fail "README still mentions a monthly updates plan"
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
repo_url="$(node -p "require('./package.json').repository.url")"
[[ "$repo_url" == "git+https://github.com/gatefit/gatefit.git" ]] || dist_fail "package.json repository.url must be git+https://github.com/gatefit/gatefit.git"
publish_wf=".github/workflows/publish.yml"
[[ -f "$publish_wf" ]] || dist_fail "missing ${publish_wf}"
if [[ -f "$publish_wf" ]]; then
  if grep -E -i 'NPM_TOKEN|NODE_AUTH_TOKEN' "$publish_wf" >/dev/null; then
    dist_fail "publish.yml references an npm token"
  fi
  grep -q 'id-token: write' "$publish_wf" || dist_fail "publish.yml missing id-token: write"
  grep -q 'environment: npm' "$publish_wf" || dist_fail "publish.yml publish job missing environment npm"
fi

[[ -f CHANGELOG.md ]] || dist_fail "missing CHANGELOG.md"
[[ -f "docs/release-${expected_tag}.md" ]] || dist_fail "missing docs/release-${expected_tag}.md"
[[ -f scripts/deploy-site.sh ]] || dist_fail "missing scripts/deploy-site.sh"
[[ -f .npmignore ]] || dist_fail "missing .npmignore"

if [[ -f CHANGELOG.md ]]; then
  changelog_ver="$(grep -E '^## \[[0-9]+' CHANGELOG.md | head -1 | sed -E 's/^## \[([^]]+)\].*/\1/')"
  [[ "$changelog_ver" == "$pkg_ver" ]] || dist_fail "CHANGELOG ${changelog_ver:-missing} != package.json ${pkg_ver}"
fi
rel="docs/release-${expected_tag}.md"
if [[ -f "$rel" ]]; then
  grep -q "uses: gatefit/gatefit@${expected_tag}" "$rel" || dist_fail "release notes missing root Action uses path"
  grep -q "uses: gatefit/gatefit/.github/actions/gatefit@${expected_tag}" "$rel" || dist_fail "release notes missing nested Action uses path"
fi
for uses_doc in README.md docs/publish.md site/src/content/docs/action.md; do
  grep -q "uses: gatefit/gatefit@${expected_tag}" "$uses_doc" || dist_fail "${uses_doc} missing root Action uses path"
  grep -q "uses: gatefit/gatefit/.github/actions/gatefit@${expected_tag}" "$uses_doc" || dist_fail "${uses_doc} missing nested Action uses path"
  if grep -q 'uses: gatefit/gatefit/action.yml@' "$uses_doc"; then
    dist_fail "${uses_doc} has the wrong Action uses path"
  fi
done
grep -q 'using: composite' action.yml || dist_fail "root action.yml is not composite"
grep -q 'scripts/action-run.sh' action.yml || dist_fail "root action.yml does not call scripts/action-run.sh"
grep -q 'using: composite' .github/actions/gatefit/action.yml || dist_fail "nested action.yml is not composite"
grep -q 'scripts/action-run.sh' .github/actions/gatefit/action.yml || dist_fail "nested action.yml does not call scripts/action-run.sh"

grep -q '\*\*Docs site:\*\* live' README.md || dist_fail "README docs site is not marked live"
grep -q 'https://gatefit.io' README.md || dist_fail "README missing https://gatefit.io"
if grep -q '\*\*Docs site:\*\* coming soon' README.md; then
  dist_fail "README still marks the docs site coming soon"
fi
grep -q 'https://www.npmjs.com/package/gatefit' README.md || dist_fail "README missing https://www.npmjs.com/package/gatefit"
grep -q 'npx gatefit' README.md || dist_fail "README missing npx gatefit"
if grep -q 'H12 is on HOLD\|npm is not on the registry\|registry package is not published' README.md; then
  dist_fail "README still marks npm unpublished or H12 on HOLD"
fi
if grep -q 'coming soon' README.md docs/publish.md docs/polar.md docs/release-v0.4.0.md "docs/release-${expected_tag}.md" CHANGELOG.md; then
  dist_fail "docs still mark npm coming soon"
fi
grep -q 'https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0' README.md \
  || dist_fail "README missing the Gatefit Indie License Checkout Link"
grep -q '\$49' README.md || dist_fail "README missing \$49 Indie License price"
grep -q 'GitHub Pages needs a public repository or a paid plan' README.md || dist_fail "README missing GitHub Pages public-or-paid requirement"
grep -q 'gatefit-bdu.pages.dev' README.md || dist_fail "README missing gatefit-bdu.pages.dev"
if grep -F 'gatefit.pages.dev' README.md >/dev/null; then
  dist_fail "README uses gatefit.pages.dev; the host is gatefit-bdu.pages.dev"
fi

if [[ -f scripts/deploy-site.sh ]]; then
  grep -q 'GATEFIT_SITE_DIST' scripts/deploy-site.sh || dist_fail "deploy-site missing GATEFIT_SITE_DIST"
  grep -q 'GATEFIT_DEPLOY_TARGET' scripts/deploy-site.sh || dist_fail "deploy-site missing GATEFIT_DEPLOY_TARGET"
  grep -q 'GATEFIT_DEPLOY_DEST' scripts/deploy-site.sh || dist_fail "deploy-site missing GATEFIT_DEPLOY_DEST"
  grep -q 'public repository or a paid plan' scripts/deploy-site.sh || dist_fail "deploy-site missing GitHub Pages requirement"
  grep -q 'wrangler@4 pages deploy' scripts/deploy-site.sh || dist_fail "deploy-site missing wrangler pages deploy"
  grep -q -- '--project-name gatefit' scripts/deploy-site.sh || dist_fail "deploy-site missing --project-name gatefit"
  grep -q 'gatefit-bdu.pages.dev' scripts/deploy-site.sh || dist_fail "deploy-site missing gatefit-bdu.pages.dev"
  grep -q 'CLOUDFLARE_API_TOKEN' scripts/deploy-site.sh || dist_fail "deploy-site missing CLOUDFLARE_API_TOKEN"
  grep -q 'CLOUDFLARE_ACCOUNT_ID' scripts/deploy-site.sh || dist_fail "deploy-site missing CLOUDFLARE_ACCOUNT_ID"
  if grep -F 'gatefit.pages.dev' scripts/deploy-site.sh >/dev/null; then
    dist_fail "deploy-site uses gatefit.pages.dev; the host is gatefit-bdu.pages.dev"
  fi
  if grep -E '^[[:space:]]*(npm[[:space:]]+publish|git[[:space:]]+tag|gh[[:space:]]+release)' scripts/deploy-site.sh >/dev/null; then
    dist_fail "deploy-site runs a registry write, tag, or release"
  fi
fi
if [[ -f .npmignore ]]; then
  grep -q '^site/' .npmignore || dist_fail ".npmignore must exclude site/"
fi

while IFS= read -r honesty_file; do
  if grep -q '.github.io/gatefit' "$honesty_file"; then
    dist_fail "${honesty_file} still points the docs site at a github.io/gatefit host"
  fi
done < <(find README.md docs site/README.md site/src -type f \( -name '*.md' -o -name '*.mdx' -o -name '*.astro' -o -name '*.css' \))

if grep -R -n --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.astro \
  'buy.polar.sh/products/' README.md docs site >/dev/null; then
  dist_fail "docs advertise a buy.polar.sh/products/ URL (not the Checkout Link)"
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
unit_log="$(mktemp)"
npx tsx --test --test-concurrency=1 tests/entitlements/*.test.ts 2>&1 | tee "$unit_log" || fail "entitlement unit tests"
# init Postgres lane (H23) needs local initdb/pg_ctl/psql; it skips with a reason otherwise.
if grep -q 'gatefit init: Postgres lane ran' "$unit_log"; then
  for t in drizzle prisma supabase generic; do
    grep -q "gatefit init: Postgres lane ${t} PASS" "$unit_log" || fail "init Postgres lane ${t} did not pass"
  done
  ok "init Postgres lane: ran (drizzle, prisma, supabase, generic)"
else
  echo "ci-local: init Postgres lane: SKIPPED (no initdb/pg_ctl/psql; set GATEFIT_PG_BIN)" >&2
fi
rm -f "$unit_log"

ver_out="$(node bin/gatefit.js --version 2>&1)" || fail "gatefit --version"
echo "$ver_out" | grep -q "gatefit ${pkg_ver}" || fail "unexpected --version: $ver_out"
ok "gatefit --version"

node bin/gatefit.js adapter-check || fail "adapter-check via bin"
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/hardened.ts \
  || fail "hardened goldens"
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/sqlite.ts \
  || fail "sqlite goldens"
naive_out="$(node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/naive.ts 2>&1 || true)"
echo "$naive_out" >&2
echo "$naive_out" | grep -q 'gatefit: FAIL' || fail "naive did not report FAIL"
ok "entitlement CLI + goldens (hardened/sqlite pass, naive fails)"

pack_json_file="$(mktemp)"
npm pack --dry-run --json >"$pack_json_file"
# npm 9 and 10 print an array. npm 12 prints { "<name>": { files } }.
pack_listing="$(node -e '
const fs = require("fs");
const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
function withFiles(value) {
  return value && Array.isArray(value.files) ? value : null;
}
let entry = null;
if (Array.isArray(parsed)) entry = parsed.find(withFiles) || null;
else entry = withFiles(parsed) || Object.values(parsed).find(withFiles) || null;
if (!entry) {
  console.error("npm pack --json had no files list");
  process.exit(1);
}
for (const file of entry.files) console.log(file.path);
' "$pack_json_file")"
rm -f "$pack_json_file"
echo "$pack_listing" | grep -q 'bin/gatefit.js' || fail "npm pack missing bin/gatefit.js"
echo "$pack_listing" | grep -q 'src/cli.ts' || fail "npm pack missing src/cli.ts"
for tpl in adapter.ts.tpl access-rules.ts.tpl db.ts.tpl migration.sql.tpl workflow.yml.tpl drizzle/schema.ts.tpl prisma/access.prisma.tpl; do
  echo "$pack_listing" | grep -q "src/init/templates/${tpl}" || fail "npm pack missing src/init/templates/${tpl}"
done
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
  npx gatefit --version | grep -q "gatefit ${pkg_ver}"
  npx gatefit adapter-check
  # init from the INSTALLED tarball (node_modules/gatefit is a real install, not a repo link).
  # errexit is off inside `( ... ) ||`, so every check exits explicitly.
  [[ -d node_modules/gatefit && ! -L node_modules/gatefit ]] || exit 1
  CI=true npx gatefit init --template generic >/dev/null || exit 1
  [[ -f gatefit/adapter.ts && -f gatefit/access-rules.ts && -f gatefit/migration.sql && -f gatefit.config.json ]] || exit 1
  if grep -R -E "from ['\"]gatefit" gatefit; then exit 1; fi
  npx gatefit init --template generic --print-workflow | grep -q "uses: gatefit/gatefit@v${pkg_ver}" || exit 1
) || fail "tarball adapter-check / init"
# Typecheck the generated adapter standalone. pg types come from this checkout;
# nothing maps the gatefit package, so a stray gatefit import would fail here.
cat >"$user_dir/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "typeRoots": ["$ROOT/node_modules/@types"],
    "types": ["node"],
    "paths": { "pg": ["$ROOT/node_modules/@types/pg/index.d.ts"] }
  },
  "files": ["gatefit/adapter.ts"]
}
EOF
node "$ROOT/node_modules/typescript/bin/tsc" -p "$user_dir/tsconfig.json" || fail "tarball init: generated adapter typecheck"
# Load it through the installed CLI: no DATABASE_URL must fail closed with a clear message.
tarball_run="$(cd "$user_dir" && env -u DATABASE_URL npx gatefit run --suite paid_grants_access --adapter gatefit/adapter.ts 2>&1 || true)"
echo "$tarball_run" | grep -q 'set DATABASE_URL' || fail "tarball init: generated adapter did not load or did not fail closed: $tarball_run"
ok "tarball init (installed package, standalone typecheck, adapter loads and fails closed)"
ok "npx from packed tarball"

publish_log="$(mktemp)"
# npm 12 contacts the registry during --dry-run and exits non-zero when this
# version is already published. That refusal is not a registry write. npm 9–11
# exit 0 for the same dry-run.
if ! npm publish --dry-run --ignore-scripts >"$publish_log" 2>&1; then
  if ! grep -F -q "cannot publish over the previously published versions: ${pkg_ver}" "$publish_log"; then
    cat "$publish_log" >&2
    fail "npm publish --dry-run"
  fi
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
need_file site/src/pages/index.astro
need_file site/public/_redirects
need_file site/src/content/docs/quickstart.md
need_file site/src/content/docs/action.md
need_file site/src/pages/polar.astro
need_file docs/polar.md
need_file .github/workflows/pages.yml
if grep -q 'data-polar-checkout' site/src/components/PolarBuyCta.astro; then
  fail "Polar CTA still uses a data-polar-checkout embed attribute"
fi
if grep -R -n --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro \
  -e 'embed.global.js' -e '@polar-sh/checkout' -e 'data-polar-checkout' site >/dev/null; then
  fail "site still loads the Polar checkout embed"
fi
if ! grep -q 'target="_blank"' site/src/components/PolarBuyCta.astro; then
  fail "Polar CTA missing target=_blank"
fi
if ! grep -q 'rel="noopener"' site/src/components/PolarBuyCta.astro; then
  fail "Polar CTA missing rel=noopener"
fi
if ! grep -q 'data-checkout-closed' site/src/components/PolarBuyCta.astro; then
  fail "Polar CTA missing closed marker for an invalid Checkout Link"
fi
if grep -q 'GATEFIT_LIVE_CLOCK' .github/workflows/pages.yml; then
  fail "pages.yml must not set GATEFIT_LIVE_CLOCK"
fi
grep -q 'https://gatefit.io' site/astro.config.mjs || fail "astro site is not https://gatefit.io"
grep -q "base: '/'" site/astro.config.mjs || fail "astro base is not /"
if grep -q "base: '/gatefit'" site/astro.config.mjs; then
  fail "astro base is still /gatefit"
fi
grep -q '/gatefit / 301' site/public/_redirects || fail "_redirects missing /gatefit 301"
grep -q '/gatefit/\* /:splat 301' site/public/_redirects || fail "_redirects missing /gatefit splat 301"
if grep -q 'Empty / unset fails closed' .github/workflows/pages.yml; then
  fail "pages.yml still says an empty PUBLIC_POLAR_CHECKOUT_URL fails closed"
fi
ok "site files + Polar CTA"
assert_h13_dist() {
  if grep -R -E -n --include='*.html' --include='*.css' --include='*.js' --include='*.mjs' \
    '/gatefit/_astro|href="/gatefit|src="/gatefit|url\(["'\'']?/gatefit/' site/dist >/dev/null; then
    fail "built dist contains /gatefit/ asset paths"
  fi
  grep -R -q 'prefers-reduced-motion' site/dist || fail "built site missing prefers-reduced-motion CSS"
  grep -R -q 'leak-stack' site/dist || fail "built site missing reduced-motion leak stack"
  if grep -R -E -n --include='*.html' --include='*.css' --include='*.js' --include='*.mjs' \
    'fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|api\.fontshare\.com' site/dist >/dev/null; then
    fail "built site loads an external font CDN"
  fi
  if grep -R -i -n -E 'coming soon|polar checkout is live|checkout is live|merchant of record|names match the goldens|docs live at|fixture goldens' site/dist >/dev/null; then
    fail "built site still has internal status copy"
  fi
  [[ -f site/dist/polar/index.html ]] || fail "built /polar/ is missing"
  if grep -q 'import PolarRedirect\|<PolarRedirect' site/dist/polar/index.html; then
    fail "built /polar/ shows the PolarRedirect component source"
  fi
  grep -q "location.replace('/#pricing')" site/dist/polar/index.html \
    || fail "built /polar/ does not redirect to /#pricing"
}
POLAR_CHECKOUT_URL='https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0'
assert_no_polar_embed() {
  local html="$1"
  if grep -q 'data-polar-checkout' "$html"; then
    fail "Polar embed attribute present in ${html}"
  fi
  if grep -q -e 'embed.global.js' -e '@polar-sh/checkout' "$html"; then
    fail "Polar checkout embed script present in ${html}"
  fi
}
assert_live_cta() {
  local html="$1" expected="$2"
  grep -q "href=\"${expected}\"" "$html" || fail "CTA href != ${expected} in ${html}"
  grep -q 'target="_blank"' "$html" || fail "CTA missing target=_blank in ${html}"
  grep -q 'rel="noopener"' "$html" || fail "CTA missing rel=noopener in ${html}"
  assert_no_polar_embed "$html"
  if grep -q 'data-checkout-closed' "$html"; then
    fail "live CTA marked closed in ${html}"
  fi
}
assert_pending_cta() {
  local html="$1" bad="$2"
  grep -q 'data-checkout-closed' "$html" || fail "override ${bad} did not stay closed in ${html}"
  assert_no_polar_embed "$html"
  if grep -q "href=\"${bad}\"" "$html"; then
    fail "override ${bad} leaked into CTA href"
  fi
  if grep -q "href=\"${POLAR_CHECKOUT_URL}\"" "$html"; then
    fail "invalid override fell back to the committed Checkout Link"
  fi
  if grep -q 'href="https://polar.sh' "$html"; then
    fail "polar.sh home href leaked into ${html}"
  fi
  if grep -q 'buy.polar.sh/products/' "$html"; then
    fail "product path leaked into ${html}"
  fi
}
(
  cd site
  npm ci
  # Empty override falls back to the committed Checkout Link.
  PUBLIC_POLAR_CHECKOUT_URL= npm run build
) || fail "starlight site build"
ok "starlight site build"
assert_live_cta site/dist/index.html "$POLAR_CHECKOUT_URL"
if grep -R -n 'buy.polar.sh/products/' site/dist >/dev/null; then
  fail "built site advertises a buy.polar.sh/products/ URL"
fi
grep -q '\$49' site/dist/index.html || fail "built landing missing \$49"
grep -q 'Indie License' site/dist/index.html || fail "built landing missing Indie License"
grep -q 'Buy for $49' site/dist/index.html || fail "built landing missing Buy for \$49"
if grep -Eq '\$19|optional updates' site/dist/index.html; then
  fail "built landing still mentions a monthly updates plan"
fi
assert_h13_dist
ok "built site default Checkout Link"

build_polar_override() {
  (cd site && PUBLIC_POLAR_CHECKOUT_URL="$1" npm run build) || fail "site rebuild for Polar override"
}
assert_pending_override() {
  build_polar_override "$1"
  assert_pending_cta site/dist/index.html "$1"
}
assert_pending_override 'https://buy.polar.sh/products/gatefit-one-time'
assert_pending_override 'https://polar.sh/'
assert_pending_override 'https://evil.example/checkout'
ok "invalid Polar overrides stay pending"
POLAR_OVERRIDE_URL='https://buy.polar.sh/polar_cl_TESTSHAPEONLY'
build_polar_override "$POLAR_OVERRIDE_URL"
assert_live_cta site/dist/index.html "$POLAR_OVERRIDE_URL"
if grep -q "href=\"${POLAR_CHECKOUT_URL}\"" site/dist/index.html; then
  fail "valid override did not replace the committed Checkout Link"
fi
ok "PUBLIC_POLAR_CHECKOUT_URL overrides the committed Checkout Link"
# Restore the default build so deploy-site publishes the committed link.
build_polar_override ''
assert_live_cta site/dist/index.html "$POLAR_CHECKOUT_URL"
assert_h13_dist
if grep -R -n --exclude-dir=node_modules '/cursor/stores' scripts >/dev/null; then
  fail "scripts hard-code /cursor/stores"
fi
grep -q 'GATEFIT_H13_SHOT_DIR' scripts/h13-frames.mjs || fail "h13-frames missing shot dir override"
grep -q '.artifacts/h13-frames' scripts/h13-frames.mjs || fail "h13-frames missing repo-relative shot dir"
node scripts/h13-frames.mjs site/dist || fail "hero or leak frames overlap or clip"
ok "hero and leak frames do not overlap"

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
src_index="$ROOT/site/dist/index.html"
[[ -f "$src_index" ]] || fail "site/dist has no landing index.html"
[[ -f "$deploy_dest/index.html" ]] || fail "deploy-site local copy missing index.html"
cmp "$src_index" "$deploy_dest/index.html" >/dev/null || fail "deploy-site local copy does not match index.html"
assert_live_cta "$deploy_dest/index.html" "$POLAR_CHECKOUT_URL"
ok "deploy-site local"

echo "ci-local: PASS" >&2

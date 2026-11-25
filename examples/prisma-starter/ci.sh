#!/usr/bin/env bash
# Prisma starter example. Package install is the only network step.
# Prisma telemetry stays off. The Gatefit run and the webhook scan stay on local files.
set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$example_dir/../.." && pwd)"
db="$example_dir/prisma/dev.db"

cleanup() {
  rm -f "$db" "${db}-journal"
}
trap cleanup EXIT

if [[ ! -d "$root/node_modules/tsx" || ! -d "$root/node_modules/better-sqlite3" ]]; then
  (cd "$root" && npm ci)
fi

cd "$example_dir"
npm ci

export CHECKPOINT_DISABLE=1
export PRISMA_HIDE_UPDATE_MESSAGE=1
npx prisma db push --skip-generate

node --input-type=module -e '
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(pathToFileURL(process.argv[1]));
const Database = require("better-sqlite3");
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
const names = db.prepare("PRAGMA table_info(Subscription)").all().map((column) => column.name);
const expected = ["id", "customerId", "priceId", "active", "startDate", "endDate", "cancelAt"];
const missing = expected.filter((name) => !names.includes(name));
if (missing.length > 0) {
  console.error("prisma-starter: Subscription is missing columns:", missing.join(", "));
  process.exit(1);
}
' "$root/package.json" "$db"

export GATEFIT_TELEMETRY=0
export DO_NOT_TRACK=1
unset GATEFIT_LIVE_CLOCK || true
unset GATEFIT_LICENSE_KEY || true
unset STRIPE_SECRET_KEY || true
unset STRIPE_API_KEY || true
unset STRIPE_WEBHOOK_SECRET || true
unset DATABASE_URL || true

set +e
run_out="$(node "$root/bin/gatefit.js" run --suite tests/entitlements/goldens --schema gatefit.schema.json 2>&1)"
run_code=$?
set -e
printf '%s\n' "$run_out"
if [[ "$run_code" -ne 0 ]]; then
  echo "prisma-starter: gatefit run exited ${run_code}" >&2
  exit "$run_code"
fi

expected="$(find "$root/tests/entitlements/goldens" -maxdepth 1 -name '*.yaml' | wc -l | tr -d ' ')"
passes="$(printf '%s\n' "$run_out" | grep -c '^gatefit: PASS ' || true)"
fails="$(printf '%s\n' "$run_out" | grep -c '^gatefit: FAIL ' || true)"
[[ "$fails" -eq 0 ]]
[[ "$passes" -eq "$expected" ]]
printf '%s\n' "$run_out" | grep -q 'event dedupe is not mapped'
printf '%s\n' "$run_out" | grep -q 'seats, features'

set +e
scan="$(node "$root/bin/gatefit.js" check-my-webhook --dir "$example_dir" 2>&1)"
scan_code=$?
set -e
printf '%s\n' "$scan"
[[ "$scan_code" -eq 1 ]]
printf '%s\n' "$scan" | grep -q 'pages/api/webhooks/stripe.ts'
printf '%s\n' "$scan" | grep -q 'possible missing event-id dedupe'
printf '%s\n' "$scan" | grep -q 'possible missing ordering guard'
printf '%s\n' "$scan" | grep -q 'possible status ignored on create'
printf '%s\n' "$scan" | grep -q 'possible update recreates a deleted row'
if printf '%s\n' "$scan" | grep -q 'possible missing signature check'; then
  echo "prisma-starter: handler lost its signature check" >&2
  exit 1
fi
if printf '%s\n' "$scan" | grep -E -q '\b(bug|vulnerability|definitely)\b'; then
  echo "prisma-starter: scan claimed a definite defect" >&2
  exit 1
fi

echo "prisma-starter: pass (${passes} goldens, check-my-webhook reported the starter gaps)"

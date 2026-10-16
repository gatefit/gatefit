---
name: verify-gate
description: Run Gatefit's named verify gate (./ci-local.sh) before opening or updating a PR, and before claiming the harness or entitlement pack is green.
---

# Gatefit verify gate

Use this skill whenever you are about to open a PR, update a PR, or claim work is complete.

## Command

```bash
./ci-local.sh
```

Exit 0 is green. Treat any non-zero as blocking.

## What it covers today

- Harness integrity (required agent files present; no OtoPilot-only detekt/iOS hooks or `deploy-ios` skill).
- Entitlement CLI: `gatefit adapter-check` (naive fails S1 / hardened passes S1).
- Hardened and SQLite S1–S6 goldens: `paid_grants_access`, `cancel_revokes_access`, `refund_revokes_access`, `trial_to_paid_grants`, `past_due_denies_until_recovery`, `duplicate_webhook_idempotent`.
- H6 fixture goldens: `seat_qty_vs_db_cap`, `cancel_at_period_end_keeps_access_until_end`, `upgrade_plus_cape_race` (time via fixture `period_end` / `now`, not wall clock).
- H7 fixture goldens: `dispute_revokes_or_flags`, `unpaid_after_retries_revokes` (dispute+clocks flake; fixtures only).
- Naive directory run must fail.
- Composite Action wraps `gatefit run` (repo-root `action.yml` plus nested `.github/actions/gatefit/action.yml`) and `docs/bring-your-adapter.md`.
- Packaging: publishable `gatefit@0.4.0` bin, `npm pack`, tarball `npx gatefit adapter-check`, `npm publish --dry-run` (no registry write; tarball has `bin/gatefit.js`, no `site/`, no secrets).
- Distribution honesty: README and docs say the docs site is live at https://gatefit.io, npm is coming soon, and Polar checkout is the committed `buy.polar.sh/polar_cl_…` link. The built site has no `/gatefit/` asset paths, includes reduced-motion CSS, and does not load an external font CDN. `scripts/deploy-site.sh` copies `site/dist` locally and refuses a dist whose CTA is not that kind of link. Tag `v0.4.0` is draft-only (`CHANGELOG.md`, `docs/release-v0.4.0.md`); the gate does not create a git tag or GitHub Release.
- Starlight `site/` build (`npm ci` + `npm run build` in `site/`) and Polar CTA file check (plain `buy.polar.sh/polar_cl_…` link with `target="_blank"`, no checkout embed). Site is not access proof.
- `tests/entitlements/*.test.ts`.
- Live Test Clock lane is **not** part of this gate. Do not set `GATEFIT_LIVE_CLOCK`. See `docs/live-clock.md`.

## Merge

GitHub Actions `ci.yml` runs the same script (plus an Action dogfood job). A local green never overrides a GHA red. Never merge unless the user says **Merge it**. Edip OVERRIDE for GATEFIT-H8: GHA billing may skip — do not block this High on Actions. Pages deploy is a separate `pages.yml` workflow.

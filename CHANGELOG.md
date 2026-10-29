# Changelog

All notable Gatefit changes are listed here. The version heading matches `package.json`. Tag `v0.5.1` is not cut in this change.

## [Unreleased]

### Added

- Free fixture goldens S7–S9: `trial_no_card` (no-card trial, `customer.subscription.trial_will_end`, failed first charge, pause, and cancel), `portal_downgrade_period_end_vs_immediate` (Customer Portal downgrade at period end versus immediate), and `entitlements_active_summary` (Stripe active entitlement summary). They do not read a license key and do not call Polar. Stripe API version stays `2025-10-29.clover`.

### Fixed

- `./ci-local.sh` reads `npm pack --json` on npm 9 through 12. npm 12 returns an object keyed by package name. The same gate treats npm 12's dry-run refusal of an already published version as a non-write.

## [0.5.1] - 2026-10-16

### Fixed

- `better-sqlite3` is optional and loads only when the SQLite adapter opens a database. `--version`, `--help`, and `adapter-check` run when that module is missing. A SQLite command that cannot load it prints what is missing, that the package ships prebuilds and does not compile on install, and how to reinstall the prebuild or run `npm run build-release`, then exits non-zero.

## [0.5.0] - 2026-10-16

### Added

- Chaos mode, a Pro pack. `gatefit run --suite chaos` replays every golden under seeded perturbations and compares the access row to the in-order replay. It requires `GATEFIT_LICENSE_KEY`.
- License gate (`GATEFIT_LICENSE_KEY`), first shipped in 0.4.0.
- Token-free npm trusted publishing. An annotated tag `vX.Y.Z` runs `.github/workflows/publish.yml` with GitHub OIDC. The publish job uses the GitHub environment `npm`. Provenance is automatic.

### Not in this version

- Provider packs.
- A monthly plan.

## [0.4.0] - 2026-10-16

Tag-ready pack. npm `gatefit@0.4.0` is live (`npx gatefit`, https://www.npmjs.com/package/gatefit). The docs site is live at https://gatefit.io. Polar checkout is the committed Gatefit Indie License link.

### Added

- Publishable `gatefit@0.4.0` CLI (`bin/gatefit.js`) and composite GitHub Action.
- Callers, once a human tags the release commit: `uses: gatefit/gatefit@v0.4.0` and `uses: gatefit/gatefit/.github/actions/gatefit@v0.4.0`.
- Fixture goldens for paid, cancel, refund, trial, past_due, duplicate delivery, seats, cancel-at-period-end, upgrade race, dispute, and unpaid retries.
- Starlight docs app under `site/` and GHA-free `scripts/deploy-site.sh`.
- `npm publish --dry-run` inside `./ci-local.sh`, with tarball checks that the bin is present and `site/` and secrets are absent.
- Pro pack license gate. `GATEFIT_LICENSE_KEY` is checked with Polar's public validate endpoint. Free packs do not call it. Chaos mode is not in this release.

### Not in this version

- A docs deploy from this changelog. The site is already live at https://gatefit.io.

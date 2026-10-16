# Changelog

All notable Gatefit changes are listed here. The version heading matches `package.json`. Tag `v0.5.1` is not cut in this change.

## [0.5.1] - 2026-10-16

### Fixed

- `npx gatefit` installs on machines without make or a C++ compiler. `better-sqlite3` is optional and loads only for the SQLite adapter. `--version`, `--help`, and `adapter-check` run without it. A SQLite command that cannot load the module prints what is missing, why, and `npm rebuild better-sqlite3`, then exits non-zero.

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

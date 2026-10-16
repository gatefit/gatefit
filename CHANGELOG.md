# Changelog

All notable Gatefit changes are listed here. The heading version matches `package.json`. Tag `v0.4.0` is not cut in this change.

## [0.4.0] - 2026-10-16

Tag-ready pack. npm `gatefit@0.4.0` is live (`npx gatefit`, https://www.npmjs.com/package/gatefit). The docs site is live at https://gatefit.io. Polar checkout is the committed Gatefit Indie License link.

### Added

- Publishable `gatefit@0.4.0` CLI (`bin/gatefit.js`) and composite GitHub Action.
- Callers, once a human tags the release commit: `uses: gatefit/gatefit@v0.4.0` and `uses: gatefit/gatefit/.github/actions/gatefit@v0.4.0`.
- Fixture goldens for paid, cancel, refund, trial, past_due, duplicate delivery, seats, cancel-at-period-end, upgrade race, dispute, and unpaid retries.
- Starlight docs app under `site/` and GHA-free `scripts/deploy-site.sh`.
- `npm publish --dry-run` inside `./ci-local.sh`, with tarball checks that the bin is present and `site/` and secrets are absent.

### Not in this version

- A docs deploy from this changelog. The site is already live at https://gatefit.io.

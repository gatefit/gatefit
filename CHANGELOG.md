# Changelog

All notable Gatefit changes are listed here. The heading version matches `package.json`. Tag `v0.4.0` is not cut in this change.

## [0.4.0] - unreleased

Tag-ready pack. The git tag and GitHub Release are not created here. npm publish and the docs site are coming soon. Polar checkout is the committed Gatefit Indie License link.

### Added

- Publishable `gatefit@0.4.0` CLI (`bin/gatefit.js`) and composite GitHub Action.
- Callers, once a human tags the release commit: `uses: edipert/gatefit@v0.4.0` and `uses: edipert/gatefit/.github/actions/gatefit@v0.4.0`.
- Fixture goldens for paid, cancel, refund, trial, past_due, duplicate delivery, seats, cancel-at-period-end, upgrade race, dispute, and unpaid retries.
- Starlight docs app under `site/` and GHA-free `scripts/deploy-site.sh`.
- `npm publish --dry-run` inside `./ci-local.sh`, with tarball checks that the bin is present and `site/` and secrets are absent.

### Not in this version

- Public GitHub repository.
- npm registry publish.
- Live docs site. GitHub Pages needs a public repository or a paid plan.
- Polar checkout.

# Publish checklist (GATEFIT-H4, status GATEFIT-H11)

CI does **not** publish. There is no npm token in this repo. Do not paste tokens here.

**npm:** coming soon. The named gate runs `npm publish --dry-run` only.

**Docs site:** coming soon (`https://edipert.github.io/gatefit/`). GitHub Pages needs a public repository or a paid plan. `scripts/deploy-site.sh` copies `site/dist` to any static host.

**Polar checkout:** coming soon. No working checkout link.

**Tag:** `v0.4.0` must match `package.json` `version`. Do not create the git tag or the GitHub Release from CI. Draft notes: [release-v0.4.0.md](release-v0.4.0.md).

## npm

1. `bash ./ci-local.sh` green on the release commit.
2. Confirm `package.json` `name` is `gatefit`, `version` is the tag you will cut (today `0.4.0`), `private` is not `true`.
3. `npm pack` — tarball must contain `bin/gatefit.js`, `src/cli.ts`, `CHANGELOG.md`, `tests/entitlements/goldens/*.yaml`, `action.yml`, `LICENSE`. It must not contain `site/` or secret files.
4. Smoke: `npm install --ignore-scripts ./gatefit-0.4.0.tgz` in a temp dir, then `npx gatefit adapter-check` (exit 0) and `npx gatefit --version`.
5. When an npm login exists on a trusted machine: `npm publish --access public`. CI never runs that command.
6. If the name is taken later, stop and use `@edipert/gatefit` — do not force a hijack.

## GitHub Action

Root `action.yml` is marketplace-ready (name, description, branding, composite `runs`). Listing on marketplace is optional.

1. After merge to `main`, a human may tag `v0.4.0` on that SHA. This repo's CI does not create the tag.
2. Callers: `uses: edipert/gatefit@v0.4.0`.
3. Nested shim: `uses: edipert/gatefit/.github/actions/gatefit@v0.4.0`.
4. Submit to marketplace only from a human GitHub session (not this CI).

## Docs site

1. `cd site && npm ci && npm run build` writes `site/dist`.
2. `GATEFIT_DEPLOY_TARGET=local GATEFIT_DEPLOY_DEST=/tmp/gatefit-site bash scripts/deploy-site.sh` copies that tree.
3. `rsync` and `s3` targets are documented in `scripts/deploy-site.sh`. Set `GATEFIT_DEPLOY_REPLACE=1` because they replace destination contents.
4. GitHub Pages needs a public repository or a paid plan. Do not expect Pages to serve a private free repo.

## Out of scope here

Live Stripe Test Clocks, seats/races, paid ads, Stripe Checkout, a real npm publish, and making the repository public.

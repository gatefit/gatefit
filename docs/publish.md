# Publish checklist (GATEFIT-H4, status GATEFIT-H11)

The named gate does **not** publish. There is no npm token in this repo. Do not paste tokens here. An annotated `v*` tag publishes with GitHub OIDC. See the [Releasing](../README.md#releasing) section.

**npm:** live. `npx gatefit` is the last published tarball at https://www.npmjs.com/package/gatefit. This repo is `0.5.1`. The named gate runs `npm publish --dry-run` only.

**Docs site:** live at https://gatefit.io. Cloudflare Pages project `gatefit`, hostname `gatefit-bdu.pages.dev`. GitHub Pages needs a public repository or a paid plan and is not the live host. `scripts/deploy-site.sh` copies `site/dist` or deploys the Cloudflare target.

**Polar checkout:** live. Gatefit Indie License, **$49** one-time: `https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`.

**Tag:** `v0.5.1` must match `package.json` `version`. Do not create the git tag or the GitHub Release from the named gate. Notes: [release-v0.5.1.md](release-v0.5.1.md).

## npm

1. `bash ./ci-local.sh` green on the release commit.
2. Confirm `package.json` `name` is `gatefit`, `version` is the tag you will cut (today `0.5.1`), `private` is not `true`.
3. `npm pack` — tarball must contain `bin/gatefit.js`, `src/cli.ts`, `CHANGELOG.md`, `tests/entitlements/goldens/*.yaml`, `action.yml`, `LICENSE`. It must not contain `site/` or secret files.
4. Smoke: `npm install --ignore-scripts ./gatefit-0.5.1.tgz` in a temp dir, then `npx gatefit adapter-check` (exit 0) and `npx gatefit --version`. A SQLite adapter run without the native module exits non-zero and names `npm rebuild better-sqlite3`.
5. Publish with `npm publish --access public` from `.github/workflows/publish.yml` after the annotated tag is pushed. Provenance is automatic. Do not add a registry token.
6. If the name is taken later, stop and use `@gatefit/gatefit` — do not force a hijack.

## GitHub Action

Root `action.yml` is marketplace-ready (name, description, branding, composite `runs`). Listing on marketplace is optional.

1. After merge to `main`, a human may push the annotated tag `v0.5.1` on that SHA. The named gate does not create the tag.
2. Callers: `uses: gatefit/gatefit@v0.5.1`.
3. Nested shim: `uses: gatefit/gatefit/.github/actions/gatefit@v0.5.1`.
4. Submit to marketplace only from a human GitHub session (not this CI).

## Docs site

1. `cd site && npm ci && npm run build` writes `site/dist`.
2. Deploy: `npx wrangler@4 pages deploy dist --project-name gatefit` from `site/`. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment. The Pages project is `gatefit`. The hostname is `gatefit-bdu.pages.dev`.
3. `GATEFIT_DEPLOY_TARGET=local GATEFIT_DEPLOY_DEST=/tmp/gatefit-site bash scripts/deploy-site.sh` copies that tree. `GATEFIT_DEPLOY_TARGET=cloudflare` runs the same wrangler deploy.
4. `rsync` and `s3` targets are documented in `scripts/deploy-site.sh`. Set `GATEFIT_DEPLOY_REPLACE=1` because they replace destination contents.
5. GitHub Pages needs a public repository or a paid plan. Do not expect Pages to serve a private free repo. The live site is https://gatefit.io.

## Out of scope here

Live Stripe Test Clocks, seats/races, paid ads, and Stripe Checkout.

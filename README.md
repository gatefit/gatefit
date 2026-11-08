# gatefit

Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

YAML fixture scenarios, an `npx gatefit` CLI, and a GitHub Action. Node 22+. Not a billing UI. npm `gatefit@0.8.0` is released and tag `v0.8.0` is cut. 0.8.0 adds free S10–S12 goldens. The Stripe suite is S1–S12 (17 goldens). It also ships the gatefit.io homepage redesign.

## Distribution

The CLI and GitHub Action in this repository stay free. Docs site: live. npm is live: `npx gatefit` ([gatefit](https://www.npmjs.com/package/gatefit)). Buy the $49 one-time Gatefit Indie License from https://gatefit.io/#pricing, which links to the Polar Checkout Link on buy.polar.sh. That license unlocks only chaos mode and the Polar and Paddle packs.

- **Docs site:** live. Hosted at https://gatefit.io. Cloudflare Pages project `gatefit`, hostname `gatefit-bdu.pages.dev`. From `site/`: `npm run build`, then `npx wrangler@4 pages deploy dist --project-name gatefit`. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment. GitHub Pages needs a public repository or a paid plan and is not the live host. `.github/workflows/pages.yml` builds the site on pushes to `main` and does not deploy. `scripts/deploy-site.sh` can copy `site/dist` locally or deploy that Cloudflare target.
- **npm:** live. `npx gatefit` is `gatefit@0.8.0` at https://www.npmjs.com/package/gatefit, the same version as this repo. Tag `v0.8.0` is cut. The named gate runs `npm publish --dry-run` only. A `v*` tag publishes with OIDC. See [Releasing](#releasing).
- **Polar checkout:** Gatefit Indie License, **$49** one-time via the Polar Checkout Link `https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`. A plain `site` build and `scripts/deploy-site.sh` use that committed link. `PUBLIC_POLAR_CHECKOUT_URL` may override it. Any other value fails closed.

## Install / run

```bash
npx gatefit --version
npx gatefit adapter-check
npx gatefit run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

This repo is `0.8.0`, released as `gatefit@0.8.0`. Registry: https://www.npmjs.com/package/gatefit

`better-sqlite3` is optional and ships prebuilds for common platforms. npm 9 still runs node-gyp during install and drops the package when that compile fails. npm 10 and newer unpack the prebuild. `--version`, `--help`, and `adapter-check` run when the native module is missing. The reference SQLite adapter loads it only when that adapter runs. If the module is missing, that command tells you to upgrade npm to 10 or newer, reinstall with `npm install --ignore-scripts`, or install a C++ compiler, then exits non-zero.

From a clone:

```bash
npm install
node bin/gatefit.js --version
node bin/gatefit.js adapter-check
node bin/gatefit.js run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

Named verify gate (fixture-first; do not set `GATEFIT_LIVE_CLOCK`):

```bash
bash ./ci-local.sh
```

Bring your own AccessAdapter in ≤30 minutes: [docs/bring-your-adapter.md](docs/bring-your-adapter.md).

`gatefit init` (free) generates a Postgres adapter for drizzle, Prisma, Supabase, or plain `pg` and runs every free golden against it. It is not part of 0.5.2 and is new in 0.6.0. See [site/src/content/docs/init.md](site/src/content/docs/init.md) for templates, safety rules, and its exit codes (2 usage, 3 would overwrite, 4 live key refused).

## GitHub Action

Marketplace-ready Action lives at the repo root (`action.yml`). Snippets use `@v0.8.0`. Tag `v0.8.0` is the release.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.8.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path still works:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.8.0
  with:
    adapter: src/your-access-adapter.ts
```

The Action wraps `gatefit run`. Adapter path is in *your* repo. `uses: gatefit/gatefit@v0.8.0` runs this repo’s goldens, S1–S12 (17 goldens), including free S7–S12. 0.5.2 is the first release that ships S7–S9. 0.8.0 is the first release that ships S10–S12. Tag `v0.8.0` is cut. See [docs/publish.md](docs/publish.md) and the release notes [docs/release-v0.8.0.md](docs/release-v0.8.0.md).

Do not set `GATEFIT_LIVE_CLOCK` for the named gate. Do not use `sk_live`. Never treat Stripe HTTP 200 as proof of access.

Opt-in live Test Clocks (not default CI): [docs/live-clock.md](docs/live-clock.md).

## Telemetry

**Site analytics:** gatefit.io uses cookieless Cloudflare Web Analytics, with no cookies and no browser storage. A Buy click sends one `{"event":"buy_click"}` beacon to `https://t.gatefit.io/v1/site` and never blocks the Checkout Link.

**CLI telemetry:** not shipped in 0.5.2. It ships in 0.6.0, and it is opt-in and off by default. The collector at `t.gatefit.io` is live. It accepts `pack: paddle` and every Stripe suite id, S1–S12 (17 goldens), including S10–S12. Each check has a 5-second timeout. A failed or timed-out probe is down. A probe slower than 3 seconds is degraded. The Action check is unknown when npm has no version. A sample older than 15 minutes is unknown (45 minutes for Polar, probed only on the :00 and :30 runs). A sample more than 5 minutes ahead (`FUTURE_SKEW_MS`) is unknown, never ok, and is left out of `checked_at`. The status page shows those Worker states when `checked_at` is within 15 minutes in the past and 5 minutes in the future. Outside that window every tile is unknown. A page fetch that fails, returns a non-200, or has a body the page cannot parse is unknown. That unknown is not a down probe. Down and degraded from the Worker stay down and degraded. It serves the checks at `GET /v1/status` ([worker/telemetry/README.md](worker/telemetry/README.md)). Deployed 2026-11-08 from main `70faa3e` (version `ffb08bff`). Without `GATEFIT_TELEMETRY=1` or `gatefit telemetry on`, the CLI makes no telemetry request and writes no telemetry file. `DO_NOT_TRACK=1`, `GATEFIT_TELEMETRY=0`, and `gatefit telemetry off` always win. On CI, only `GATEFIT_TELEMETRY=1` opts in. When on, it sends one POST to `https://t.gatefit.io/v1/event` after `init`, `run`, `adapter-check`, or `live`. The request is bounded to about 1.5 s, fails silently, and never changes exit codes or output. `gatefit telemetry status` prints the exact JSON.

Payload keys, each value from a fixed list: `v`, `install_id` (random UUID), `version`, `node` (major), `platform`, `arch`, `command`, `outcome`, `template`, `pack`, `suite` (bundled golden id, `pack`, or `custom`). Paths, repo names, emails, keys, env values, adapter names, and Stripe or Polar data are never sent. Details: [site/src/content/docs/telemetry.md](site/src/content/docs/telemetry.md).

## Releasing

Bump `version` in `package.json` and the lockfile `version` field, and add the matching `CHANGELOG.md` heading, in a pull request. Merge to `main`. Then push an annotated tag whose name is `v` plus that version:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The tag must match `v*`. The workflow fails when the tag without the leading `v` is not `package.json` `version`. That push runs `.github/workflows/publish.yml`: unit tests (`npm test`), the tarball checks (bin present, no `site/`, no secrets), then `npm publish --access public`. Provenance is automatic. The publish job requires the GitHub environment `npm`, so a required reviewer can be added there. `workflow_dispatch` runs the checks and does not publish. Do not set a registry token. The publish job runs on Node 24 with npm >= 11.5.1 (`actions/setup-node@v6`). Callers, `ci.yml`, and `engines` stay Node 22 (`>=22`).

One-time setup on npmjs.com for package `gatefit`: open Package settings, Trusted Publisher, GitHub Actions. Organization or user `gatefit`, repository `gatefit`, workflow filename `publish.yml`, environment name `npm`, and allow `npm publish`. Then set Publishing access to **Require two-factor authentication and disallow tokens**.

`./ci-local.sh` stays the merge gate. It runs `npm publish --dry-run` and does not push tags.

## License

The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. S1–S6, S7–S12 (no-card trial, portal downgrade, active entitlement summary, trial pause and resume, Smart Retries recovery from unpaid, collection pause), seats/races, dispute/unpaid, and live Test Clocks do not read `GATEFIT_LICENSE_KEY` and do not call Polar. 0.5.2 is the first release that ships S7–S9. 0.8.0 is the first release that ships S10–S12.

The Polar provider pack is new in 0.6.0. The Paddle provider pack is new in 0.7.0. A missing, invalid, or revoked key exits non-zero and points at https://gatefit.io/#pricing.

The Polar provider pack ships in 0.6.0 as `gatefit run --suite polar`. It uses the same license and checks your access table against Polar webhooks: [docs](site/src/content/docs/polar-pack.md).

The Paddle provider pack ships in 0.7.0 as `gatefit run --suite paddle` (`npx gatefit@0.8.0` or the installed package), under the same $49 one-time Gatefit Indie License: [docs](site/src/content/docs/paddle-pack.md).

```bash
gatefit run --suite chaos --adapter src/adapters/hardened.ts --seed 1
```

Chaos mode replays every golden under a seeded set of delivery perturbations and compares the access row to the in-order replay. The perturbations are duplicated deliveries, reordered events, stale events, late events, dropped-then-replayed events, and the checkout-return page loading before the webhook. HTTP 200 is not access. The seed defaults to `1`. `--seed` wins over `GATEFIT_CHAOS_SEED`. The same seed prints the same bytes. A failure prints that seed and the perturbed events. Details: [docs/chaos.md](docs/chaos.md).

```bash
export GATEFIT_LICENSE_KEY='GATEFIT-…'
```

Validation is `POST https://api.polar.sh/v1/customer-portal/license-keys/validate` with the key and organization id `68556619-45ab-4a88-8ad8-08606c2b820e`. No Polar API token. A valid result is cached for 24 hours by sha256, never as the raw key. If Polar is unreachable, a cached valid result is reused with a warning. With no cache, the command warns and still runs. Details: [docs/license.md](docs/license.md).

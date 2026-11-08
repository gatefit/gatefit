# Gatefit v0.7.0

## Summary

Gatefit 0.7.0 adds the paid Paddle provider pack and a public status page at gatefit.io/status/. It reports the pack name in opt-in telemetry for a `--suite` path into a provider pack's golden directory, keeps Stripe's `order.*` events away from the Polar rules, and fixes red-glow text contrast on gatefit.io. Repository: https://github.com/gatefit/gatefit.

- Paddle provider pack (paid, $49 Gatefit Indie License): `gatefit run --suite paddle --adapter <path>` replays D1–D9 Paddle Billing goldens (`src/packs/paddle/goldens`, ids `paddle_*`, `PADDLE_SCHEMA = v1+fixtures.1`) against your access table. It uses the same license gate as chaos mode and the Polar pack. The pack refuses `pdl_live_`, `pdl_sdbx_`, and `pdl_ntfset_` keys in the adapter source or environment without printing the value. `subscription.created`, `.updated`, and `.canceled` reach the Paddle rules only with `provider: paddle`; untagged ones keep folding with the Polar rules.
- Status page at gatefit.io/status/: current state and 90 days of daily uptime for gatefit.io, the npm package, the collector, the GitHub Action tag, and the Polar Checkout Link, plus the opt-in usage counts for 7, 30, or 90 days. Any failed or unexpected response shows unknown, never green. The page stores nothing in the browser and ships no sample data.
- Collector Worker: `GET /v1/status`, a Cron Trigger that runs the checks every 5 minutes (Polar every 30 minutes) and rolls up finished days nightly, and migration `0002_checks.sql`. `/v1/stats` and `/v1/status` send read-only CORS for gatefit.io and `cache-control: public, max-age=60`.
- Opt-in telemetry accepts `pack: paddle` in the CLI. The collector accepts it only after the Worker redeploy below.

Fixes:

- Opt-in telemetry: a `--suite` path into the Polar or Paddle golden directory (or one file in it) reports `pack: polar|paddle` with `suite: pack`, licensed or not, instead of `suite: custom`. The path is still never sent.
- `order.created` and `order.updated` reach the Polar rules only with `provider: polar`, because Stripe's legacy Orders API sends the same names. An untagged `order.updated` with status `paid` or `refunded` no longer changes access in the reference adapters. Pack goldens are unchanged and still pass.
- Site text passes WCAG AA (4.5:1) at the peak of the red glows, not only at their resting opacity. No new colours.
- The h13 frame check no longer counts the mint-low chip fill as orbit mint.

S1–S9 and the Phase 2 fixtures stay free. They do not read `GATEFIT_LICENSE_KEY` and do not call Polar. HTTP 200 is not access. The Stripe API version pin stays `2025-10-29.clover`.

v0.6.0 is already released (`npx gatefit`, https://www.npmjs.com/package/gatefit). **This PR does not publish `0.7.0` and does not create the tag.** Cutting tag `v0.7.0` and approving the publish need Edip's explicit go. The Gatefit Indie License is $49 one-time on Polar. That license unlocks chaos mode and the provider packs. This PR does not deploy the docs site or the collector Worker.

## npm

After this PR merges to `main`, and only with Edip's explicit go, a human pushes the annotated tag `v0.7.0` on the merge SHA:

```bash
git tag -a v0.7.0 -m "v0.7.0"
git push origin v0.7.0
```

That push runs `.github/workflows/publish.yml`. The workflow fails when the tag without the leading `v` is not `package.json` `version`. It runs `npm test` and the tarball checks, then the publish job waits for approval on the GitHub environment `npm` and runs `npm publish --access public` with tokenless OIDC (trusted publishing). Provenance is automatic. The workflow does not read a registry token. `workflow_dispatch` runs the unit tests and tarball checks and does not publish.

`./ci-local.sh` runs `npm publish --dry-run`. It does not write the registry and it does not create this tag.

## After publish

- https://www.npmjs.com/package/gatefit shows `0.7.0` with provenance.
- In an empty directory, `npx gatefit@0.7.0 --version` prints `gatefit 0.7.0`, and `npx gatefit@0.7.0 adapter-check` exits 0.
- `npx gatefit@0.7.0 telemetry status` reports off with no opt-in, and no telemetry file is written.
- `npx gatefit@0.7.0 run --suite paddle --adapter <path>` without `GATEFIT_LICENSE_KEY` exits non-zero and points at https://gatefit.io/#pricing.
- `npx gatefit@0.7.0 run --suite polar --adapter <path>` without `GATEFIT_LICENSE_KEY` exits non-zero and points at https://gatefit.io/#pricing.
- A workflow with `uses: gatefit/gatefit@v0.7.0` resolves the tag.

## Collector Worker and status page (deploy steps, not done by this PR)

The collector Worker at `t.gatefit.io` must be redeployed, and D1 migration `worker/telemetry/migrations/0002_checks.sql` applied to the remote `gatefit-telemetry` database, before the collector accepts Paddle telemetry (`pack: paddle`) and before /status shows data. Until then every /status tile shows unknown, and opted-in `pack: paddle` pings are rejected and dropped (the CLI is unaffected).

Run these by hand, in this order, after the tag and publish above. The site goes last because its install copy says `@v0.7.0`. Everything fits the Cloudflare free tier. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment; do not paste them into this repo.

1. From `worker/telemetry/` (database `gatefit-telemetry`, binding `DB`, `migrations_dir = "migrations"` in `wrangler.toml`), apply the migration, then deploy the Worker. The deploy also registers the Cron Triggers:

   ```bash
   cd worker/telemetry
   npx wrangler@4 d1 migrations apply gatefit-telemetry --remote
   npx wrangler@4 deploy
   ```

2. From the repo root, deploy the site:

   ```bash
   cd site && npm ci && npm run build && npx wrangler@4 pages deploy dist --project-name gatefit
   ```

3. Checks:

   - `curl -s https://t.gatefit.io/v1/status` returns the five services (`site`, `npm`, `telemetry`, `action`, `polar`). They read unknown until the first cron run has stored rows.
   - `curl -sI https://t.gatefit.io/v1/status` shows `access-control-allow-origin: https://gatefit.io` and `cache-control: public, max-age=60`.
   - https://gatefit.io/status/ loads.

## GitHub Action

Callers, once a human pushes the annotated tag:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.7.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.7.0
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Not included

- No change to the license gate, chaos mode, or the Polar pack goldens.
- The Indie License stays $49 one-time.
- A docs site deploy, a collector Worker deploy, or a D1 migration from this PR.
- Publishing `0.7.0`. The tag is not cut here.

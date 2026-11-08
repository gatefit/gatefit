# Gatefit v0.8.0

## Summary

Gatefit 0.8.0 adds free S10–S12 goldens, a `pause_collection_behavior` field on billing events, a chaos replay fix for repeated event ids, the `FUTURE_SKEW_MS` status guard, and the gatefit.io homepage redesign. Repository: https://github.com/gatefit/gatefit.

- Free S10–S12 goldens. They do not read a license key and do not call Polar. Stripe API version stays `2025-10-29.clover`. They are not live Test Clock ids, and each has an HTTP 200 step that must stay locked.
  - `trial_end_pause_resume_waits_for_paid` (S10): a trial ends and pauses. The subscription stays `paused` until the resumption invoice is paid, so a failed resumption charge stays locked, `invoice.paid` unlocks, and `customer.subscription.resumed` comes after it and stays unlocked. A replayed resume does not re-lock.
  - `smart_retries_unpaid_then_paid_recovers` (S11): failed Smart Retries and `unpaid` stay locked with plan and seats kept. Paying the latest invoice unlocks.
  - `pause_collection_keeps_access_all_behaviors` (S12): `keep_as_draft`, `mark_uncollectible`, and `void` leave access unchanged while collection is paused. `invoice.marked_uncollectible` during a `mark_uncollectible` pause does not revoke. A pause set or cleared (HTTP 200) on a row locked by a failed payment does not grant; `invoice.paid` does. `invoice.marked_uncollectible` with no pause still locks.
- `BillingEvent.pause_collection_behavior` (`"keep_as_draft" | "mark_uncollectible" | "void" | null`) is a flat copy of Stripe's `pause_collection.behavior`. On invoice events the adapter copies it from the parent subscription. `invoice.marked_uncollectible` no longer locks when it carries `mark_uncollectible`.
- `gatefit init` rules template (`src/init/templates/access-rules.ts.tpl`) has the same field and rule changes. Regenerate with `gatefit init` to pick them up.
- Chaos: a repeated event id in a golden keeps the `created` of its first occurrence, as a real Stripe replay does.
- Status: a sample more than 5 minutes in the future (`FUTURE_SKEW_MS`) is not fresh. The collector's `GET /v1/status` reports unknown for that service, never ok, and leaves it out of the top-level `checked_at`. The status page treats a top-level `checked_at` that far ahead the same way.
- Site (H35): gatefit.io homepage redesign. One value line, a live-HTML run frame, a three-step strip, the free Stripe goldens, a Free vs $49 comparison, and a /status link. The homepage transition count includes S10–S12.
- Site (H36): the Stripe goldens section uses plain-language labels in category groups. The pill shows how access ends up. Period-end cancel and the upgrade race use the amber 'Locks at period end' pill. The pause card is 'Uncollectible locks'.

The collector Worker at `t.gatefit.io` was deployed on 2026-11-08 from main `70faa3e` (version `ffb08bff`). That deploy accepts every Stripe suite id, S1–S12 (17 goldens), including S10–S12, and includes the `FUTURE_SKEW_MS` guard.

The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. Those free checks do not read `GATEFIT_LICENSE_KEY` and do not call Polar. HTTP 200 is not access. The Stripe API version pin stays `2025-10-29.clover`.

npm `gatefit@0.8.0` is released (`npx gatefit`, https://www.npmjs.com/package/gatefit) and the annotated tag `v0.8.0` is cut. The named gate does not create a tag and does not publish. Cutting the tag does not deploy the docs site or the collector Worker.

## npm

Tag `v0.8.0` is the annotated tag on the release SHA. A later release uses the same commands with its own version:

```bash
git tag -a v0.8.0 -m "v0.8.0"
git push origin v0.8.0
```

That push runs `.github/workflows/publish.yml`. The workflow fails when the tag without the leading `v` is not `package.json` `version`. It runs `npm test` and the tarball checks, then the publish job waits for approval on the GitHub environment `npm` and runs `npm publish --access public` with tokenless OIDC (trusted publishing). Provenance is automatic. The workflow does not read a registry token. `workflow_dispatch` runs the unit tests and tarball checks and does not publish.

`./ci-local.sh` runs `npm publish --dry-run`. It does not write the registry and it does not create a tag. The publish job runs on Node 24 with npm >= 11.5.1 (`actions/setup-node@v6`). Callers, `ci.yml`, and `engines` stay Node 22 (`>=22`).

## After publish

- https://www.npmjs.com/package/gatefit shows `0.8.0` with provenance.
- In an empty directory, `npx gatefit@0.8.0 --version` prints `gatefit 0.8.0`, and `npx gatefit@0.8.0 adapter-check` exits 0.
- `npx gatefit@0.8.0 telemetry status` reports off with no opt-in, and no telemetry file is written.
- `npx gatefit@0.8.0 run --suite paddle --adapter <path>` without `GATEFIT_LICENSE_KEY` exits non-zero and points at https://gatefit.io/#pricing.
- `npx gatefit@0.8.0 run --suite paid_grants_access --adapter <path>` exits 0 for a hardened adapter.
- The packed `tests/entitlements/goldens` directory contains the S10–S12 files.
- A workflow with `uses: gatefit/gatefit@v0.8.0` resolves the tag.

## Collector Worker

No new Worker deploy and no new D1 migration are part of 0.8.0. The Worker deployed on 2026-11-08 from main `70faa3e` (version `ffb08bff`) already accepts every Stripe suite id, S1–S12 (17 goldens), including S10–S12, and applies `FUTURE_SKEW_MS` on `GET /v1/status`.

## Docs site

Cutting the tag does not deploy the site. A human may deploy so the install copy says `@v0.8.0`. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment. Do not paste them into this repo. The command is the one in `scripts/deploy-site.sh`.

```bash
cd site && npm ci && npm run build && npx wrangler@4 pages deploy dist --project-name gatefit
```

## GitHub Action

Callers, on tag `v0.8.0`:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.8.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.8.0
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Not included

- No change to the license price. The Indie License stays $49 one-time and unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free.
- A docs site deploy or a collector Worker deploy from the release commit.

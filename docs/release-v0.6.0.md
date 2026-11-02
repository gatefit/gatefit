# Gatefit v0.6.0

## Summary

Gatefit 0.6.0 adds `gatefit init`, the paid Polar provider pack, and opt-in CLI telemetry. It also refreshes gatefit.io to the brand palette and fixes Polar refund scoping and stale-event handling in the SQLite reference adapter. Repository: https://github.com/gatefit/gatefit.

- `gatefit init` (free) writes a self-contained Postgres access adapter for `drizzle`, `prisma`, `supabase`, or `generic` (raw `pg`), plus a migration, README, and `gatefit.config.json`. It never overwrites without `--force`, writes all-or-nothing, and refuses live Stripe keys before anything else. `--print-workflow` / `--write-workflow` render a `gatefit/gatefit@v0.6.0` job. Exit codes 2 (usage), 3 (would overwrite), and 4 (live key refused) apply to `init` only.
- Polar provider pack (paid, $49 Gatefit Indie License): `gatefit run --suite polar --adapter <path>` replays nine Polar v1 webhook transitions (`POLAR_SCHEMA v1+fixtures.1`) against your access table. It uses the same license gate as chaos mode. A licensed `--suite` path into the Polar golden directory runs exactly like `--suite polar`. The pack refuses `polar_oat_`/`polar_pat_` tokens and `sk_live` and never prints them.
- CLI telemetry is opt-in and off by default: `gatefit telemetry on|off|status`, `GATEFIT_TELEMETRY=1|0`. `DO_NOT_TRACK` always wins, and on CI only `GATEFIT_TELEMETRY=1` opts in. When on, the CLI sends one bounded, silent POST to `https://t.gatefit.io/v1/event` after `init`, `run`, `adapter-check`, or `live`, with an allowlisted payload. Exit codes and output do not change.
- gatefit.io uses the brand palette (navy `#0B1B3A`, mint `#5EE0A8`), a new favicon, and a 1200x630 share card. Site text passes WCAG AA. The site copy does not change.

Fixes and changes:

- Polar `refund.created` / `refund.updated` reach the Polar rules only with `provider: polar` on the event. An untagged `refund.*` folds with the Stripe rules.
- The SQLite reference adapter ignores an event whose `created` is older than one already applied for that customer. Goldens without `created` behave as before.
- `init --help` and every `init` usage error no longer send opt-in telemetry.
- The CLI tests force telemetry off in their child processes, so `npm test` never pings a collector.

S1–S9 and the Phase 2 fixtures stay free. They do not read `GATEFIT_LICENSE_KEY` and do not call Polar. HTTP 200 is not access. The Stripe API version pin stays `2025-10-29.clover`.

The telemetry collector Worker (`worker/telemetry/`) is already live at `t.gatefit.io`. It is deployed by hand, is not in the npm tarball, and is not part of `./ci-local.sh`.

v0.5.2 is already released (`npx gatefit`, https://www.npmjs.com/package/gatefit). **This PR does not publish `0.6.0` and does not create the tag.** Cutting tag `v0.6.0` and approving the publish need Edip's explicit go. The docs site is live at https://gatefit.io. Polar checkout is live (Gatefit Indie License, $49 one-time). That license unlocks chaos mode and the provider packs. This release does not deploy the docs site.

## npm

After this PR merges to `main`, and only with Edip's explicit go, a human pushes the annotated tag `v0.6.0` on the merge SHA:

```bash
git tag -a v0.6.0 -m "v0.6.0"
git push origin v0.6.0
```

That push runs `.github/workflows/publish.yml`. The workflow fails when the tag without the leading `v` is not `package.json` `version`. It runs `npm test` and the tarball checks, then the publish job waits for approval on the GitHub environment `npm` and runs `npm publish --access public` with tokenless OIDC (trusted publishing). Provenance is automatic. The workflow does not read a registry token. `workflow_dispatch` runs the unit tests and tarball checks and does not publish.

`./ci-local.sh` runs `npm publish --dry-run`. It does not write the registry and it does not create this tag.

## After publish

- https://www.npmjs.com/package/gatefit shows `0.6.0` with provenance.
- In an empty directory, `npx gatefit@0.6.0 --version` prints `gatefit 0.6.0`, and `npx gatefit@0.6.0 adapter-check` exits 0.
- `npx gatefit@0.6.0 init --dry-run --template generic` prints the write plan and writes nothing.
- `npx gatefit@0.6.0 telemetry status` reports off with no opt-in, and no telemetry file is written.
- `npx gatefit@0.6.0 run --suite polar --adapter <path>` without `GATEFIT_LICENSE_KEY` exits non-zero and points at https://gatefit.io/#pricing.
- A workflow with `uses: gatefit/gatefit@v0.6.0` resolves the tag.

## GitHub Action

Callers, once a human pushes the annotated tag:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.6.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.6.0
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Not included

- No change to the license gate or chaos mode.
- Other `order.*` names that Stripe and Polar both use are not provider-scoped yet.
- There is no $19 monthly plan. The Indie License stays $49 one-time.
- A docs site deploy or a collector Worker deploy from this release.
- Publishing `0.6.0`. The tag is not cut here.

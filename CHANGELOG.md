# Changelog

All notable Gatefit changes are listed here. The version heading matches `package.json`. Tag `v0.7.0` is not cut in this change.

## [Unreleased]

### Fixed

- License copy: the $49 Gatefit Indie License now says what it unlocks (chaos mode, Polar and Paddle packs) instead of "Pro packs", on the landing page, the goldens docs, `docs/license.md`, and the README. S1–S9 and Phase 2 stay free.
- README: the Distribution paragraph's cut-off Polar sentence now says the Checkout Link for the $49 one-time Indie License is live, linking https://gatefit.io/#pricing.
- Telemetry docs: the status checks are described from the registered Cron Triggers: `*/5 * * * *` runs the checks, with Polar probed only on the :00 and :30 runs, and `15 0 * * *` runs the daily rollup at 00:15 UTC.
- Status page: a `checked_at` more than 5 minutes in the future is treated as stale, so every tile shows unknown, never green.
- `./ci-local.sh` also typechecks the collector Worker entry (`worker/telemetry/src/index.ts` and its imports) through `tsconfig.worker.json`. It had no type errors; no runtime change.
- h13 mint detectors: regression test that `--mint-low` and its anti-aliased edges over navy and the surfaces never count as mint or orbit mint. The detector fix itself shipped in 0.7.0.

## [0.7.0] - 2026-11-03

0.7.0 adds the paid Paddle provider pack and the public status page at gatefit.io/status/, backed by the collector Worker's checks and `GET /v1/status`, reports the pack name in opt-in telemetry for a `--suite` path into the Polar or Paddle golden directory, keeps untagged `order.created` and `order.updated` (Stripe sends the same names) away from the Polar rules, and fixes text contrast at the peak of the site's red glows (WCAG AA). This change does not publish the package and does not create the tag.

### Added

- Paddle provider pack (paid, Gatefit Indie License): `gatefit run --suite paddle --adapter <path>` replays D1–D9 Paddle Billing goldens (`src/packs/paddle/goldens`, ids `paddle_*`) against your access table. New in 0.7.0.
- `PADDLE_SCHEMA = v1+fixtures.1` pins Paddle Billing v1 event names plus a fixture revision.
- Provider packs refuse Paddle API keys and notification secrets (`pdl_live_`, `pdl_sdbx_`, `pdl_ntfset_`) in the adapter source or environment, without printing the value.
- Provider scoping: `subscription.created`, `.updated` and `.canceled` reach the Paddle rules only with `provider: paddle`; untagged ones keep folding with the Polar rules.
- Opt-in telemetry accepts `pack: paddle`, in the CLI and in the collector Worker allowlist (the Worker needs a redeploy before it accepts it).
- Public status page at `gatefit.io/status/`: current state and 90 days of daily uptime for gatefit.io, the npm package, the collector, the GitHub Action tag, and the Polar Checkout Link, plus the opt-in usage counts (runs, init, Buy clicks, provider packs) for 7, 30 or 90 days. Any failed or unexpected response shows unknown, never green. The page stores nothing in the browser and ships no sample data. Linked from the landing nav and the docs sidebar.
- Collector Worker: `GET /v1/status`, a Cron Trigger that runs the checks every 5 minutes (Polar every 30 minutes) and rolls up finished days nightly, and migration `0002_checks.sql` (`checks`, `check_days`). `/v1/stats` and `/v1/status` send read-only CORS for gatefit.io and `cache-control: public, max-age=60` (was `no-store`). The Worker needs a redeploy and migration `0002` before the status page shows data; until then every tile shows unknown.

### Fixed

- Opt-in telemetry: a `--suite` path into the Polar or Paddle golden directory (or one file in it) reports `pack: polar|paddle` with `suite: pack`, licensed or not, instead of `suite: custom`. The path is still never sent; a mixed pack-and-free path that is refused stays `custom`.
- Provider scoping: `order.created` and `order.updated` reach the Polar rules only with `provider: polar`, like `refund.*`, because Stripe's legacy Orders API sends the same names. In the reference adapters an untagged `order.updated` with status `paid` or `refunded` no longer changes access; it folds with the Stripe rules. `order.paid` and `order.refunded` are Polar-only and unchanged. Pack goldens are unchanged and still pass.
- Site contrast: text now passes WCAG AA (4.5:1) at the peak of the red glows, not only at their resting opacity. The hero leak box glow is softer (gradient alpha 0.28 to 0.22, peak at the no-JS `breathe` loop) and its text paints above the glow. The flow diagram's node titles use the muted token instead of faint, sit above the red overlay, and the node red glow is softer (0.5 to 0.3). No new colours. The contrast test now reads the animated peak and also checks that the dial's dispute halo glow stays clear of its label text.
- The h13 frame check's orbit-mint detector (`scripts/h13-mint.mjs`) no longer counts the mint-low chip fill as orbit mint; faint orbit mint (about 25% over the surface) still counts.

## [0.6.0] - 2026-11-02

0.6.0 adds `gatefit init` (free), the paid Polar provider pack, and opt-in CLI telemetry, refreshes gatefit.io to the brand palette, and fixes Polar refund scoping and stale-event handling in the SQLite reference adapter. This change does not publish the package and does not create the tag.

### Added

- `gatefit init` (free): writes a self-contained Postgres access adapter (raw `pg`, local `access-rules.ts`, no imports from Gatefit), migration, README, and `gatefit.config.json` for `drizzle`, `prisma`, `supabase`, or `generic`. Uses the one ORM in `package.json`, otherwise asks or exits 2. `--print-workflow` / `--write-workflow` render a `gatefit/gatefit@v<version>` job. Never overwrites without `--force`, writes all-or-nothing, refuses live Stripe keys (arguments, environment, `.env*`) before anything else, and pins Stripe API `2025-10-29.clover` from the existing constant. Exit codes 2/3/4 apply to `init` only. New in 0.6.0.
- Polar provider pack (paid, $49 Gatefit Indie License): `gatefit run --suite polar --adapter <path>` replays nine Polar v1 webhook transitions (`POLAR_SCHEMA v1+fixtures.1`) against your access table. Same license gate as chaos mode; running the pack's golden directory as a `--suite` path is gated too. The pack refuses `polar_oat_`/`polar_pat_` tokens and `sk_live` in the adapter source or environment and never prints them. HTTP 200 is not access. Free suites do not change and never call Polar. New in 0.6.0.
- Usage tracking. The site uses cookieless Cloudflare Web Analytics on the landing page and docs, plus a fire-and-forget Buy-click beacon that never blocks the Checkout Link. CLI telemetry is opt-in and off by default: `gatefit telemetry on|off|status`, `GATEFIT_TELEMETRY=1|0`. `DO_NOT_TRACK` always wins, and CI needs the env var. One bounded, silent ping after `init`/`run`/`adapter-check`/`live`, with an allowlisted payload (`v`, `install_id`, `version`, `node`, `platform`, `arch`, `command`, `outcome`, `template`, `pack`, `suite`). Exit codes and output do not change. The collector Worker (`worker/telemetry/`) is live at `t.gatefit.io`, is deployed by hand, and is not in the npm package. CLI telemetry is new in 0.6.0.

### Changed

- gatefit.io uses the brand palette: navy `#0B1B3A` background, mint `#5EE0A8` accent, links, focus rings, and Buy buttons (navy text on mint). The old amber is gone and the "open/pass" green is the same mint; red stays for locked/fail, and attention highlights are a mint tint with a white outline. Text on the site passes WCAG AA (4.5:1) on every background it actually sits on: navy, the card surface, and the raised replay/dial-card surface, including the red-tinted "leak caught" pills and the hero leak box with its red glow, where leak text uses a lighter red (`site-brand.test.ts`). The site copy does not change.
- New favicon (mint "G" on navy) as SVG, 16/32 ICO, and 180px apple-touch icon, plus a 1200x630 `og.png` share card with `og:image`/`twitter:image` on the landing page and every docs page. `/polar/` stays a bare redirect. The images render from committed outlined SVG in `site/brand/` with `npm run brand` (sharp); `./ci-local.sh` runs `--check` after installing site/ deps and fails on drift.
- The SQLite reference adapter ignores an event whose `created` is older than one already applied for that customer. Goldens without `created` behave as before.
- Polar `refund.created` / `refund.updated` reach the Polar rules only with `provider: polar` on the event, because Stripe sends the same names. An untagged `refund.*` folds with the Stripe rules. The Polar refund golden carries the tag. Other names both providers use (`order.*`) are not scoped yet.
- `POLAR_SCHEMA` is `v1+fixtures.1`, not a date. Polar has no dated API versions; `fixtures.N` goes up whenever a Polar golden changes meaning.
- A licensed `run --suite <path>` into the Polar golden directory (or one file in it) runs exactly like `--suite polar`: schema line, `PASS polar <id>` lines and summary, Polar token and `GATEFIT_LIVE_CLOCK` refusals. Unlicensed, it stays locked as before. A `--suite` path that mixes pack and free goldens exits 1.

### Fixed

- `init --help` and every `init` usage error (exit 2) no longer send opt-in telemetry, matching the docs.
- The collector Worker returns 413 for an oversize `content-length` before reading the body.
- The Polar pack docs list `subscription.created` with status `active` as unlocking.
- The CLI tests force telemetry off in their child processes, so `npm test` never pings a collector.

## [0.5.2] - 2026-10-29

0.5.2 is the first release that ships the free S7–S9 goldens. This change does not publish the package and does not create the tag.

### Added

- Free S7–S9 goldens: `trial_no_card` (no-card trial, `customer.subscription.trial_will_end`, failed first charge, pause, and cancel), `portal_downgrade_period_end_vs_immediate` (Customer Portal downgrade at period end versus immediate), and `entitlements_active_summary` (Stripe active entitlement summary). They do not read a license key and do not call Polar. Stripe API version stays `2025-10-29.clover`.

### Fixed

- The missing-`better-sqlite3` error no longer says the package fails to compile on every install. npm 9 still runs node-gyp and drops this optional package when that compile fails. npm 10 and newer unpack the shipped prebuild. The message says to upgrade npm to 10 or newer and reinstall, reinstall with `npm install --ignore-scripts`, or install a C++ compiler and reinstall.
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
- A per-month plan.

## [0.4.0] - 2026-10-16

Tag-ready pack. npm `gatefit@0.4.0` is live (`npx gatefit`, https://www.npmjs.com/package/gatefit). The docs site is live at https://gatefit.io. Polar checkout is the committed Gatefit Indie License link.

### Added

- Publishable `gatefit@0.4.0` CLI (`bin/gatefit.js`) and composite GitHub Action.
- Callers, once a human tags the release commit: `uses: gatefit/gatefit@v0.4.0` and `uses: gatefit/gatefit/.github/actions/gatefit@v0.4.0`.
- Goldens for paid, cancel, refund, trial, past_due, duplicate delivery, seats, cancel-at-period-end, upgrade race, dispute, and unpaid retries.
- Starlight docs app under `site/` and GHA-free `scripts/deploy-site.sh`.
- `npm publish --dry-run` inside `./ci-local.sh`, with tarball checks that the bin is present and `site/` and secrets are absent.
- Pro pack license gate. `GATEFIT_LICENSE_KEY` is checked with Polar's public validate endpoint. Free packs do not call it. Chaos mode is not in this release.

### Not in this version

- A docs deploy from this changelog. The site is already live at https://gatefit.io.

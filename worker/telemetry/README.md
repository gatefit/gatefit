# gatefit telemetry collector (Cloudflare Worker + D1)

Receives the opt-in CLI ping (`POST /v1/event`) and the site Buy-click beacon
(`POST /v1/site`), and serves aggregates at `GET /v1/stats?days=N` (1–90, default 30).
GATEFIT-H30 adds the status checks behind `gatefit.io/status/`: a Cron Trigger probes
the site, npm, the Action tag, the Polar Checkout Link and the Worker itself, and
`GET /v1/status` serves the results (see the Telemetry docs page, "Status page").
Live at `https://t.gatefit.io`. Not part of `./ci-local.sh`, not in the npm tarball.
The CLI side of the ping ships in 0.6.0 and stays opt-in. The deployed Worker has
migration `0002`, serves `GET /v1/status`, and accepts `pack: paddle` (CLI side ships in
0.7.0). Deployed 2026-11-08 from main `70faa3e` (version `ffb08bff`): it accepts every
Stripe suite id, S1–S12 (17 goldens), including S10–S12. Each check has a 5-second timeout. A failed or timed-out probe is down. A probe slower than 3 seconds is degraded. The Action check is unknown when npm has no version. A sample older than 15 minutes is unknown (45 minutes for Polar, probed only on the :00 and :30 runs). A sample more than 5 minutes ahead (`FUTURE_SKEW_MS`) is unknown, never ok, and is left out of `checked_at`. The status page shows those Worker states when `checked_at` is within 15 minutes in the past and 5 minutes in the future. Outside that window every tile is unknown. A page fetch that fails, returns a non-200, or has a body the page cannot parse is unknown. That unknown is not a down probe. Down and degraded from the Worker stay down and degraded. Its crons run: `*/5 * * * *` runs
the checks (Polar only on the :00 and :30 runs) and `15 0 * * *` runs the daily rollup
at 00:15 UTC. The pure handler
(`src/handler.ts`) is covered by `tests/entitlements/telemetry-worker.test.ts`.

What it stores: daily counters per allowlisted value (`counts`) and a 16-hex SHA-256
prefix of the random install id per day (`installs`) for distinct-install counts. It
never stores the raw install id, never reads client IPs or user agents, and never logs
request bodies. Status checks (`checks`, `check_days`, migration `0002`) hold only the
time, service, pass/fail, latency, and a short code or version; never a response body.

Retention: the daily cron at 00:15 UTC (`15 0 * * *`) rolls finished UTC days into `check_days`,
keeps raw `checks` from the start of the day before yesterday (two to three days), and
keeps 90 days of `check_days`. `counts` and `installs` still have no retention job.

Pure code is covered by tests: `src/handler.ts` and `src/status.ts` by
`telemetry-worker.test.ts` and `status-worker.test.ts`, and `src/d1-store.ts` against
`node:sqlite` with both migrations. `src/index.ts` (fetch, scheduled, Cache API) is glue.

## Deploy (by hand, from this directory)

1. The D1 database `gatefit-telemetry` exists and its `database_id` is committed in
   `wrangler.toml`. For a fresh account only, create it and replace that id:

       npx wrangler@4 d1 create gatefit-telemetry

2. Apply the schema to the remote database. This applies every pending migration,
   including `0002_checks.sql` for the status checks. Run it by hand before the
   deploy that ships the status checks:

       npx wrangler@4 d1 migrations apply gatefit-telemetry --remote

3. Deploy. `wrangler.toml` declares `t.gatefit.io` as a custom domain, so the deploy
   creates the DNS record and certificate on the `gatefit.io` zone:

       npx wrangler@4 deploy

   The deploy also registers the Cron Triggers in `wrangler.toml` (`*/5 * * * *` for the
   checks, Polar only on :00 and :30; `15 0 * * *` for the rollup).

4. Smoke test:

       curl -i https://t.gatefit.io/v1/stats?days=1
       curl -i https://t.gatefit.io/v1/status

   `/v1/status` reports `unknown` everywhere until the first cron run has stored rows.

## Notes

- Keep Cloudflare Web Analytics "automatic setup" off for the Pages project; the site
  uses the manual beacon snippet, and both on would count every page view twice.
- `/v1/stats` and `/v1/status` send `cache-control: public, max-age=60` and read-only
  CORS for `https://gatefit.io`; the Worker also caches `/v1/status` for 60 seconds.
- Anyone can POST events and `/v1/stats` is public. Values are allowlisted and bodies
  are capped (1 KB, 64 B for the site beacon); add a Cloudflare rate-limit rule on
  `t.gatefit.io/v1/*` if counts look inflated. Treat all numbers as lower bounds: ad
  blockers drop both beacons.

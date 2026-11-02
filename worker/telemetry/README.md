# gatefit telemetry collector (Cloudflare Worker + D1)

Receives the opt-in CLI ping (`POST /v1/event`) and the site Buy-click beacon
(`POST /v1/site`), and serves aggregates at `GET /v1/stats?days=N` (1–90, default 30).
Live at `https://t.gatefit.io`. Not part of `./ci-local.sh`, not in the npm tarball.
The CLI side of the ping ships in 0.6.0 and stays opt-in. The pure handler
(`src/handler.ts`) is covered by `tests/entitlements/telemetry-worker.test.ts`.

What it stores: daily counters per allowlisted value (`counts`) and a 16-hex SHA-256
prefix of the random install id per day (`installs`) for distinct-install counts. It
never stores the raw install id, never reads client IPs or user agents, and never logs
request bodies. No retention job in v1.

## Deploy (by hand, from this directory)

1. The D1 database `gatefit-telemetry` exists and its `database_id` is committed in
   `wrangler.toml`. For a fresh account only, create it and replace that id:

       npx wrangler@4 d1 create gatefit-telemetry

2. Apply the schema to the remote database:

       npx wrangler@4 d1 migrations apply gatefit-telemetry --remote

3. Deploy. `wrangler.toml` declares `t.gatefit.io` as a custom domain, so the deploy
   creates the DNS record and certificate on the `gatefit.io` zone:

       npx wrangler@4 deploy

4. Smoke test:

       curl -i https://t.gatefit.io/v1/stats?days=1

## Notes

- Keep Cloudflare Web Analytics "automatic setup" off for the Pages project; the site
  uses the manual beacon snippet, and both on would count every page view twice.
- Anyone can POST events and `/v1/stats` is public. Values are allowlisted and bodies
  are capped (1 KB, 64 B for the site beacon); add a Cloudflare rate-limit rule on
  `t.gatefit.io/v1/*` if counts look inflated. Treat all numbers as lower bounds: ad
  blockers drop both beacons.

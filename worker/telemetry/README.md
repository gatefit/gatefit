# gatefit telemetry collector (Cloudflare Worker + D1)

Receives opt-in CLI pings (`POST /v1/event`) and landing-page Buy clicks
(`POST /v1/site`, Origin `https://gatefit.io` only), and serves aggregate counts
(`GET /v1/stats?days=N`, N ≤ 90, default 30). It never logs bodies and never reads the
client IP or user agent. See `site/src/content/docs/telemetry.md` for the payload.

This directory is not part of the npm package (`.npmignore`, `package.json` `files`)
and is not deployed by CI. The handler (`src/handler.ts`) is tested by
`tests/entitlements/telemetry-worker.test.ts` through `./ci-local.sh`.

## Deploy (by hand, once)

Needs a Cloudflare account with the `gatefit.io` zone. Run from this directory.

```bash
cd worker/telemetry
npx wrangler@4 login                       # or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
npx wrangler@4 d1 create gatefit-telemetry
# Copy the printed database_id into wrangler.toml (replace the all-zero placeholder) and commit it.
npx wrangler@4 d1 migrations apply gatefit-telemetry --remote
npx wrangler@4 deploy                      # creates the t.gatefit.io custom domain from routes
```

## Check

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://t.gatefit.io/v1/site \
  -H 'Origin: https://gatefit.io' --data '{"event":"buy_click"}'     # 204
curl -s 'https://t.gatefit.io/v1/stats?days=7'
```

Ad blockers drop both the Cloudflare beacon and `t.gatefit.io`, so treat every
number as a lower bound. Keep Cloudflare Web Analytics "automatic setup" off for the
Pages project; the site already carries the manual beacon, so automatic setup would
count each page view twice.

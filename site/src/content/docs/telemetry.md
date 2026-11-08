---
title: Telemetry
description: What gatefit.io and the gatefit CLI count, what they never send, and how to turn it off.
---

**Site analytics:** live and cookieless. **CLI telemetry:** opt-in and off by default, included in npm `gatefit@0.8.0`. The collector at `t.gatefit.io` is live.

## gatefit.io

The site loads Cloudflare Web Analytics (`static.cloudflareinsights.com/beacon.min.js`) for page views. It sets no cookies and uses no browser storage.

When you click a Buy link, the page sends one `{"event":"buy_click"}` beacon to `https://t.gatefit.io/v1/site`. The beacon carries no id. It never blocks or changes navigation: the Checkout Link opens as usual even when the beacon is blocked.

Ad blockers drop both requests, so treat site numbers as lower bounds.

## gatefit CLI

CLI telemetry is opt-in and off by default. With no opt-in, the CLI makes no telemetry request and writes no telemetry file.

```bash
npx gatefit telemetry status   # state, the reason, config path, and the exact JSON that would be sent
npx gatefit telemetry on       # saves a random install id and opts in
npx gatefit telemetry off      # opts out and deletes the install id
```

The first rule that matches decides:

1. `DO_NOT_TRACK` set (not empty, `0` or `false`): off.
2. `GATEFIT_TELEMETRY=0`: off.
3. `gatefit telemetry off` was run: off.
4. `GATEFIT_TELEMETRY=1`: on. If no config exists yet, this creates a random install id without saving an opt-in.
5. `CI` set: off. On CI only `GATEFIT_TELEMETRY=1` opts in.
6. `gatefit telemetry on` was run: on.
7. Otherwise: off.

When it is on, the CLI sends one POST to `https://t.gatefit.io/v1/event` after `init`, `run`, `adapter-check`, or `live` finishes. `telemetry`, `--help`, `--version`, `init --help`, and usage errors (including every `init` exit 2) never send. The request times out after about 1.5 seconds, fails silently, prints nothing, and never changes the exit code or output.

The config lives at `$XDG_CONFIG_HOME/gatefit/telemetry.json`, else `%APPDATA%\gatefit\telemetry.json` on Windows, else `~/.config/gatefit/telemetry.json`. An unreadable config counts as off.

### Payload

Exactly these keys. Every value comes from a fixed list, so nothing else can leave the machine.

| Key | Value |
| --- | --- |
| `v` | `1` (number) |
| `install_id` | random UUID v4 created on opt-in |
| `version` | gatefit version, e.g. `0.8.0` |
| `node` | Node major version, e.g. `22` |
| `platform` | `linux`, `darwin`, `win32`, or `other` |
| `arch` | `x64`, `arm64`, or `other` |
| `command` | `init`, `run`, `adapter-check`, or `live` |
| `outcome` | `pass` (exit 0), `fail` (non-zero exit), or `error` (crash) |
| `template` | `init` only: `drizzle`, `prisma`, `supabase`, `generic`, or `auto` (no `--template`); empty otherwise |
| `pack` | `chaos`, `polar`, `paddle`, or empty. A `--suite` path into a pack's golden directory reports that pack (the path itself is not sent). The live collector accepts `paddle`. |
| `suite` | a bundled golden id, S1–S12 (17 goldens), including the S10–S12 ids, `pack` (a pack name, or a path into a pack's golden directory), `custom` (any other path or value), or empty. The live collector accepts every Stripe suite id. |

Never sent: file paths, repo or package names, emails, adapter names or contents, license keys, Stripe or Polar data, environment values, IP addresses, or command output.

### What the collector keeps

The collector stores daily counts per allowed value. It keeps a 16-character SHA-256 prefix of the install id per day for distinct-install counts, and drops the raw id. Counts and install hashes sit in separate tables, so an install cannot be linked to the commands it ran. The collector does not log request bodies, client IPs, or user agents.

## Status page

[`/status/`](/status/) shows service health and the public usage counts from `GET https://t.gatefit.io/v1/stats`. Two Cron Triggers on the collector Worker drive it. The `*/5 * * * *` trigger runs the checks every 5 minutes and stores one row per check; it probes Polar only on the :00 and :30 runs. The `15 0 * * *` trigger runs the daily rollup at 00:15 UTC. The page reads them from `GET https://t.gatefit.io/v1/status`.

| Tile | What the check does |
| --- | --- |
| gatefit.io | `GET https://gatefit.io/` returns 200 and the page contains `Gatefit`. |
| npm gatefit | `GET https://registry.npmjs.org/gatefit/latest` returns 200 with a valid version. The tile shows that version. |
| t.gatefit.io | Runs `GET /v1/stats?days=1` in-process, inside the Worker, against D1. A Worker cannot reliably fetch its own domain, so this checks the Worker and its database, not the public route. |
| GitHub Action | Fetches `action.yml` at the tag `v<npm latest>` from `raw.githubusercontent.com` and checks that it is a composite action. If the npm check failed there is no version to check, so this tile shows unknown. |
| Polar checkout | `HEAD` on the Checkout Link (falling back to `GET` without following redirects). A 2xx, or a redirect to `polar.sh`, counts as up. This check runs only on the :00 and :30 runs, so it does not open a checkout session every 5 minutes. |

- Each check has a 5-second timeout. A failed or timed-out probe is down. A probe slower than 3 seconds is degraded. The Action check is unknown when npm has no version. A sample older than 15 minutes is unknown (45 minutes for Polar, probed only on the :00 and :30 runs). A sample more than 5 minutes ahead (`FUTURE_SKEW_MS`) is unknown, never ok, and is left out of `checked_at`. The status page shows those Worker states when `checked_at` is within 15 minutes in the past and 5 minutes in the future. Outside that window every tile is unknown. A page fetch that fails, returns a non-200, or has a body the page cannot parse is unknown. That unknown is not a down probe. Down and degraded from the Worker stay down and degraded. Deployed 2026-11-08 from main `70faa3e` (version `ffb08bff`).
- Each day bar is the share of checks that passed that UTC day: 99% or more is up, 95% or more is degraded, anything lower is down. A day where more than 10% of checks were slow is degraded. A day without checks has no data.
- The rollup at 00:15 UTC rolls finished days into daily totals. Daily totals are kept for 90 days, and raw checks for two to three days.
- A green banner needs all five services ok. The page does not turn a down or degraded probe into unknown.
- Only a short code (`timeout`, `http 503`, `bad body`, `no version`) or the version that was checked is stored. Response bodies are not stored.
- The status page and the usage counts store nothing in your browser.

The collector Worker at `t.gatefit.io` runs these checks and serves `GET /v1/status`. If a check has not answered recently, its tile shows unknown.

A green tile means the endpoint answered. It is not access: Gatefit's proof is the access row after a transition, and HTTP 200 is not access.

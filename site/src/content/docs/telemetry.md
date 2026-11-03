---
title: Telemetry
description: What gatefit.io and the gatefit CLI count, what they never send, and how to turn it off.
---

**Site analytics:** live and cookieless. **CLI telemetry:** not shipped in 0.5.2. It ships in 0.6.0, and it is opt-in and off by default. The collector at `t.gatefit.io` is live.

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
| `version` | gatefit version, e.g. `0.7.0` |
| `node` | Node major version, e.g. `22` |
| `platform` | `linux`, `darwin`, `win32`, or `other` |
| `arch` | `x64`, `arm64`, or `other` |
| `command` | `init`, `run`, `adapter-check`, or `live` |
| `outcome` | `pass` (exit 0), `fail` (non-zero exit), or `error` (crash) |
| `template` | `init` only: `drizzle`, `prisma`, `supabase`, `generic`, or `auto` (no `--template`); empty otherwise |
| `pack` | `chaos`, `polar`, `paddle`, or empty. A `--suite` path into a pack's golden directory reports that pack (the path itself is not sent). The collector accepts `paddle` only after the Worker is redeployed. |
| `suite` | a bundled golden id, `pack` (a pack name, or a path into a pack's golden directory), `custom` (any other path or value), or empty |

Never sent: file paths, repo or package names, emails, adapter names or contents, license keys, Stripe or Polar data, environment values, IP addresses, or command output.

### What the collector keeps

The collector stores daily counts per allowed value. It keeps a 16-character SHA-256 prefix of the install id per day for distinct-install counts, and drops the raw id. Counts and install hashes sit in separate tables, so an install cannot be linked to the commands it ran. The collector does not log request bodies, client IPs, or user agents.

## Status page

[`/status/`](/status/) shows service health and the public usage counts from `GET https://t.gatefit.io/v1/stats`. A Cron Trigger on the collector Worker runs the checks and stores one row per check: every 5 minutes for four services, every 30 minutes for Polar. The page reads them from `GET https://t.gatefit.io/v1/status`.

| Tile | What the check does |
| --- | --- |
| gatefit.io | `GET https://gatefit.io/` returns 200 and the page contains `Gatefit`. |
| npm gatefit | `GET https://registry.npmjs.org/gatefit/latest` returns 200 with a valid version. The tile shows that version. |
| t.gatefit.io | Runs `GET /v1/stats?days=1` in-process, inside the Worker, against D1. A Worker cannot reliably fetch its own domain, so this checks the Worker and its database, not the public route. |
| GitHub Action | Fetches `action.yml` at the tag `v<npm latest>` from `raw.githubusercontent.com` and checks that it is a composite action. If the npm check failed there is no version to check, so this tile shows unknown. |
| Polar checkout | `HEAD` on the Checkout Link (falling back to `GET` without following redirects). A 2xx, or a redirect to `polar.sh`, counts as up. This check runs every 30 minutes, on the hour and half hour, so it does not open a checkout session every 5 minutes. |

- Checks run every 5 minutes, each with a 5-second timeout. A check that fails or times out is down. One that answers but takes more than 3 seconds is degraded.
- Each tile shows the latest check. If that check is older than 15 minutes (45 for Polar), the tile shows unknown, so stopped checks never look green.
- Each day bar is the share of checks that passed that UTC day: 99% or more is up, 95% or more is degraded, anything lower is down. A day where more than 10% of checks were slow is degraded. A day without checks has no data.
- A nightly job rolls finished days into daily totals. Daily totals are kept for 90 days, and raw checks for two to three days.
- The page treats every failure as unknown: a timeout, an error status, a body it cannot parse, or a shape it does not expect. It never shows green without a fresh answer for all five services.
- Only a short code (`timeout`, `http 503`, `bad body`, `no version`) or the version that was checked is stored. Response bodies are not stored.
- The status page and the usage counts store nothing in your browser.

Until the collector Worker is redeployed with these checks and migration `0002` is applied, every tile shows unknown.

A green tile means the endpoint answered. It is not access: Gatefit's proof is the access row after a transition, and HTTP 200 is not access.

---
title: Telemetry
description: What gatefit.io and the gatefit CLI count, what they never send, and how to turn it off.
---

**Site analytics:** live and cookieless. **CLI telemetry:** not shipped in 0.5.2. It arrives in the next release, and it is opt-in and off by default.

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

Until the next release, run these from a checkout of this repo (`node bin/gatefit.js telemetry status`).

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
| `version` | gatefit version, e.g. `0.5.2` |
| `node` | Node major version, e.g. `22` |
| `platform` | `linux`, `darwin`, `win32`, or `other` |
| `arch` | `x64`, `arm64`, or `other` |
| `command` | `init`, `run`, `adapter-check`, or `live` |
| `outcome` | `pass` (exit 0), `fail` (non-zero exit), or `error` (crash) |
| `template` | `init` only: `drizzle`, `prisma`, `supabase`, `generic`, or `auto` (no `--template`); empty otherwise |
| `pack` | `chaos`, `polar`, or empty |
| `suite` | a bundled golden id, `pack`, `custom` (any path or other value), or empty |

Never sent: file paths, repo or package names, emails, adapter names or contents, license keys, Stripe or Polar data, environment values, IP addresses, or command output.

### What the collector keeps

The collector stores daily counts per allowed value. It keeps a 16-character SHA-256 prefix of the install id per day for distinct-install counts, and drops the raw id. Counts and install hashes sit in separate tables, so an install cannot be linked to the commands it ran. The collector does not log request bodies, client IPs, or user agents.

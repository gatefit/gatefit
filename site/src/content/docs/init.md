---
title: gatefit init
description: Generate a Postgres access adapter for drizzle, Prisma, Supabase, or plain pg, then run every free golden against it.
---

`gatefit init` is **not shipped in 0.5.2**. It arrives in the next release. Until then, run it from a checkout of this repo (`node bin/gatefit.js init`).

`init` is free. It does not read a license key, does not call Polar, and makes no network request.

## What it writes

```bash
npx gatefit init                      # template detected from package.json
npx gatefit init --template prisma    # or drizzle, supabase, generic
npx gatefit init --dry-run            # print the write plan, write nothing
```

| Template | Detected when `package.json` has | Extra files |
| --- | --- | --- |
| `drizzle` | `drizzle-orm` | `gatefit/schema.ts`, `gatefit/migration.sql` |
| `prisma` | `@prisma/client` or `prisma` | `gatefit/access.prisma`, `gatefit/migration.sql` |
| `supabase` | `@supabase/supabase-js` (or `supabase/config.toml` exists) | `supabase/migrations/<timestamp>_gatefit_access.sql` (RLS on, no policies) |
| `generic` | anything else | `gatefit/migration.sql` |

Every template also writes `gatefit/adapter.ts`, `gatefit/db.ts`, `gatefit/README.md`, and `gatefit/env.example`. All templates talk to Postgres through `pg`. Your ORM client is not loaded in CI.

`adapter.ts` exports `STRIPE_API_VERSION` (`2025-10-29.clover`), the Stripe API version the goldens model. Pin your Stripe client to it.

## Run the goldens

```bash
npm install --save-dev gatefit pg
psql "$DATABASE_URL" -f gatefit/migration.sql
DATABASE_URL=postgres://localhost:5432/gatefit_ci \
  npx gatefit run --suite tests/entitlements/goldens --adapter gatefit/adapter.ts
```

The generated adapter asserts the row in `gatefit_access`, not a Stripe HTTP 200. A replayed Stripe event id is a no-op (`gatefit_seen_events`). `decide()` starts as Gatefit's reference rules so the goldens pass on a fresh install. Replace it with the function your webhook handler uses.

## Safety

- **No overwrite without `--force`.** If any planned file exists, `init` writes nothing and lists the conflicts. The write is all-or-nothing.
- **`--dir` stays inside the project.** A path outside the working directory is refused.
- **Live keys are refused.** If a live-mode Stripe secret key is in the environment or a `.env*` file in the project, `init` exits 4 and writes nothing. It names where the key is and never prints the key.
- **No secrets in generated files.** `env.example` holds placeholders only. `DATABASE_URL` is read at run time.
- **Local databases only.** The adapter truncates its own `gatefit_*` tables between goldens, so it refuses a non-local `DATABASE_URL` host unless `GATEFIT_ALLOW_REMOTE_DB=1`.

## Exit codes

These codes apply to `gatefit init` only. `gatefit run` keeps 0 (pass) and 1 (fail).

| Code | Meaning |
| --- | --- |
| 0 | Files written (or `--dry-run` plan printed) |
| 2 | Usage error: unknown template, unknown flag, or `--dir` outside the project |
| 3 | A planned file already exists; rerun with `--force` |
| 4 | Live Stripe secret key found; nothing written |

## Price

`init`, the S1–S9 goldens, and Phase 2 are free. The only paid item is the $49 one-time [Gatefit Indie License](/polar/) (Polar), which unlocks chaos mode and the provider packs only.

---
title: gatefit init
description: Generate a Postgres access adapter for drizzle, Prisma, Supabase, or plain pg, then run every free golden against it.
---

`gatefit init` is **not shipped in 0.5.2**. It arrives in the next release. Until then, run it from a checkout of this repo (`node bin/gatefit.js init`).

`gatefit init` is free. It does not read a license key, does not call Polar, and makes no network request.

## What it writes

```bash
npx gatefit init                          # uses the one ORM found in package.json
npx gatefit init --template prisma        # or drizzle, supabase, generic
npx gatefit init --dry-run                # print the write plan, write nothing
npx gatefit init --template generic --print-workflow   # print a CI workflow, write nothing
npx gatefit init --template generic --write-workflow   # also write .github/workflows/gatefit.yml
```

| Template | Detected when `package.json` has | Extra files |
| --- | --- | --- |
| `drizzle` | `drizzle-orm` | `gatefit/schema.ts`, `gatefit/migration.sql` |
| `prisma` | `@prisma/client` or `prisma` | `gatefit/access.prisma`, `gatefit/migration.sql` |
| `supabase` | `@supabase/supabase-js` (or `supabase/config.toml` exists) | `supabase/migrations/<timestamp>_gatefit_access.sql` (RLS on, no policies) |
| `generic` | never detected; pass `--template generic` | `gatefit/migration.sql` |

If no ORM or more than one is found, init asks on a terminal. In CI, with `--no-prompt`, or when stdin is not a terminal, it exits 2 and tells you to pass `--template`. It never picks one silently.

Every template also writes:

- `gatefit/adapter.ts`: the adapter `gatefit run` loads.
- `gatefit/access-rules.ts`: the adapter contract types and a copy of the reference entitlement rules. Generated code imports nothing from Gatefit, so the files are yours to change.
- `gatefit/db.ts`, `gatefit/README.md`, `gatefit/env.example`.
- `gatefit.config.json` at the project root: `{ "adapter", "suite", "stripeApiVersion" }`. `gatefit run` does not read it; pass `--adapter` and `--suite` as shown below.

**All four templates use raw `pg` (node-postgres) against the same two tables.** Your drizzle client, Prisma Client, or Supabase client is not loaded in CI. The template only changes the schema file and the migration path. Supabase uses its Postgres connection string, not API keys.

`adapter.ts` exports `STRIPE_API_VERSION` (`2025-10-29.clover`), the Stripe API version the goldens model. Pin your Stripe client to it.

## Run the goldens

```bash
npm install --save-dev gatefit pg
export DATABASE_URL=postgres://localhost:5432/gatefit_ci
psql "$DATABASE_URL" -f gatefit/migration.sql
npx gatefit run --suite paid_grants_access --adapter gatefit/adapter.ts
npx gatefit run --suite tests/entitlements/goldens --adapter gatefit/adapter.ts
```

The generated adapter asserts the row in `gatefit_access`. HTTP 200 from Stripe is not access. A replayed Stripe event id is a no-op (`gatefit_seen_events`). `decide()` starts as the reference rules in `access-rules.ts`, so the goldens pass on a fresh install. Replace it with the function your webhook handler uses.

## CI workflow

`--print-workflow` and `--write-workflow` render a GitHub Actions job. It starts a throwaway Postgres service (trust auth, no password), runs `npm ci`, applies the migration with `psql`, and calls `uses: gatefit/gatefit@v0.5.2` with your adapter path. The job needs no stored secrets. Database setup is yours to adapt.

## Safety

- **No overwrite without `--force`.** If any planned file exists, `init` writes nothing and lists the conflicts. The write is all-or-nothing. With `--force`, originals are moved aside and put back if a later write fails.
- **Files stay inside the project.** A `--dir` outside the working directory, or a symlink (such as a `gatefit/` link) that resolves outside it, is refused with exit 2.
- **Live keys are refused first.** A live-mode Stripe secret key in the arguments, the environment, or a `.env*` file in the project makes `init` exit 4 before anything else is checked. It names where the key is and never prints the key.
- **No secrets in generated files.** `env.example` holds placeholders only. `DATABASE_URL` is read at run time.
- **Local databases only.** The adapter truncates its own `gatefit_*` tables between goldens, so it refuses a non-local `DATABASE_URL` host unless `GATEFIT_ALLOW_REMOTE_DB=1`. Local hosts are `localhost`, `127.0.0.1`, `::1`, and the CI service names `postgres` and `db`.

## Exit codes

These codes apply to `gatefit init` only. `gatefit run` keeps 0 (pass) and 1 (fail).

| Code | Meaning |
| --- | --- |
| 0 | Files written, `--dry-run` plan printed, or `--print-workflow` output |
| 1 | Unexpected error (a failed write is rolled back) |
| 2 | Usage error: unknown template, unknown flag, no or ambiguous ORM without `--template`, or a path outside the project |
| 3 | A planned file already exists; rerun with `--force` |
| 4 | Live Stripe secret key found; nothing written |

## Price

`init`, the S1–S9 goldens, and Phase 2 are free. The only paid item is the $49 one-time [Gatefit Indie License](/polar/) (Polar), which unlocks chaos mode and the provider packs only.

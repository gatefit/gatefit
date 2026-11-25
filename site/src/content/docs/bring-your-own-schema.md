---
title: Bring your own schema
description: Point Gatefit at the access table you already have. Free with the S1–S12 suite.
---

Point Gatefit at the access table you already have. `--schema` is free with npm `gatefit@0.8.0`. It does not read `GATEFIT_LICENSE_KEY` and it does not call Polar. The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. Chaos mode and those packs stay on `--adapter`.

From install to the first result: [Onboarding](/onboarding/).

## Mapping

`gatefit init` creates `gatefit_access` and `gatefit_seen_events`. `--schema` does not. You name the table and the columns. Gatefit does not add tables, columns, or indexes. `reset` deletes every row in the mapped table, and in the dedupe table when you mapped one. Use a disposable database.

```bash
npx gatefit@0.8.0 run --suite tests/entitlements/goldens --schema gatefit.schema.json
```

Pass `--schema` or `--adapter`, not both. A sqlite `database` path is relative to the working directory. The file must already exist. Postgres sets `dialect` to `postgres`, omits `database`, and reads `DATABASE_URL`. A non-local host is refused unless `GATEFIT_ALLOW_REMOTE_DB=1`. The error does not print the URL.

```json
{
  "dialect": "sqlite",
  "database": "gatefit-byo.sqlite",
  "table": "Subscription",
  "columns": {
    "id": "id",
    "customerId": "customerId",
    "plan": "priceId",
    "active": "active",
    "start": "startDate",
    "periodEnd": "endDate",
    "cancelAt": "cancelAt"
  }
}
```

`customerId` and `plan` are required. Map `active`, `status`, or both. `id`, `start`, `periodEnd`, `cancelAt`, `seats`, and `features` are optional. Identifiers are one ASCII name. A quote, dot, or space is rejected before the database file is opened (`gatefit: access mapping column "customerId" is not a single identifier`). Values are bound parameters.

A missing file or invalid JSON stops in one line (`gatefit: access mapping not found:`, `gatefit: access mapping is not valid JSON:`). A missing table stops with `gatefit: access table "Subscription" is not in the database` and does not create it.

## What counts as paid

Paid means the snapshot is `locked: false`.

- A missing row is not paid.
- `active` is paid only for boolean `true` or integer `1`. The string `"true"` is not paid.
- `status` is paid only for the exact string `active`. `trialing`, `past_due`, `paused`, `canceled`, `unpaid`, and any other status are not paid.
- When both columns are mapped, both must agree or the row is not paid.
- `periodEnd` and `cancelAt` do not grant access. Cancel-at-period-end stays paid until the event whose `now` is at or after `period_end`.
- A Stripe HTTP 200 does not grant access and does not insert a row.

The plan column is the snapshot `plan`. On insert, `id` is the customer id. Later updates leave that id alone. `start` is set on insert from `now`, else `created`, else unix `0`.

Several rows can share a customer id. The customer is paid when any of those rows is paid. A granting event updates the paid row with the latest period end, or the latest row when none are paid. It does not mark the other rows paid. A revoking event clears every row for that customer.

## Event dedupe

Dedupe is optional. Leave it out and Gatefit prints this finding. The suite still exits 0 when the rows match:

```text
gatefit: finding: event dedupe is not mapped; a replayed event id is ignored for this process only and is not stored in the database
```

The same process ignores a repeated event id. A second process can apply it again. Map a table that already exists when a replay must stay a no-op after the process exits:

```json
"dedupe": { "table": "seen_events", "eventId": "event_id" }
```

Give `event_id` a primary key or unique index. Gatefit does not create the table. If it is missing: `gatefit: event dedupe table "seen_events" is not in the database`.

## Seats and features

When those columns are not mapped, Gatefit prints:

```text
gatefit: finding: these access fields are not mapped and are kept in memory for this process only: seats, features
```

S1–S12 (17 goldens) still run. Those fields are not in the table. A new process reads `locked` and `plan` from the row and does not see seats or features. Map `seats` and `features` when you want them stored.

A table shaped like the boxyhq/saas-starter-kit Prisma `Subscription` model (`id`, `customerId`, `priceId`, `active`, `startDate`, `endDate`, `cancelAt`) runs S1–S12 (17 goldens) with no schema change. The sample files are `tests/fixtures/saas-starter/subscription.sql` and `tests/fixtures/saas-starter/schema.json` in the repository.

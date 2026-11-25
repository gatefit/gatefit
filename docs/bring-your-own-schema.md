# Bring your own schema

Point Gatefit at the access table you already have. `--schema` is free. It does not read `GATEFIT_LICENSE_KEY` and it does not call Polar. The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. Chaos mode and those packs stay on `--adapter`.

It ships in the next release. Run it from a checkout of this repository. From install to the first result: [onboarding.md](onboarding.md).

## Mapping

`gatefit init` creates `gatefit_access` and `gatefit_seen_events`. `--schema` does not. You name the table and the columns. Gatefit does not add tables, columns, or indexes. `reset` deletes every row in the mapped table, and in the dedupe table when you mapped one. Use a disposable database.

```bash
node bin/gatefit.js run --suite tests/entitlements/goldens --schema gatefit.schema.json
```

Pass `--schema` or `--adapter`, not both. A sqlite `database` path is relative to the working directory. The file must already exist. `:memory:` is a new empty database, so the table check fails until that table exists on the connection Gatefit opens. Postgres sets `dialect` to `postgres`, omits `database`, and reads `DATABASE_URL`. A non-local host is refused unless `GATEFIT_ALLOW_REMOTE_DB=1`. The error does not print the URL.

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

Column roles:

| Role | Required | Written from |
| --- | --- | --- |
| `customerId` | yes | The event customer id. Lookup key. |
| `plan` | yes | The snapshot plan. |
| `active` | one of `active` or `status` | Integer `1` or `0` on sqlite, boolean on postgres. |
| `status` | one of `active` or `status` | `active` when the row is paid, otherwise a non-paid status. |
| `id` | no | On insert, the customer id. Updates leave the existing id. |
| `start` | no | Set on insert from `now`, else `created`, else unix `0`. |
| `periodEnd` | no | The event `period_end` when present. |
| `cancelAt` | no | The period end while cancel-at-period-end is set. Cleared when a later event grants access. |
| `seats` | no | The snapshot seat count, when the column exists. |
| `features` | no | A JSON array of strings, when the column exists. |

Identifiers are one ASCII name (`Subscription`, `customerId`). A quote, dot, or space is rejected before the database file is opened: `gatefit: access mapping column "customerId" is not a single identifier`. Values are bound parameters.

A missing mapping file, a directory, or invalid JSON stops in one line (`gatefit: access mapping not found:`, `gatefit: access mapping is not a file:`, `gatefit: access mapping is not valid JSON:`). A missing table stops with `gatefit: access table "Subscription" is not in the database` and does not create it.

## What counts as paid

Paid means the snapshot is `locked: false`.

- A missing row is not paid.
- `active` is paid only for boolean `true` or integer `1`. The string `"true"` is not paid.
- `status` is paid only for the exact string `active`. `trialing`, `past_due`, `paused`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `inactive`, and `disputed` are not paid.
- When both columns are mapped, both must agree. `active` true with `status` `past_due` is not paid. `active` false with `status` `active` is not paid.
- `periodEnd` and `cancelAt` do not grant access. Cancel-at-period-end stays paid until the event whose `now` is at or after `period_end`, which writes the active flag or status to not paid.
- A Stripe HTTP 200 does not grant access and does not insert a row.

The plan column is the snapshot `plan`.

Several rows can share a customer id. The customer is paid when any of those rows is paid. When `id` is mapped, a granting event updates the paid row with the latest period end, or the latest row when none are paid, and does not mark the other rows paid. Without an `id` column, a granting event writes every row for that customer. A revoking event clears every row for that customer.

## Event dedupe

Dedupe is optional. Leave `dedupe` out and Gatefit prints this finding. The suite still exits 0 when the rows match:

```text
gatefit: finding: event dedupe is not mapped; a replayed event id is ignored for this process only and is not stored in the database
```

The same process ignores a repeated event id. A second process can apply it again. Map a table that already exists when a replay must stay a no-op after the process exits:

```json
"dedupe": { "table": "seen_events", "eventId": "event_id" }
```

Give `event_id` a primary key or unique index. Gatefit does not create the table. If it is missing: `gatefit: event dedupe table "seen_events" is not in the database`.

## Seats and features

A subscription row often has no seat or feature columns. Gatefit then prints:

```text
gatefit: finding: these access fields are not mapped and are kept in memory for this process only: seats, features
```

S1–S12 (17 goldens) still run. Those fields are not in the table. A new process reads `locked` and `plan` from the row and does not see seats or features. Map `seats` and `features` when you want them stored.

## Starter-kit shape

`tests/fixtures/saas-starter/subscription.sql` is the boxyhq/saas-starter-kit Prisma `Subscription` shape: `id`, `customerId`, `priceId`, `active`, `startDate`, `endDate`, `cancelAt`. `tests/fixtures/saas-starter/schema.json` maps those columns. Running S1–S12 (17 goldens) against that table does not change its columns or indexes.

# Onboarding

This is the path from an empty app to the first Gatefit result on your access data. Gatefit reads the row your adapter returns after each billing event. A Stripe HTTP 200 is not that row.

Install `gatefit@0.8.0`. The commands below pin that version with `npx gatefit@0.8.0`. Node 22 or newer (the `engines` field in `package.json`).

The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. `gatefit init` and `gatefit run` on that suite do not read `GATEFIT_LICENSE_KEY` and do not call Polar.

The contract in short: [bring-your-adapter.md](bring-your-adapter.md). Flag-by-flag init rules: [gatefit init](../site/src/content/docs/init.md). What each check asserts: [Goldens](../site/src/content/docs/goldens.md).

## 1. Install

```bash
npm install --save-dev gatefit@0.8.0 pg
npx gatefit@0.8.0 --version
npx gatefit@0.8.0 adapter-check
```

`--version` prints `gatefit 0.8.0`.

`adapter-check` does not read your database. It runs the built-in naive adapter and the built-in hardened adapter against `paid_grants_access` and prints:

```text
gatefit adapter-check: naive failed S1 (expected)
gatefit adapter-check: hardened passed S1 (expected)
```

Exit 0 means the package can load an adapter and compare a snapshot. The naive adapter treats `httpStatus` or `stripeHttpStatus` of 200 as access. That failure is the point of the check.

## 2. gatefit init

From the app repository:

```bash
npx gatefit@0.8.0 init --template generic --no-prompt
```

| Template | When to pass it | What is different |
| --- | --- | --- |
| `generic` | Postgres, no ORM detected | `gatefit/migration.sql` |
| `drizzle` | `package.json` has `drizzle-orm` | `gatefit/schema.ts` for drizzle-kit, plus `gatefit/migration.sql` |
| `prisma` | `package.json` has `@prisma/client` or `prisma` | `gatefit/access.prisma`, plus `gatefit/migration.sql` |
| `supabase` | `package.json` has `@supabase/supabase-js`, or `supabase/config.toml` exists | `supabase/migrations/<timestamp>_gatefit_access.sql` with row level security on and no policies |

With one of those ORMs and no `--template`, init uses the one it finds. With none, or with more than one, a terminal asks. In CI, with `--no-prompt`, or when stdin is not a terminal, both cases exit 2. They print different messages. No ORM:

```text
gatefit init: no ORM found in package.json (drizzle-orm, @prisma/client or prisma, @supabase/supabase-js); pass --template drizzle|prisma|supabase|generic. Nothing was written.
```

More than one ORM. `<list>` is the names init found, joined with `, `:

```text
gatefit init: more than one ORM found in package.json (<list>); pass --template drizzle|prisma|supabase|generic. Nothing was written.
```

Init is included in npm `gatefit@0.8.0`. It is free. It does not read a license key and it makes no network request. It writes:

- `gatefit/adapter.ts`, the module `gatefit run` loads
- `gatefit/access-rules.ts`, the `AccessAdapter` types and `nextSnapshot` (the reference rules)
- `gatefit/db.ts`, the `pg` connection
- `gatefit/README.md`, `gatefit/env.example`
- `gatefit.config.json` at the repo root

`gatefit run` does not read `gatefit.config.json`. Pass `--adapter` and `--suite` on the command line.

Generated files import nothing from the `gatefit` package. The loader resolves `createAdapter()`, or `default`, or `adapter`, and checks that `apply` and `snapshot` are functions. The runner then calls `reset` when it is present, then `apply` and `snapshot` for each step. `reset` is required only when more than one golden runs.

Apply the migration and point `DATABASE_URL` at a disposable database:

```bash
export DATABASE_URL=postgres://localhost:5432/gatefit_ci
createdb gatefit_ci
psql "$DATABASE_URL" -f gatefit/migration.sql
```

`createdb` connects to the default local database and creates `gatefit_ci`. The same create is `psql -d postgres -c 'CREATE DATABASE gatefit_ci'`.

`env.example` uses that URL. It has no password and no Stripe key.

## 3. Connect the access database

`gatefit run` loads the adapter file, calls `createAdapter()`, then for each step calls `apply(event)` and `snapshot(customerId)`. It compares the snapshot to the step's `expect`. Only keys present on `expect` are compared. `locked: true` means deny, including when the event looks paid.

A missing row is `{ locked: true }` (`rowToSnapshot` in the generated adapter). The runner never calls Stripe for this suite.

All four init templates read the same two Postgres tables with `pg`. The ORM client is not loaded. `gatefit/db.ts` is the same code for each template. This is that file:

```ts
// Postgres access for the Gatefit adapter.
// Uses node-postgres (pg). Any Postgres 13 or newer works.
// The connection string comes from DATABASE_URL at run time. Never commit it.
import type { Pool } from "pg";

export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
export type Sql = {
  query: Query;
  transaction<T>(fn: (tx: { query: Query }) => Promise<T>): Promise<T>;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

function requireLocalUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("gatefit adapter: set DATABASE_URL to a disposable Postgres (CI service container or local dev DB)");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("gatefit adapter: DATABASE_URL is not a valid postgres:// URL");
  }
  // reset() truncates the gatefit_* tables between goldens. Keep that off shared databases.
  if (!LOCAL_HOSTS.has(host) && process.env.GATEFIT_ALLOW_REMOTE_DB !== "1") {
    throw new Error(
      "gatefit adapter: DATABASE_URL host is not local. Goldens truncate gatefit_access between runs. " +
        "Point it at a disposable database, or set GATEFIT_ALLOW_REMOTE_DB=1 if this one is disposable.",
    );
  }
  return url;
}

export function connect(): Sql {
  const connectionString = requireLocalUrl();
  // pg loads on first query, so a missing DATABASE_URL is reported first.
  let pool: Promise<Pool> | undefined;
  const getPool = () =>
    (pool ??= import("pg").then(({ default: pg }) => new pg.Pool({ connectionString, max: 2 })));
  const query: Query = async (text, params) => (await (await getPool()).query(text, params)).rows;
  return {
    query,
    async transaction(fn) {
      const client = await (await getPool()).connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: async (text, params) => (await client.query(text, params)).rows });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
```

Local hosts are `localhost`, `127.0.0.1`, `::1`, `[::1]`, and the CI service names `postgres` and `db`. Any other host throws unless `GATEFIT_ALLOW_REMOTE_DB=1`. `reset()` truncates the Gatefit tables between checks, so the database has to be disposable.

### Postgres table

`gatefit init --template generic` writes this adapter. `decide` is `nextSnapshot` from `gatefit/access-rules.ts`, so a fresh install agrees with the free suite. Replace `decide` with the function your webhook handler uses when you want the run to exercise your rules.

```ts
// Gatefit access adapter (generic template), generated by `gatefit init`.
// Gatefit replays billing transitions through apply() and reads the access row
// back with snapshot(). The assertion is the row in Postgres, not a Stripe 200.
//
// Run: npx gatefit run --suite tests/entitlements/goldens --adapter gatefit/adapter.ts
//
// decide() uses the reference rules in ./access-rules.ts so the free goldens pass
// out of the box. Replace it with the entitlement function your webhook handler
// calls, so CI tests your logic instead of the reference copy.
// This file imports nothing from Gatefit; `gatefit run` only calls createAdapter().
import { nextSnapshot, type AccessAdapter, type AccessSnapshot, type BillingEvent } from "./access-rules.ts";
import { connect, type Sql } from "./db.ts";

/** Pin your Stripe client to this version (new Stripe(key, { apiVersion })). */
export const STRIPE_API_VERSION = "2025-10-29.clover";

const decide: (current: AccessSnapshot, event: BillingEvent) => AccessSnapshot = nextSnapshot;

type AccessRow = {
  locked: boolean;
  plan: string | null;
  seats: number | null;
  features: string[] | null;
};

function rowToSnapshot(row: AccessRow | undefined): AccessSnapshot {
  if (!row) return { locked: true };
  const snap: AccessSnapshot = { locked: row.locked };
  if (row.plan != null) snap.plan = row.plan;
  if (row.seats != null) snap.seats = row.seats;
  if (row.features != null) snap.features = row.features;
  return snap;
}

const SELECT_ROW = "SELECT locked, plan, seats, features FROM gatefit_access WHERE customer_id = $1";

export function createAdapter(): AccessAdapter {
  const sql: Sql = connect();
  return {
    async apply(event: BillingEvent) {
      await sql.transaction(async (tx) => {
        // Idempotency: a replayed Stripe event id is a no-op.
        const fresh = await tx.query(
          "INSERT INTO gatefit_seen_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id",
          [event.id],
        );
        if (fresh.length === 0) return;
        const current = await tx.query<AccessRow>(`${SELECT_ROW} FOR UPDATE`, [event.customerId]);
        const next = decide(rowToSnapshot(current[0]), event);
        await tx.query(
          `INSERT INTO gatefit_access (customer_id, locked, plan, seats, features, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (customer_id) DO UPDATE SET
             locked = excluded.locked,
             plan = excluded.plan,
             seats = excluded.seats,
             features = excluded.features,
             updated_at = excluded.updated_at`,
          [event.customerId, next.locked, next.plan ?? null, next.seats ?? null, next.features ?? null],
        );
      });
    },
    async snapshot(customerId: string) {
      const rows = await sql.query<AccessRow>(SELECT_ROW, [customerId]);
      return rowToSnapshot(rows[0]);
    },
    async reset() {
      // Only Gatefit's own tables, and only on a local database (see db.ts).
      await sql.query("TRUNCATE gatefit_access, gatefit_seen_events");
    },
  };
}

export default createAdapter;
```

The migration that creates the tables:

```sql
-- Gatefit access tables (generic template), generated by `gatefit init`.
-- Re-runnable. gatefit_access is the row Gatefit asserts after each transition.
-- gatefit_seen_events makes a replayed Stripe event id a no-op.
CREATE TABLE IF NOT EXISTS gatefit_access (
  customer_id text PRIMARY KEY,
  locked boolean NOT NULL DEFAULT true,
  plan text,
  seats integer,
  features text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gatefit_seen_events (
  event_id text PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);
```

`features` is a Postgres `text[]`. `snapshot` copies `locked`, and copies `plan`, `seats`, and `features` when they are not null.

#### Your own columns

`app_entitlements` is a stand-in for the table your app already writes. It is not a table init creates. `customer_id` is the primary key. `active` true means the customer is allowed, so `locked` is the opposite. If your column is already `locked`, keep the generic adapter and change the table name in `SELECT_ROW` and the upsert.

Keep `gatefit_seen_events` from the migration so a replayed event id is a no-op. `reset` truncates `app_entitlements` and `gatefit_seen_events`. That deletes every row in your table. Use a disposable database. The host check in `db.ts` still applies, because this adapter calls `connect()`.

```ts
// Your table, not a table `gatefit init` creates. Change app_entitlements to
// the table your webhook handler writes. active true means allowed, so locked
// is the inverse. customer_id is the primary key. gatefit_seen_events comes
// from gatefit/migration.sql. reset truncates both tables.
import { nextSnapshot, type AccessAdapter, type AccessSnapshot, type BillingEvent } from "./access-rules.ts";
import { connect, type Sql } from "./db.ts";

type AppRow = {
  active: boolean;
  plan: string | null;
  seats: number | null;
  features: string[] | null;
};

const SELECT_ROW = "SELECT active, plan, seats, features FROM app_entitlements WHERE customer_id = $1";

function rowToSnapshot(row: AppRow | undefined): AccessSnapshot {
  if (!row) return { locked: true };
  const snap: AccessSnapshot = { locked: !row.active };
  if (row.plan != null) snap.plan = row.plan;
  if (row.seats != null) snap.seats = row.seats;
  if (row.features != null) snap.features = row.features;
  return snap;
}

export function createAdapter(): AccessAdapter {
  const sql: Sql = connect();
  return {
    async apply(event: BillingEvent): Promise<void> {
      await sql.transaction(async (tx) => {
        const fresh = await tx.query(
          "INSERT INTO gatefit_seen_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id",
          [event.id],
        );
        if (fresh.length === 0) return;
        const current = await tx.query<AppRow>(`${SELECT_ROW} FOR UPDATE`, [event.customerId]);
        const next = nextSnapshot(rowToSnapshot(current[0]), event);
        await tx.query(
          `INSERT INTO app_entitlements (customer_id, active, plan, seats, features)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (customer_id) DO UPDATE SET
             active = excluded.active,
             plan = excluded.plan,
             seats = excluded.seats,
             features = excluded.features`,
          [event.customerId, !next.locked, next.plan ?? null, next.seats ?? null, next.features ?? null],
        );
      });
    },
    async snapshot(customerId: string): Promise<AccessSnapshot> {
      const rows = await sql.query<AppRow>(SELECT_ROW, [customerId]);
      return rowToSnapshot(rows[0]);
    },
    async reset(): Promise<void> {
      await sql.query("TRUNCATE app_entitlements, gatefit_seen_events");
    },
  };
}

export default createAdapter;
```

If `features` is stored as JSON text rather than `text[]`, parse it in `rowToSnapshot` into `string[]` before returning the snapshot. The runner compares `features` with `JSON.stringify`.

### Supabase

Supabase is the same Postgres reader. Init does not import `@supabase/supabase-js`, and it does not use the Data API or an anon key. No Supabase API keys are needed. Use the Postgres connection string `supabase start` prints (local port 54322).

```bash
npx gatefit@0.8.0 init --template supabase --no-prompt
```

`db.ts` refuses a hosted hostname such as `db.<project>.supabase.co` unless you set `GATEFIT_ALLOW_REMOTE_DB=1`. Do that only when the database is disposable: `reset()` truncates the Gatefit tables. A local `supabase start` URL uses `127.0.0.1`, which is a local host.

The migration is `supabase/migrations/<timestamp>_gatefit_access.sql`. It is the generic SQL plus:

```sql
-- Supabase exposes public tables through the Data API. RLS with no policies
-- keeps these rows server-only (anon and authenticated roles are denied).
ALTER TABLE gatefit_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE gatefit_seen_events ENABLE ROW LEVEL SECURITY;
```

`supabase db reset` applies it locally. `supabase db push` applies it to a linked project. In CI, `psql "$DATABASE_URL" -f <that file>` works too.

The adapter file is the same `createAdapter` as the generic template. The comment at the top says `supabase`:

```ts
// Gatefit access adapter (supabase template), generated by `gatefit init`.
// Gatefit replays billing transitions through apply() and reads the access row
// back with snapshot(). The assertion is the row in Postgres, not a Stripe 200.
//
// Run: npx gatefit run --suite tests/entitlements/goldens --adapter gatefit/adapter.ts
//
// decide() uses the reference rules in ./access-rules.ts so the free goldens pass
// out of the box. Replace it with the entitlement function your webhook handler
// calls, so CI tests your logic instead of the reference copy.
// This file imports nothing from Gatefit; `gatefit run` only calls createAdapter().
import { nextSnapshot, type AccessAdapter, type AccessSnapshot, type BillingEvent } from "./access-rules.ts";
import { connect, type Sql } from "./db.ts";

/** Pin your Stripe client to this version (new Stripe(key, { apiVersion })). */
export const STRIPE_API_VERSION = "2025-10-29.clover";

const decide: (current: AccessSnapshot, event: BillingEvent) => AccessSnapshot = nextSnapshot;

type AccessRow = {
  locked: boolean;
  plan: string | null;
  seats: number | null;
  features: string[] | null;
};

function rowToSnapshot(row: AccessRow | undefined): AccessSnapshot {
  if (!row) return { locked: true };
  const snap: AccessSnapshot = { locked: row.locked };
  if (row.plan != null) snap.plan = row.plan;
  if (row.seats != null) snap.seats = row.seats;
  if (row.features != null) snap.features = row.features;
  return snap;
}

const SELECT_ROW = "SELECT locked, plan, seats, features FROM gatefit_access WHERE customer_id = $1";

export function createAdapter(): AccessAdapter {
  const sql: Sql = connect();
  return {
    async apply(event: BillingEvent) {
      await sql.transaction(async (tx) => {
        // Idempotency: a replayed Stripe event id is a no-op.
        const fresh = await tx.query(
          "INSERT INTO gatefit_seen_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id",
          [event.id],
        );
        if (fresh.length === 0) return;
        const current = await tx.query<AccessRow>(`${SELECT_ROW} FOR UPDATE`, [event.customerId]);
        const next = decide(rowToSnapshot(current[0]), event);
        await tx.query(
          `INSERT INTO gatefit_access (customer_id, locked, plan, seats, features, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (customer_id) DO UPDATE SET
             locked = excluded.locked,
             plan = excluded.plan,
             seats = excluded.seats,
             features = excluded.features,
             updated_at = excluded.updated_at`,
          [event.customerId, next.locked, next.plan ?? null, next.seats ?? null, next.features ?? null],
        );
      });
    },
    async snapshot(customerId: string) {
      const rows = await sql.query<AccessRow>(SELECT_ROW, [customerId]);
      return rowToSnapshot(rows[0]);
    },
    async reset() {
      // Only Gatefit's own tables, and only on a local database (see db.ts).
      await sql.query("TRUNCATE gatefit_access, gatefit_seen_events");
    },
  };
}

export default createAdapter;
```

### Prisma and other ORMs

Prisma Client is not loaded in CI. Your drizzle client is not loaded in CI. Init writes a schema file so you can migrate with your tool, and the adapter still uses `pg` against `gatefit_access` and `gatefit_seen_events`.

```bash
npx gatefit@0.8.0 init --template prisma --no-prompt
npx gatefit@0.8.0 init --template drizzle --no-prompt
```

`gatefit/access.prisma` maps to those tables. Paste the models into `prisma/schema.prisma` and run `npx prisma migrate dev`, or apply `gatefit/migration.sql` as it is. Any Postgres 13 or newer works.

```prisma
// Prisma models for the Gatefit access tables, generated by `gatefit init`.
// Matches gatefit/migration.sql. Paste these models into prisma/schema.prisma
// and run `npx prisma migrate dev`, or apply migration.sql as is.

model GatefitAccess {
  customerId String   @id @map("customer_id")
  locked     Boolean  @default(true)
  plan       String?
  seats      Int?
  features   String[]
  updatedAt  DateTime @default(now()) @map("updated_at") @db.Timestamptz

  @@map("gatefit_access")
}

model GatefitSeenEvent {
  eventId String   @id @map("event_id")
  seenAt  DateTime @default(now()) @map("seen_at") @db.Timestamptz

  @@map("gatefit_seen_events")
}
```

`gatefit/schema.ts` (the drizzle template) defines `pgTable("gatefit_access", ...)` and `pgTable("gatefit_seen_events", ...)`. Add it to the drizzle-kit schema and run `npx drizzle-kit push`, or apply the migration. The adapter does not import `schema.ts` or `drizzle-orm`.

This is the adapter the prisma template writes. The drizzle template writes the same functions. The comment says `prisma` or `drizzle`.

```ts
// Gatefit access adapter (prisma template), generated by `gatefit init`.
// Gatefit replays billing transitions through apply() and reads the access row
// back with snapshot(). The assertion is the row in Postgres, not a Stripe 200.
//
// Run: npx gatefit run --suite tests/entitlements/goldens --adapter gatefit/adapter.ts
//
// decide() uses the reference rules in ./access-rules.ts so the free goldens pass
// out of the box. Replace it with the entitlement function your webhook handler
// calls, so CI tests your logic instead of the reference copy.
// This file imports nothing from Gatefit; `gatefit run` only calls createAdapter().
import { nextSnapshot, type AccessAdapter, type AccessSnapshot, type BillingEvent } from "./access-rules.ts";
import { connect, type Sql } from "./db.ts";

/** Pin your Stripe client to this version (new Stripe(key, { apiVersion })). */
export const STRIPE_API_VERSION = "2025-10-29.clover";

const decide: (current: AccessSnapshot, event: BillingEvent) => AccessSnapshot = nextSnapshot;

type AccessRow = {
  locked: boolean;
  plan: string | null;
  seats: number | null;
  features: string[] | null;
};

function rowToSnapshot(row: AccessRow | undefined): AccessSnapshot {
  if (!row) return { locked: true };
  const snap: AccessSnapshot = { locked: row.locked };
  if (row.plan != null) snap.plan = row.plan;
  if (row.seats != null) snap.seats = row.seats;
  if (row.features != null) snap.features = row.features;
  return snap;
}

const SELECT_ROW = "SELECT locked, plan, seats, features FROM gatefit_access WHERE customer_id = $1";

export function createAdapter(): AccessAdapter {
  const sql: Sql = connect();
  return {
    async apply(event: BillingEvent) {
      await sql.transaction(async (tx) => {
        // Idempotency: a replayed Stripe event id is a no-op.
        const fresh = await tx.query(
          "INSERT INTO gatefit_seen_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id",
          [event.id],
        );
        if (fresh.length === 0) return;
        const current = await tx.query<AccessRow>(`${SELECT_ROW} FOR UPDATE`, [event.customerId]);
        const next = decide(rowToSnapshot(current[0]), event);
        await tx.query(
          `INSERT INTO gatefit_access (customer_id, locked, plan, seats, features, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (customer_id) DO UPDATE SET
             locked = excluded.locked,
             plan = excluded.plan,
             seats = excluded.seats,
             features = excluded.features,
             updated_at = excluded.updated_at`,
          [event.customerId, next.locked, next.plan ?? null, next.seats ?? null, next.features ?? null],
        );
      });
    },
    async snapshot(customerId: string) {
      const rows = await sql.query<AccessRow>(SELECT_ROW, [customerId]);
      return rowToSnapshot(rows[0]);
    },
    async reset() {
      // Only Gatefit's own tables, and only on a local database (see db.ts).
      await sql.query("TRUNCATE gatefit_access, gatefit_seen_events");
    },
  };
}

export default createAdapter;
```

### HTTP endpoint

Gatefit does not fetch an HTTP endpoint for access. There is no HTTP adapter. `loadAdapter` reads the adapter file, refuses `sk_live`, imports the module, and resolves `createAdapter()`, or `default`, or `adapter`. It checks that `apply` and `snapshot` are functions on the returned object. It does not call `apply`, `snapshot`, or `reset`, and it never calls `fetch`. The runner calls `reset` when the adapter has one, then `apply` and `snapshot` for each step. `reset` is required only when more than one golden runs.

`BillingEvent.httpStatus` and `BillingEvent.stripeHttpStatus` are fields on the event. The reference rules do not treat 200 as access. `src/adapters/naive.ts` does. `adapter-check` expects that module to fail S1.

If the only copy of entitlement state is behind HTTP, implement `AccessAdapter` in a local module that reads and writes your own store inside `apply` and `snapshot`. The block below is that shape. It is not a client for a URL. It passes S1–S12 (17 goldens) only because `nextSnapshot` is the reference rules and event ids are stored in a `Set`. It does not prove your service.

```ts
// Not an HTTP client. gatefit run never calls fetch. This Map is the
// AccessAdapter shape: apply, snapshot, and reset. It agrees with the free
// suite only because nextSnapshot is the reference rules and event ids are
// recorded. It does not read your service.
import { nextSnapshot, type AccessAdapter, type AccessSnapshot, type BillingEvent } from "./access-rules.ts";

export function createAdapter(): AccessAdapter {
  const rows = new Map<string, AccessSnapshot>();
  const seen = new Set<string>();
  return {
    apply(event: BillingEvent): void {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      const current = rows.get(event.customerId) ?? { locked: true };
      rows.set(event.customerId, nextSnapshot(current, event));
    },
    snapshot(customerId: string): AccessSnapshot {
      return rows.get(customerId) ?? { locked: true };
    },
    reset(): void {
      rows.clear();
      seen.clear();
    },
  };
}

export default createAdapter;
```

## 4. Stripe test mode

The free suite does not call Stripe. You do not need a secret for `gatefit run`.

`loadAdapter` scans the adapter source and `JSON.stringify(process.env)`. A live secret in either one throws before any check:

```text
refuse sk_live: Gatefit will not load a live Stripe secret
```

Keep any app secret in the environment, not in the adapter file, and only as a test-mode key (`sk_test_...`). Pin the Stripe client to `2025-10-29.clover`, the `STRIPE_API_VERSION` the generated adapter exports. That constant is `STRIPE_API_VERSION` in `src/stripe-clock.ts`.

`gatefit init` checks the arguments, the environment, and `.env*` files before it writes. A live key exits 4 and names the place, never the key:

```text
gatefit init: refuse sk_live: a live Stripe secret is present in the environment.
Gatefit only works with test mode. Remove the live key, then rerun. Nothing was written.
```

The place can also be `the command-line arguments` or the `.env` file name.

`gatefit live` is a separate opt-in lane, not the first result. It needs `GATEFIT_LIVE_CLOCK=1` and `STRIPE_SECRET_KEY` or `STRIPE_API_KEY` starting with `sk_test_`. Details: [Live Test Clocks](live-clock.md). Leave `GATEFIT_LIVE_CLOCK` unset for `gatefit run`.

## 5. Run the free suite

One check first:

```bash
npx gatefit@0.8.0 run --suite paid_grants_access --adapter gatefit/adapter.ts
```

Then the directory that ships in the package (`files` includes `tests/entitlements/goldens`):

```bash
npx gatefit@0.8.0 run --suite tests/entitlements/goldens --adapter gatefit/adapter.ts
```

From the app repo, that directory resolves inside the installed package. A name that is not an id and not a directory throws `suite not found:`.

`paid_grants_access` is one file, so `reset` is optional. The directory is more than one file, so `reset` is required.

Each check prints one line to stderr. File names are sorted, so the first line of the directory run is not `paid_grants_access`.

Exit 0 means every check passed. Exit 1 means at least one did not. Pass and fail lines do not change the license rule: this suite stays free.

## 6. Read the first result

`paid_grants_access` has one step. The event is `invoice.paid` for `cus_s1` with `plan: pro`. The expected snapshot is `locked: false` and `plan: "pro"`. `locked: false` means the customer is allowed.

```text
gatefit: PASS paid_grants_access
```

A pass of the generated adapter means `nextSnapshot` and the `gatefit_access` row agree with the suite. It does not yet mean your webhook code ran. Point `SELECT_ROW` and the upsert at your table, and set `decide` to your function. The next failure is then a difference between the suite and your rows.

A failure prints the check id and one line per bad step. The step index is 0-based. Each compared field is `field: expected <json>, got <json>`. Fields on the same step are joined with `; `.

```text
gatefit: FAIL paid_grants_access
  step 0: locked: expected false, got true; plan: expected "pro", got undefined
```

That line is what you get when `snapshot` returns `{ locked: true }` and no plan. The generated `rowToSnapshot` returns that when the customer has no row. The same line is what `src/adapters/naive.ts` prints for this check, because `paid_grants_access` has no `httpStatus`, so the naive adapter never writes a row.

On `trial_no_card`, step 1 is `customer.subscription.trial_will_end` with `httpStatus: 200` and the row must stay locked. The naive adapter prints:

```text
gatefit: FAIL trial_no_card
  step 1: locked: expected true, got false
```

`duplicate_webhook_idempotent` pays, deletes the subscription, then replays the same `invoice.paid` id. The replay must leave the row locked. An adapter that applies the event again prints:

```text
gatefit: FAIL duplicate_webhook_idempotent
  step 3: locked: expected true, got false
```

The insert into `gatefit_seen_events` with `ON CONFLICT DO NOTHING` is what makes that replay a no-op.

The full list of checks is on the [Goldens](../site/src/content/docs/goldens.md) page. The [GitHub Action](../site/src/content/docs/action.md) runs the same free suite.

## Troubleshooting

Messages below are the ones the CLI and the generated adapter print. `gatefit run` prints an exception's `message` and exits 1.

### Missing flags

`gatefit run` without `--suite` or `--adapter` prints the usage text and exits 1.

### Suite name

```text
suite not found: missing-suite
```

Use an id such as `paid_grants_access`, or the directory `tests/entitlements/goldens`. The suite is resolved before the adapter path.

### Adapter path

```text
path not found: ./gatefit/adapter.ts
```

The path is checked in the working directory, then in the package. Run `gatefit init` in the app repo, or pass the path init printed (`gatefit/adapter.ts`).

### Adapter shape

```text
adapter /tmp/gatefit-bad-adapter.mjs must export createAdapter() or AccessAdapter with apply + snapshot
```

Export `createAdapter`, or `default` (a function or an object), or `adapter`. The object needs `apply` and `snapshot`. The path in the message is the one you passed.

### reset

```text
adapter.reset is required when running more than one golden
```

The directory run calls `reset` before each check. One id, such as `paid_grants_access`, does not require it. `reset` in the generated adapter truncates `gatefit_access` and `gatefit_seen_events` only.

### DATABASE_URL

```text
gatefit adapter: set DATABASE_URL to a disposable Postgres (CI service container or local dev DB)
```

```text
gatefit adapter: DATABASE_URL is not a valid postgres:// URL
```

```text
gatefit adapter: DATABASE_URL host is not local. Goldens truncate gatefit_access between runs. Point it at a disposable database, or set GATEFIT_ALLOW_REMOTE_DB=1 if this one is disposable.
```

`connect()` throws these from `gatefit/db.ts` when `createAdapter()` runs. `psql` against `postgres://localhost:5432/gatefit_ci` before that database exists fails with:

```text
database "gatefit_ci" does not exist
```

Create it with `createdb gatefit_ci` (or `psql -d postgres -c 'CREATE DATABASE gatefit_ci'`), then apply `gatefit/migration.sql`. A missing table, after the database exists, is an error from `pg` (the driver message), and the process exits 1 with that message.

### Live key on run

```text
refuse sk_live: Gatefit will not load a live Stripe secret
```

Remove the live key from the adapter file and from the environment. The free suite needs no Stripe key. A test-mode key starts with `sk_test_`.

### Live key on init

```text
gatefit init: refuse sk_live: a live Stripe secret is present in the environment.
Gatefit only works with test mode. Remove the live key, then rerun. Nothing was written.
```

Exit 4. Nothing is written. The same check refuses a key in the arguments or in a `.env*` file in the project.

### GATEFIT_LIVE_CLOCK left on

```text
fixture-first driver refuses GATEFIT_LIVE_CLOCK; use YAML step order only
```

Unset `GATEFIT_LIVE_CLOCK` for `gatefit run`. The free suite follows the step order in the package. It does not call Stripe.

### Live lane, if you run it first by mistake

```text
live lane is opt-in: set GATEFIT_LIVE_CLOCK=1
```

```text
live lane requires STRIPE_SECRET_KEY or STRIPE_API_KEY (sk_test_ only)
```

```text
refuse non-test Stripe secret: live lane requires sk_test_
```

Those are `gatefit live`, not the free suite. The free suite is the result to read first.

### Init will not write

Unknown template, exit 2:

```text
gatefit init: unknown template: no-such
```

Files already present, exit 3. This is a second `init --template generic` in the same repo:

```text
gatefit init: these files already exist. Nothing was written.
  gatefit/access-rules.ts
  gatefit/adapter.ts
  gatefit/db.ts
  gatefit/README.md
  gatefit/env.example
  gatefit/migration.sql
  gatefit.config.json
Rerun with --force to overwrite them, or pick another --dir.
```

`--dir` must stay inside the project. A path outside it, or a symlink that resolves outside it, exits 2 and writes nothing.

### Chaos, Polar, or Paddle on the first run

```text
gatefit: Pro pack requires GATEFIT_LICENSE_KEY. Buy the Indie License: https://gatefit.io/#pricing
```

`--suite chaos`, `--suite polar`, and `--suite paddle` ask for the license. S1–S12 (17 goldens) does not. The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free.

### SQLite reference adapter

The init path uses `pg`. `src/adapters/sqlite.ts` in a Gatefit checkout is a reference adapter. If `better-sqlite3` did not load, that command prints:

```text
gatefit: SQLite adapter cannot load better-sqlite3.
```

The same error includes this fix line: `Fix: upgrade npm to 10 or newer and reinstall, or reinstall with npm install --ignore-scripts to use the shipped prebuild, or install a C++ compiler (Xcode Command Line Tools on macOS, or build-essential on Linux) and reinstall.`

`--version`, `--help`, and `adapter-check` do not need that module.

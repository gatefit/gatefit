import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { assertNoLiveStripeSecret, type AccessAdapter, type AccessSnapshot, type BillingEvent } from "../access-adapter.ts";
import { isCapePeriodEnded, isImmediateCancel, nextSnapshot } from "../access-rules.ts";
import { packageRoot, userCwd } from "../paths.ts";
import {
  type AccessSchema,
  type Dialect,
  SchemaMapError,
  assertLocalDatabaseUrl,
  featuresFromRow,
  paidFromRow,
  parseAccessSchema,
  planFromRow,
  quoteIdent,
  readTime,
  schemaFindings,
  seatsFromRow,
  statusFromEvent,
  storeActive,
  storeTime,
} from "../schema-map.ts";

const require = createRequire(import.meta.url);

type Sql = {
  all(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params: readonly unknown[]): Promise<number>;
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
};

type Memory = {
  snapshot: AccessSnapshot;
  lastCreated?: number;
};

type Applied = {
  kind: "applied";
  snapshot: AccessSnapshot;
  lastCreated?: number;
};

type TxResult = Applied | { kind: "duplicate" };

function prepare(dialect: Dialect, sql: string): string {
  if (dialect === "sqlite") return sql;
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function resolveSchema(spec: string): string {
  const candidates = path.isAbsolute(spec)
    ? [spec]
    : [path.resolve(userCwd(), spec), path.resolve(packageRoot(), spec)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new SchemaMapError(`gatefit: access mapping not found: ${spec}`);
}

function resolveDatabase(spec: string): string {
  if (spec === ":memory:") return spec;
  return path.isAbsolute(spec) ? spec : path.resolve(userCwd(), spec);
}

function loadSqlite(): typeof import("better-sqlite3") {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const probe = new Database(":memory:");
    probe.close();
    return Database;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SchemaMapError(
      [
        "gatefit: SQLite adapter cannot load better-sqlite3.",
        "The native module is missing. better-sqlite3 is optional and ships prebuilds for linux, darwin, and win32 (x64 and arm64).",
        `Detail: ${detail}`,
      ].join("\n"),
    );
  }
}

function sqliteSql(file: string): Sql {
  if (file !== ":memory:" && !fs.existsSync(file)) {
    throw new SchemaMapError(`gatefit: sqlite database file is not there: ${file}`);
  }
  const Database = loadSqlite();
  const db = new Database(file);
  db.pragma("busy_timeout = 5000");
  const sql: Sql = {
    async all(text, params) {
      return db.prepare(text).all(...params) as Record<string, unknown>[];
    },
    async run(text, params) {
      return db.prepare(text).run(...params).changes;
    },
    async transaction(fn) {
      db.exec("BEGIN");
      try {
        const result = await fn(sql);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return sql;
}

type PgQuery = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

function clientSql(query: PgQuery): Sql {
  const sql: Sql = {
    async all(text, params) {
      const result = await query(text, params);
      return result.rows;
    },
    async run(text, params) {
      const result = await query(text, params);
      return result.rowCount ?? 0;
    },
    async transaction(fn) {
      await query("BEGIN");
      try {
        const result = await fn(sql);
        await query("COMMIT");
        return result;
      } catch (err) {
        try {
          await query("ROLLBACK");
        } catch {
          /* keep the original error */
        }
        throw err;
      }
    },
  };
  return sql;
}

async function postgresSql(env: NodeJS.ProcessEnv): Promise<Sql> {
  assertLocalDatabaseUrl(env.DATABASE_URL ?? "", env);
  let Pool: new (config: { connectionString: string; max: number }) => {
    query: PgQuery;
    connect(): Promise<{ query: PgQuery; release(): void }>;
  };
  try {
    // Optional dependency. Loaded only for dialect postgres so a sqlite mapping does not require pg.
    const loaded = (await import("pg")) as {
      Pool?: typeof Pool;
      default?: { Pool?: typeof Pool };
    };
    const ctor = loaded.Pool ?? loaded.default?.Pool;
    if (!ctor) throw new SchemaMapError("gatefit: postgres mapping cannot load pg");
    Pool = ctor;
  } catch (err) {
    if (err instanceof SchemaMapError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new SchemaMapError(
      `gatefit: postgres mapping cannot load pg. Install pg to use dialect postgres. Detail: ${detail}`,
    );
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL ?? "", max: 2 });
  return {
    all: (text, params) => pool.query(text, params).then((result) => result.rows),
    run: (text, params) => pool.query(text, params).then((result) => result.rowCount ?? 0),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        return await clientSql((text, params) => client.query(text, params)).transaction(fn);
      } finally {
        client.release();
      }
    },
  };
}

async function openDatabase(schema: AccessSchema, env: NodeJS.ProcessEnv): Promise<Sql> {
  switch (schema.dialect) {
    case "sqlite":
      return sqliteSql(resolveDatabase(schema.database ?? ""));
    case "postgres":
      return postgresSql(env);
    default: {
      const neverDialect: never = schema.dialect;
      return neverDialect;
    }
  }
}

async function assertTable(sql: Sql, dialect: Dialect, table: string, role: "access" | "dedupe"): Promise<void> {
  const query =
    dialect === "sqlite"
      ? "SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = ?"
      : "SELECT 1 AS hit FROM information_schema.tables WHERE table_name = ? AND table_schema = ANY (current_schemas(false))";
  const rows = await sql.all(prepare(dialect, query), [table]);
  if (rows.length === 0) {
    const label = role === "access" ? "access table" : "event dedupe table";
    throw new SchemaMapError(`gatefit: ${label} "${table}" is not in the database`);
  }
}

function rowEnd(row: Record<string, unknown>, schema: AccessSchema): number {
  if (!schema.columns.periodEnd) return 0;
  return readTime(row[schema.columns.periodEnd]);
}

function pickRow(rows: Record<string, unknown>[], schema: AccessSchema): Record<string, unknown> {
  const ranked = [...rows].sort((a, b) => {
    const byEnd = rowEnd(b, schema) - rowEnd(a, schema);
    if (byEnd !== 0) return byEnd;
    const idA = String(a[schema.columns.id ?? schema.columns.customerId] ?? "");
    const idB = String(b[schema.columns.id ?? schema.columns.customerId] ?? "");
    if (idA < idB) return -1;
    if (idA > idB) return 1;
    return 0;
  });
  return ranked.find((row) => paidFromRow(row, schema.columns)) ?? ranked[0]!;
}

function projectSnapshot(rows: Record<string, unknown>[], mem: Memory | undefined, schema: AccessSchema): AccessSnapshot {
  if (rows.length === 0) return { locked: true };
  const chosen = pickRow(rows, schema);
  const snap: AccessSnapshot = { locked: !rows.some((row) => paidFromRow(row, schema.columns)) };
  const plan = planFromRow(chosen, schema.columns);
  if (plan !== undefined) snap.plan = plan;
  if (schema.columns.seats) {
    const seats = seatsFromRow(chosen, schema.columns);
    if (seats !== undefined) snap.seats = seats;
  } else if (mem?.snapshot.seats !== undefined) {
    snap.seats = mem.snapshot.seats;
  }
  if (schema.columns.features) {
    const features = featuresFromRow(chosen, schema.columns);
    if (features !== undefined) snap.features = features;
  } else if (mem?.snapshot.features !== undefined) {
    snap.features = mem.snapshot.features;
  }
  return snap;
}

function isBareDeny(snap: AccessSnapshot): boolean {
  return snap.locked && snap.plan === undefined && snap.seats === undefined && snap.features === undefined;
}

function eventUnix(event: BillingEvent): number {
  if (typeof event.now === "number") return event.now;
  if (typeof event.created === "number") return event.created;
  return 0;
}

type Slot = { column: string; value: unknown };

function writeSlots(schema: AccessSchema, event: BillingEvent, next: AccessSnapshot, mode: "insert" | "update"): Slot[] {
  const slots: Slot[] = [];
  if (mode === "insert") {
    if (schema.columns.id) slots.push({ column: schema.columns.id, value: event.customerId });
    slots.push({ column: schema.columns.customerId, value: event.customerId });
    if (schema.columns.start) slots.push({ column: schema.columns.start, value: storeTime(eventUnix(event), schema.time) });
  }
  if (mode === "insert" || next.plan !== undefined) {
    slots.push({ column: schema.columns.plan, value: next.plan ?? "" });
  }
  if (schema.columns.active) {
    slots.push({ column: schema.columns.active, value: storeActive(!next.locked, schema.dialect) });
  }
  if (schema.columns.status) {
    slots.push({ column: schema.columns.status, value: statusFromEvent(event, next.locked) });
  }
  if (schema.columns.periodEnd) {
    if (typeof event.period_end === "number") {
      slots.push({ column: schema.columns.periodEnd, value: storeTime(event.period_end, schema.time) });
    } else if (mode === "insert") {
      slots.push({ column: schema.columns.periodEnd, value: storeTime(eventUnix(event), schema.time) });
    }
  }
  if (schema.columns.cancelAt) {
    const cancel = cancelValue(schema, event, next);
    if (cancel !== undefined) slots.push({ column: schema.columns.cancelAt, value: cancel });
    else if (mode === "insert") slots.push({ column: schema.columns.cancelAt, value: null });
  }
  if (schema.columns.seats) slots.push({ column: schema.columns.seats, value: next.seats ?? null });
  if (schema.columns.features) {
    slots.push({ column: schema.columns.features, value: next.features === undefined ? null : JSON.stringify(next.features) });
  }
  return slots;
}

function cancelValue(schema: AccessSchema, event: BillingEvent, next: AccessSnapshot): string | number | null | undefined {
  if (event.cancel_at_period_end === true && typeof event.period_end === "number") {
    return storeTime(event.period_end, schema.time);
  }
  if (!next.locked) return null;
  if (isImmediateCancel(event) || isCapePeriodEnded(event)) {
    const unix = typeof event.now === "number" ? event.now : typeof event.period_end === "number" ? event.period_end : event.created;
    if (typeof unix === "number") return storeTime(unix, schema.time);
    return null;
  }
  return undefined;
}

function statement(
  schema: AccessSchema,
  verb: "insert" | "update",
  slots: Slot[],
  where: { column: string; value: unknown },
): { sql: string; params: unknown[] } {
  const table = quoteIdent(schema.table, "table");
  if (verb === "insert") {
    const names = slots.map((slot) => quoteIdent(slot.column, "column")).join(", ");
    const marks = slots.map(() => "?").join(", ");
    return {
      sql: prepare(schema.dialect, `INSERT INTO ${table} (${names}) VALUES (${marks})`),
      params: slots.map((slot) => slot.value),
    };
  }
  const sets = slots.map((slot) => `${quoteIdent(slot.column, "column")} = ?`).join(", ");
  const column = quoteIdent(where.column, "column");
  return {
    sql: prepare(schema.dialect, `UPDATE ${table} SET ${sets} WHERE ${column} = ?`),
    params: [...slots.map((slot) => slot.value), where.value],
  };
}

function wrap(err: unknown): Error {
  if (err instanceof SchemaMapError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new SchemaMapError(`gatefit: mapped access table write failed: ${message}`);
}

function buildAdapter(sql: Sql, schema: AccessSchema): AccessAdapter {
  const memory = new Map<string, Memory>();
  const seenIds = new Set<string>();
  const table = quoteIdent(schema.table, "table");
  const customer = quoteIdent(schema.columns.customerId, 'column "customerId"');
  const selectSql = prepare(schema.dialect, `SELECT * FROM ${table} WHERE ${customer} = ?`);
  const deleteSql = prepare(schema.dialect, `DELETE FROM ${table}`);
  const dedupe = schema.dedupe;
  const dedupeSelect = dedupe
    ? prepare(
        schema.dialect,
        `SELECT 1 AS hit FROM ${quoteIdent(dedupe.table, "dedupe table")} WHERE ${quoteIdent(dedupe.eventId, "dedupe eventId")} = ?`,
      )
    : "";
  const dedupeInsert = dedupe
    ? prepare(
        schema.dialect,
        `INSERT INTO ${quoteIdent(dedupe.table, "dedupe table")} (${quoteIdent(dedupe.eventId, "dedupe eventId")}) VALUES (?)`,
      )
    : "";
  const dedupeDelete = dedupe ? prepare(schema.dialect, `DELETE FROM ${quoteIdent(dedupe.table, "dedupe table")}`) : "";

  return {
    async apply(event: BillingEvent) {
      if (typeof event.id !== "string" || event.id === "" || typeof event.customerId !== "string" || event.customerId === "") {
        throw new SchemaMapError("gatefit: billing event is missing id or customerId");
      }
      if (seenIds.has(event.id)) return;
      try {
        const outcome = await sql.transaction(async (tx) => {
          if (dedupe) {
            const hits = await tx.all(dedupeSelect, [event.id]);
            if (hits.length > 0) return { kind: "duplicate" } satisfies TxResult;
          }
          const mem = memory.get(event.customerId);
          if (typeof event.created === "number" && mem?.lastCreated !== undefined && event.created < mem.lastCreated) {
            if (dedupe) await tx.run(dedupeInsert, [event.id]);
            return { kind: "applied", snapshot: mem.snapshot, lastCreated: mem.lastCreated } satisfies Applied;
          }
          const rows = await tx.all(selectSql, [event.customerId]);
          const current = projectSnapshot(rows, mem, schema);
          const next = nextSnapshot(current, event);
          const lastCreated =
            typeof event.created === "number" ? Math.max(event.created, mem?.lastCreated ?? event.created) : mem?.lastCreated;
          if (rows.length === 0 && isBareDeny(next)) {
            if (dedupe) await tx.run(dedupeInsert, [event.id]);
            return { kind: "applied", snapshot: next, lastCreated } satisfies Applied;
          }
          const slots = writeSlots(schema, event, next, rows.length === 0 ? "insert" : "update");
          if (rows.length === 0) {
            const insert = statement(schema, "insert", slots, { column: schema.columns.customerId, value: event.customerId });
            await tx.run(insert.sql, insert.params);
          } else if (next.locked || !schema.columns.id) {
            // A revoke clears every row for the customer so a stale active row cannot
            // remain. A grant with no id column cannot tell the rows apart, so it
            // updates every match.
            const update = statement(schema, "update", slots, { column: schema.columns.customerId, value: event.customerId });
            await tx.run(update.sql, update.params);
          } else {
            const chosen = pickRow(rows, schema);
            const idValue = chosen[schema.columns.id];
            const update = statement(schema, "update", slots, {
              column: idValue === undefined || idValue === null ? schema.columns.customerId : schema.columns.id,
              value: idValue === undefined || idValue === null ? event.customerId : idValue,
            });
            await tx.run(update.sql, update.params);
          }
          if (dedupe) await tx.run(dedupeInsert, [event.id]);
          return { kind: "applied", snapshot: next, lastCreated } satisfies Applied;
        });
        seenIds.add(event.id);
        if (outcome.kind === "applied") {
          memory.set(event.customerId, { snapshot: outcome.snapshot, lastCreated: outcome.lastCreated });
        }
      } catch (err) {
        throw wrap(err);
      }
    },
    async snapshot(customerId: string) {
      try {
        const rows = await sql.all(selectSql, [customerId]);
        return projectSnapshot(rows, memory.get(customerId), schema);
      } catch (err) {
        throw wrap(err);
      }
    },
    async reset() {
      try {
        await sql.run(deleteSql, []);
        if (dedupe) await sql.run(dedupeDelete, []);
      } catch (err) {
        throw wrap(err);
      }
      memory.clear();
      seenIds.clear();
    },
  };
}

export async function createMappedAdapter(schemaPath: string, env: NodeJS.ProcessEnv = process.env): Promise<AccessAdapter> {
  const resolved = resolveSchema(schemaPath);
  let text: string;
  try {
    if (!fs.lstatSync(resolved).isFile()) {
      throw new SchemaMapError(`gatefit: access mapping is not a file: ${schemaPath}`);
    }
    text = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    if (err instanceof SchemaMapError) throw err;
    throw new SchemaMapError(`gatefit: access mapping not found: ${schemaPath}`);
  }
  assertNoLiveStripeSecret(text);
  assertNoLiveStripeSecret(JSON.stringify(env));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new SchemaMapError(`gatefit: access mapping is not valid JSON: ${schemaPath}`);
  }
  const schema = parseAccessSchema(parsed);
  const sql = await openDatabase(schema, env);
  await assertTable(sql, schema.dialect, schema.table, "access");
  if (schema.dedupe) await assertTable(sql, schema.dialect, schema.dedupe.table, "dedupe");
  for (const line of schemaFindings(schema)) console.error(line);
  return buildAdapter(sql, schema);
}

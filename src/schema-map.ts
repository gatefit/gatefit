import type { BillingEvent } from "./access-adapter.ts";
import {
  isCapePeriodEnded,
  isDispute,
  isImmediateCancel,
  isPastDue,
  isPaused,
  isRefund,
  isTrialing,
  isUnpaidExhaust,
} from "./access-rules.ts";

/**
 * Bring-your-own-schema map. Values are bound parameters. Identifiers are a
 * single ASCII name, quoted, and never taken from an event payload.
 *
 * Paid means the mapped row grants access (locked false). A missing row is not
 * paid. An active flag is paid only for boolean true or integer 1. A status
 * column is paid only for the exact string "active". trialing, past_due,
 * paused, canceled, unpaid, and every other status are not paid. When both
 * columns are mapped, both must agree or the row is not paid. period end and
 * cancel_at are stored from the event and do not grant access. HTTP 200 does
 * not grant access.
 */

export class SchemaMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaMapError";
  }
}

export const PAID_STATUS = "active";

export const EVENT_DEDUPE_FINDING =
  "gatefit: finding: event dedupe is not mapped; a replayed event id is ignored for this process only and is not stored in the database";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENT = 63;

const TOP_LEVEL = new Set(["dialect", "database", "table", "columns", "time", "dedupe"]);
const COLUMN_ROLES = new Set([
  "id",
  "customerId",
  "plan",
  "active",
  "status",
  "start",
  "periodEnd",
  "cancelAt",
  "seats",
  "features",
]);
const LOCKED_STATUSES = new Set([
  "trialing",
  "past_due",
  "paused",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "inactive",
  "disputed",
]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

export type Dialect = "sqlite" | "postgres";
export type TimeUnit = "iso" | "unix-seconds" | "unix-ms";

export type MappedColumns = {
  customerId: string;
  plan: string;
  id?: string;
  active?: string;
  status?: string;
  start?: string;
  periodEnd?: string;
  cancelAt?: string;
  seats?: string;
  features?: string;
};

export type DedupeMap = {
  table: string;
  eventId: string;
};

export type AccessSchema = {
  dialect: Dialect;
  /** Sqlite file path or ":memory:". Omitted for postgres (DATABASE_URL). */
  database?: string;
  table: string;
  columns: MappedColumns;
  time: TimeUnit;
  dedupe?: DedupeMap;
};

export function unmappedFieldsFinding(fields: readonly string[]): string {
  return `gatefit: finding: these access fields are not mapped and are kept in memory for this process only: ${fields.join(", ")}`;
}

export function schemaFindings(schema: AccessSchema): string[] {
  const out: string[] = [];
  if (!schema.dedupe) out.push(EVENT_DEDUPE_FINDING);
  const missing: string[] = [];
  if (!schema.columns.seats) missing.push("seats");
  if (!schema.columns.features) missing.push("features");
  if (missing.length > 0) out.push(unmappedFieldsFinding(missing));
  return out;
}

export function quoteIdent(name: string, role: string): string {
  if (!IDENT.test(name) || name.length > MAX_IDENT) {
    throw new SchemaMapError(`gatefit: access mapping ${role} is not a single identifier`);
  }
  return `"${name}"`;
}

/** True only for boolean true and integer 1. The string "true" is not paid. */
export function isActiveFlag(value: unknown): boolean {
  return value === true || value === 1;
}

export function paidFromRow(row: Record<string, unknown>, columns: MappedColumns): boolean {
  const hasActive = columns.active !== undefined;
  const hasStatus = columns.status !== undefined;
  const active = hasActive ? isActiveFlag(row[columns.active as string]) : false;
  const statusPaid = hasStatus && row[columns.status as string] === PAID_STATUS;
  if (hasActive && hasStatus) return active && statusPaid;
  if (hasActive) return active;
  if (hasStatus) return statusPaid;
  return false;
}

export function planFromRow(row: Record<string, unknown>, columns: MappedColumns): string | undefined {
  const value = row[columns.plan];
  if (typeof value !== "string" || value === "") return undefined;
  return value;
}

export function seatsFromRow(row: Record<string, unknown>, columns: MappedColumns): number | undefined {
  if (!columns.seats) return undefined;
  const value = row[columns.seats];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function featuresFromRow(row: Record<string, unknown>, columns: MappedColumns): string[] | undefined {
  if (!columns.features) return undefined;
  const value = row[columns.features];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

export function statusFromEvent(event: BillingEvent, locked: boolean): string {
  if (!locked) return PAID_STATUS;
  if (typeof event.status === "string" && LOCKED_STATUSES.has(event.status)) return event.status;
  if (isTrialing(event)) return "trialing";
  if (isPaused(event)) return "paused";
  if (isPastDue(event)) return "past_due";
  if (isUnpaidExhaust(event)) return "unpaid";
  if (isImmediateCancel(event) || isCapePeriodEnded(event)) return "canceled";
  if (isDispute(event)) return "disputed";
  if (isRefund(event)) return "inactive";
  return "inactive";
}

export function storeTime(unixSeconds: number, unit: TimeUnit): string | number {
  if (!Number.isFinite(unixSeconds)) {
    throw new SchemaMapError("gatefit: access mapping time is not a finite unix second");
  }
  switch (unit) {
    case "iso":
      return new Date(unixSeconds * 1000).toISOString();
    case "unix-seconds":
      return unixSeconds;
    case "unix-ms":
      return unixSeconds * 1000;
    default: {
      const neverUnit: never = unit;
      return neverUnit;
    }
  }
}

export function storeActive(paid: boolean, dialect: Dialect): boolean | number {
  switch (dialect) {
    case "postgres":
      return paid;
    case "sqlite":
      return paid ? 1 : 0;
    default: {
      const neverDialect: never = dialect;
      return neverDialect;
    }
  }
}

export function readTime(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber > 1e12 ? Math.floor(asNumber / 1000) : asNumber;
  }
  return 0;
}

/**
 * Refuses a non-local Postgres URL before any connection. The message does not
 * include the URL, the user, the password, or the host.
 */
export function assertLocalDatabaseUrl(url: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!url) {
    throw new SchemaMapError("gatefit: set DATABASE_URL to a disposable Postgres for the mapped access table");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new SchemaMapError("gatefit: DATABASE_URL is not a valid postgres:// URL");
  }
  if (!LOCAL_HOSTS.has(host) && env.GATEFIT_ALLOW_REMOTE_DB !== "1") {
    throw new SchemaMapError(
      "gatefit: DATABASE_URL host is not local. Refusing to write a mapped access table. Set GATEFIT_ALLOW_REMOTE_DB=1 only for a disposable database.",
    );
  }
}

function requireObject(value: unknown, role: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SchemaMapError(`gatefit: access mapping ${role} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireIdent(value: unknown, role: string): string {
  if (typeof value !== "string") {
    throw new SchemaMapError(`gatefit: access mapping ${role} is not a single identifier`);
  }
  quoteIdent(value, role);
  return value;
}

function optionalIdent(value: unknown, role: string): string | undefined {
  if (value === undefined) return undefined;
  return requireIdent(value, role);
}

export function parseAccessSchema(raw: unknown): AccessSchema {
  const body = requireObject(raw, "file");
  for (const key of Object.keys(body)) {
    if (!TOP_LEVEL.has(key)) {
      const shown = IDENT.test(key) && key.length <= MAX_IDENT ? key : "name";
      throw new SchemaMapError(`gatefit: access mapping has an unknown field "${shown}"`);
    }
  }
  const dialect = body.dialect;
  if (dialect !== "sqlite" && dialect !== "postgres") {
    throw new SchemaMapError("gatefit: access mapping dialect must be sqlite or postgres");
  }
  const table = requireIdent(body.table, "table");
  const columnsRaw = requireObject(body.columns, "columns");
  for (const key of Object.keys(columnsRaw)) {
    if (!COLUMN_ROLES.has(key)) {
      const shown = IDENT.test(key) && key.length <= MAX_IDENT ? key : "name";
      throw new SchemaMapError(`gatefit: access mapping has an unknown column "${shown}"`);
    }
  }
  const customerId = optionalIdent(columnsRaw.customerId, 'column "customerId"');
  const plan = optionalIdent(columnsRaw.plan, 'column "plan"');
  if (!customerId) throw new SchemaMapError('gatefit: access mapping is missing column "customerId"');
  if (!plan) throw new SchemaMapError('gatefit: access mapping is missing column "plan"');
  const columns: MappedColumns = {
    customerId,
    plan,
    id: optionalIdent(columnsRaw.id, 'column "id"'),
    active: optionalIdent(columnsRaw.active, 'column "active"'),
    status: optionalIdent(columnsRaw.status, 'column "status"'),
    start: optionalIdent(columnsRaw.start, 'column "start"'),
    periodEnd: optionalIdent(columnsRaw.periodEnd, 'column "periodEnd"'),
    cancelAt: optionalIdent(columnsRaw.cancelAt, 'column "cancelAt"'),
    seats: optionalIdent(columnsRaw.seats, 'column "seats"'),
    features: optionalIdent(columnsRaw.features, 'column "features"'),
  };
  if (!columns.active && !columns.status) {
    throw new SchemaMapError("gatefit: access mapping is missing an active flag or a status column");
  }
  const claimed = new Map<string, string>();
  for (const [role, name] of Object.entries(columns)) {
    if (!name) continue;
    const previous = claimed.get(name);
    if (previous) {
      throw new SchemaMapError(`gatefit: access mapping maps ${previous} and ${role} to the same column`);
    }
    claimed.set(name, role);
  }
  let time: TimeUnit = "iso";
  if (body.time !== undefined) {
    if (body.time !== "iso" && body.time !== "unix-seconds" && body.time !== "unix-ms") {
      throw new SchemaMapError("gatefit: access mapping time must be iso, unix-seconds, or unix-ms");
    }
    time = body.time;
  }
  let database: string | undefined;
  if (dialect === "sqlite") {
    if (typeof body.database !== "string" || body.database === "") {
      throw new SchemaMapError("gatefit: access mapping is missing database");
    }
    if (body.database !== ":memory:" && body.database.includes("://")) {
      throw new SchemaMapError("gatefit: sqlite database must be a file path or :memory:, not a URL");
    }
    database = body.database;
  } else if (body.database !== undefined) {
    throw new SchemaMapError("gatefit: access mapping database is only for sqlite; postgres uses DATABASE_URL");
  }
  let dedupe: DedupeMap | undefined;
  if (body.dedupe !== undefined) {
    const dedupeRaw = requireObject(body.dedupe, "dedupe");
    for (const key of Object.keys(dedupeRaw)) {
      if (key !== "table" && key !== "eventId") {
        throw new SchemaMapError('gatefit: access mapping has an unknown dedupe field');
      }
    }
    const dedupeTable = requireIdent(dedupeRaw.table, "dedupe table");
    const eventId = requireIdent(dedupeRaw.eventId, "dedupe eventId");
    if (dedupeTable === table) {
      throw new SchemaMapError("gatefit: access mapping dedupe table must be a different table");
    }
    dedupe = { table: dedupeTable, eventId };
  }
  return { dialect, database, table, columns, time, dedupe };
}

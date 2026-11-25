import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMappedAdapter } from "../../../src/adapters/mapped.ts";
import {
  EVENT_DEDUPE_FINDING,
  assertLocalDatabaseUrl,
  parseAccessSchema,
  schemaFindings,
  unmappedFieldsFinding,
} from "../../../src/schema-map.ts";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

const root = path.join(import.meta.dirname, "../../..");
const bin = path.join(root, "bin/gatefit.js");
const fixtureDir = path.join(root, "tests/fixtures/saas-starter");
const starterSql = fs.readFileSync(path.join(fixtureDir, "subscription.sql"), "utf8");
const goldensDir = path.join(root, "tests/entitlements/goldens");
const STACK = /\n\s+at /;

const STATUS_SQL = `
CREATE TABLE Subscription (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  priceId TEXT NOT NULL,
  status TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  cancelAt TEXT
);
CREATE INDEX Subscription_customerId_idx ON Subscription (customerId);
`;

type SpawnResult = { status: number | null; stderr: string; stdout: string };

function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GATEFIT_TELEMETRY: "0", DO_NOT_TRACK: "1", ...extra };
  delete env.GATEFIT_LIVE_CLOCK;
  delete env.GATEFIT_SCHEMA;
  delete env.GATEFIT_ALLOW_REMOTE_DB;
  return env;
}

function runCli(args: string[], extra: NodeJS.ProcessEnv = {}): SpawnResult {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv(extra),
  });
  return { status: result.status, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
}

function assertNoStack(stderr: string): void {
  assert.doesNotMatch(stderr, STACK);
}

function schemaSql(file: string): string {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all();
    return JSON.stringify(rows);
  } finally {
    db.close();
  }
}

function columnNames(file: string): string[] {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("PRAGMA table_info(Subscription)").all() as { name: string }[];
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

function tableRows(file: string): Record<string, unknown>[] {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT * FROM Subscription ORDER BY id").all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

function writeDb(dir: string, sql: string): string {
  const file = path.join(dir, "subscription.sqlite");
  const db = new Database(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
  return file;
}

function writeSchema(dir: string, database: string, columns: Record<string, string>, dedupe?: { table: string; eventId: string }): string {
  const body: Record<string, unknown> = {
    dialect: "sqlite",
    database,
    table: "Subscription",
    columns,
  };
  if (dedupe) body.dedupe = dedupe;
  const file = path.join(dir, "schema.json");
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

const STARTER_COLUMNS = {
  id: "id",
  customerId: "customerId",
  plan: "priceId",
  active: "active",
  start: "startDate",
  periodEnd: "endDate",
  cancelAt: "cancelAt",
};

const STATUS_COLUMNS = {
  id: "id",
  customerId: "customerId",
  plan: "priceId",
  status: "status",
  start: "startDate",
  periodEnd: "endDate",
  cancelAt: "cancelAt",
};

function fresh(sql: string, columns: Record<string, string>, dedupe?: { table: string; eventId: string }): { dir: string; db: string; schema: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-byo-"));
  const db = writeDb(dir, sql);
  const schema = writeSchema(dir, db, columns, dedupe);
  return { dir, db, schema };
}

function passLines(stderr: string): void {
  const ids = fs
    .readdirSync(goldensDir)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -".yaml".length));
  assert.equal(ids.length, 17);
  for (const id of ids) assert.match(stderr, new RegExp(`gatefit: PASS ${id}\\b`));
  assert.doesNotMatch(stderr, /gatefit: FAIL /);
}

const example = parseAccessSchema(JSON.parse(fs.readFileSync(path.join(fixtureDir, "schema.json"), "utf8")) as unknown);
assert.equal(example.dialect, "sqlite");
assert.equal(example.table, "Subscription");
assert.equal(example.columns.customerId, "customerId");
assert.equal(example.columns.plan, "priceId");
assert.equal(example.columns.active, "active");
assert.equal(example.columns.start, "startDate");
assert.equal(example.columns.periodEnd, "endDate");
assert.equal(example.columns.cancelAt, "cancelAt");
assert.equal(example.columns.id, "id");
assert.equal(example.dedupe, undefined);
assert.deepEqual(schemaFindings(example), [
  EVENT_DEDUPE_FINDING,
  unmappedFieldsFinding(["seats", "features"]),
]);

for (const rel of ["src/schema-map.ts", "src/adapters/mapped.ts"]) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP|TRUNCATE)\b/, `${rel} issues DDL`);
}

const remote = "postgres://app:secret@example.com:5432/billing";
assert.throws(() => assertLocalDatabaseUrl(remote, {}), /not local/);
try {
  assertLocalDatabaseUrl(remote, {});
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  assert.equal(message.includes("secret"), false);
  assert.equal(message.includes("example.com"), false);
  assert.equal(message.includes("app:"), false);
}
assert.doesNotThrow(() => assertLocalDatabaseUrl("postgres://localhost/billing", {}));
assert.throws(() => assertLocalDatabaseUrl("not a url", {}), /not a valid postgres/);
assert.throws(() => assertLocalDatabaseUrl("", {}), /set DATABASE_URL/);

const missingSchema = runCli(["run", "--suite", "paid_grants_access", "--schema", path.join(os.tmpdir(), "gatefit-missing-schema.json")]);
assert.equal(missingSchema.status, 1);
assert.match(missingSchema.stderr, /gatefit: access mapping not found:/);
assertNoStack(missingSchema.stderr);

const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-byo-bad-"));
try {
  const badJson = path.join(badDir, "bad.json");
  fs.writeFileSync(badJson, "{");
  const invalid = runCli(["run", "--suite", "paid_grants_access", "--schema", badJson]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /not valid JSON/);
  assertNoStack(invalid.stderr);

  const empty = path.join(badDir, "empty.json");
  fs.writeFileSync(empty, "{}\n");
  const missingDialect = runCli(["run", "--suite", "paid_grants_access", "--schema", empty]);
  assert.equal(missingDialect.status, 1);
  assert.match(missingDialect.stderr, /dialect must be sqlite or postgres/);
  assertNoStack(missingDialect.stderr);

  const ghost = path.join(badDir, "ghost.sqlite");
  const injected = path.join(badDir, "injected.json");
  fs.writeFileSync(
    injected,
    `${JSON.stringify({
      dialect: "sqlite",
      database: ghost,
      table: "Subscription",
      columns: { customerId: "customerId); DROP TABLE Subscription;--", plan: "priceId", active: "active" },
    })}\n`,
  );
  const injection = runCli(["run", "--suite", "paid_grants_access", "--schema", injected]);
  assert.equal(injection.status, 1);
  assert.match(injection.stderr, /column "customerId" is not a single identifier/);
  assert.equal(fs.existsSync(ghost), false);
  assertNoStack(injection.stderr);

  const liveKey = "sk_" + "live_example";
  const leaky = path.join(badDir, "leaky.json");
  const leakyDb = path.join(badDir, "leaky.sqlite");
  fs.writeFileSync(
    leaky,
    `${JSON.stringify({
      dialect: "sqlite",
      database: leakyDb,
      table: "Subscription",
      columns: { customerId: "customerId", plan: "priceId", active: "active" },
      note: liveKey,
    })}\n`,
  );
  const refusedKey = runCli(["run", "--suite", "paid_grants_access", "--schema", leaky]);
  assert.equal(refusedKey.status, 1);
  assert.match(refusedKey.stderr, /refuse sk_live: Gatefit will not load a live Stripe secret/);
  assert.equal(refusedKey.stderr.includes(liveKey), false);
  assert.equal(fs.existsSync(leakyDb), false);
  assertNoStack(refusedKey.stderr);
} finally {
  fs.rmSync(badDir, { recursive: true, force: true });
}

const absent = path.join(root, "subscription.sqlite");
assert.equal(fs.existsSync(absent), false);
const missingFile = runCli(["run", "--suite", "paid_grants_access", "--schema", "tests/fixtures/saas-starter/schema.json"]);
assert.equal(missingFile.status, 1);
assert.match(missingFile.stderr, /sqlite database file is not there:/);
assert.equal(fs.existsSync(absent), false);
assertNoStack(missingFile.stderr);

const licenseEnv = {
  GATEFIT_LICENSE_KEY: "not-a-license",
  GATEFIT_LICENSE_VALIDATE_URL: "http://127.0.0.1:9/validate",
};

const starter = fresh(starterSql, STARTER_COLUMNS);
try {
  const both = runCli(["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/hardened.ts", "--schema", starter.schema]);
  assert.equal(both.status, 1);
  assert.match(both.stderr, /pass --schema or --adapter, not both/);
  assertNoStack(both.stderr);

  const polar = runCli(["run", "--suite", "polar", "--schema", starter.schema], licenseEnv);
  assert.equal(polar.status, 1);
  assert.match(polar.stderr, /--schema maps an access table on the free suite/);
  assert.doesNotMatch(polar.stderr, /Indie License/);
  assertNoStack(polar.stderr);

  const polarDir = runCli(["run", "--suite", "src/packs/polar/goldens", "--schema", starter.schema], licenseEnv);
  assert.equal(polarDir.status, 1);
  assert.match(polarDir.stderr, /--schema does not run Polar or Paddle goldens/);
  assert.doesNotMatch(polarDir.stderr, /Indie License/);
  assertNoStack(polarDir.stderr);

  const before = schemaSql(starter.db);
  const columnsBefore = columnNames(starter.db);
  assert.deepEqual(columnsBefore, ["id", "customerId", "priceId", "active", "startDate", "endDate", "cancelAt"]);
  const suite = runCli(["run", "--suite", "tests/entitlements/goldens", "--schema", starter.schema], licenseEnv);
  assert.equal(suite.status, 0, suite.stderr);
  passLines(suite.stderr);
  assert.match(suite.stderr, new RegExp(EVENT_DEDUPE_FINDING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(suite.stderr, /seats, features/);
  assert.doesNotMatch(suite.stderr, /Indie License/);
  assert.equal(schemaSql(starter.db), before);
  assert.deepEqual(columnNames(starter.db), columnsBefore);

  const paid = fresh(starterSql, STARTER_COLUMNS);
  try {
    const one = runCli(["run", "--suite", "paid_grants_access", "--schema", paid.schema]);
    assert.equal(one.status, 0, one.stderr);
    const rows = tableRows(paid.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "cus_s1");
    assert.equal(rows[0]?.customerId, "cus_s1");
    assert.equal(rows[0]?.priceId, "pro");
    assert.equal(rows[0]?.active, 1);
    assert.equal(rows[0]?.cancelAt, null);
    assert.equal(rows[0]?.startDate, "1970-01-01T00:00:00.000Z");
    assert.equal(rows[0]?.endDate, "1970-01-01T00:00:00.000Z");
  } finally {
    fs.rmSync(paid.dir, { recursive: true, force: true });
  }

  const cape = fresh(starterSql, STARTER_COLUMNS);
  try {
    const run = runCli(["run", "--suite", "cancel_at_period_end_keeps_access_until_end", "--schema", cape.schema]);
    assert.equal(run.status, 0, run.stderr);
    const rows = tableRows(cape.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.customerId, "cus_h6_cape");
    assert.equal(rows[0]?.priceId, "pro");
    assert.equal(rows[0]?.active, 0);
    assert.equal(rows[0]?.endDate, "2020-01-02T00:00:00.000Z");
    assert.equal(rows[0]?.cancelAt, "2020-01-02T00:00:00.000Z");
    assert.deepEqual(columnNames(cape.db), columnsBefore);
  } finally {
    fs.rmSync(cape.dir, { recursive: true, force: true });
  }

  const http = fresh(starterSql, STARTER_COLUMNS);
  try {
    const run = runCli(["run", "--suite", "tests/fixtures/saas-starter/http-200.yaml", "--schema", http.schema]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(tableRows(http.db).length, 0);
  } finally {
    fs.rmSync(http.dir, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(starter.dir, { recursive: true, force: true });
}

const status = fresh(STATUS_SQL, STATUS_COLUMNS);
try {
  const before = schemaSql(status.db);
  const suite = runCli(["run", "--suite", "tests/entitlements/goldens", "--schema", status.schema], licenseEnv);
  assert.equal(suite.status, 0, suite.stderr);
  passLines(suite.stderr);
  assert.equal(schemaSql(status.db), before);
  assert.deepEqual(columnNames(status.db), ["id", "customerId", "priceId", "status", "startDate", "endDate", "cancelAt"]);

  const trial = fresh(STATUS_SQL, STATUS_COLUMNS);
  try {
    const run = runCli(["run", "--suite", "tests/fixtures/saas-starter/status-trialing.yaml", "--schema", trial.schema]);
    assert.equal(run.status, 0, run.stderr);
    const rows = tableRows(trial.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "trialing");
    assert.equal(rows[0]?.priceId, "pro");
  } finally {
    fs.rmSync(trial.dir, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(status.dir, { recursive: true, force: true });
}

const memory = fresh(starterSql, STARTER_COLUMNS);
try {
  const first = await createMappedAdapter(memory.schema);
  await first.apply({
    id: "evt_seats",
    type: "invoice.paid",
    customerId: "cus_seats",
    plan: "pro",
    seats: 10,
    features: ["export"],
  });
  const stored = await first.snapshot("cus_seats");
  assert.equal(stored.locked, false);
  assert.equal(stored.plan, "pro");
  assert.equal(stored.seats, 10);
  assert.deepEqual(stored.features, ["export"]);
  const second = await createMappedAdapter(memory.schema);
  const reread = await second.snapshot("cus_seats");
  assert.equal(reread.locked, false);
  assert.equal(reread.plan, "pro");
  assert.equal(reread.seats, undefined);
  assert.equal(reread.features, undefined);
  assert.deepEqual(columnNames(memory.db), ["id", "customerId", "priceId", "active", "startDate", "endDate", "cancelAt"]);

  const replay = fresh(starterSql, STARTER_COLUMNS);
  try {
    const local = await createMappedAdapter(replay.schema);
    const paid = { id: "evt_paid", type: "invoice.paid", customerId: "cus_re", plan: "pro" } as const;
    await local.apply(paid);
    await local.apply({ id: "evt_cancel", type: "customer.subscription.deleted", customerId: "cus_re", canceled: true });
    await local.apply(paid);
    assert.equal((await local.snapshot("cus_re")).locked, true);
    const again = await createMappedAdapter(replay.schema);
    await again.apply(paid);
    assert.equal((await again.snapshot("cus_re")).locked, false);
  } finally {
    fs.rmSync(replay.dir, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(memory.dir, { recursive: true, force: true });
}

const dedupeSql = `${starterSql}\nCREATE TABLE seen_events (event_id TEXT PRIMARY KEY);\n`;
const dedupe = fresh(dedupeSql, STARTER_COLUMNS, { table: "seen_events", eventId: "event_id" });
try {
  const before = schemaSql(dedupe.db);
  const run = runCli(["run", "--suite", "duplicate_webhook_idempotent", "--schema", dedupe.schema]);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /event dedupe is not mapped/);
  assert.equal(schemaSql(dedupe.db), before);
  const kept = await createMappedAdapter(dedupe.schema);
  await kept.apply({ id: "evt_s6_invoice_paid", type: "invoice.paid", customerId: "cus_s6", plan: "pro" });
  assert.equal((await kept.snapshot("cus_s6")).locked, true);
} finally {
  fs.rmSync(dedupe.dir, { recursive: true, force: true });
}

const missingDedupe = fresh(starterSql, STARTER_COLUMNS, { table: "seen_events", eventId: "event_id" });
try {
  const before = schemaSql(missingDedupe.db);
  const run = runCli(["run", "--suite", "paid_grants_access", "--schema", missingDedupe.schema]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /event dedupe table "seen_events" is not in the database/);
  assertNoStack(run.stderr);
  assert.equal(schemaSql(missingDedupe.db), before);
  const db = new Database(missingDedupe.db, { readonly: true, fileMustExist: true });
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    assert.deepEqual(names.map((row) => row.name), ["Subscription"]);
  } finally {
    db.close();
  }
} finally {
  fs.rmSync(missingDedupe.dir, { recursive: true, force: true });
}

const disagreeSql = `
CREATE TABLE Subscription (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  priceId TEXT NOT NULL,
  active INTEGER NOT NULL,
  status TEXT NOT NULL
);
`;
const disagree = fresh(disagreeSql, {
  id: "id",
  customerId: "customerId",
  plan: "priceId",
  active: "active",
  status: "status",
});
try {
  const db = new Database(disagree.db);
  try {
    db.prepare("INSERT INTO Subscription (id, customerId, priceId, active, status) VALUES (?, ?, ?, ?, ?)").run(
      "cus_d",
      "cus_d",
      "pro",
      1,
      "past_due",
    );
  } finally {
    db.close();
  }
  const adapter = await createMappedAdapter(disagree.schema);
  assert.equal((await adapter.snapshot("cus_d")).locked, true);
  assert.equal((await adapter.snapshot("cus_d")).plan, "pro");
  assert.equal((await adapter.snapshot("missing")).locked, true);
  const edit = new Database(disagree.db);
  try {
    edit.prepare("UPDATE Subscription SET status = ? WHERE customerId = ?").run("active", "cus_d");
  } finally {
    edit.close();
  }
  assert.equal((await adapter.snapshot("cus_d")).locked, false);
  const lock = new Database(disagree.db);
  try {
    lock.prepare("UPDATE Subscription SET active = 0 WHERE customerId = ?").run("cus_d");
  } finally {
    lock.close();
  }
  assert.equal((await adapter.snapshot("cus_d")).locked, true);
} finally {
  fs.rmSync(disagree.dir, { recursive: true, force: true });
}

const many = fresh(starterSql, STARTER_COLUMNS);
try {
  const db = new Database(many.db);
  try {
    const insert = db.prepare(
      "INSERT INTO Subscription (id, customerId, priceId, active, startDate, endDate, cancelAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run("old", "cus_m", "starter", 0, "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", null);
    insert.run("new", "cus_m", "old", 0, "2020-01-01T00:00:00.000Z", "2020-06-01T00:00:00.000Z", null);
  } finally {
    db.close();
  }
  const adapter = await createMappedAdapter(many.schema);
  await adapter.apply({ id: "evt_many_paid", type: "invoice.paid", customerId: "cus_m", plan: "pro" });
  const afterGrant = tableRows(many.db);
  const oldRow = afterGrant.find((row) => row.id === "old");
  const newRow = afterGrant.find((row) => row.id === "new");
  assert.equal(oldRow?.active, 0);
  assert.equal(oldRow?.priceId, "starter");
  assert.equal(newRow?.active, 1);
  assert.equal(newRow?.priceId, "pro");
  assert.equal((await adapter.snapshot("cus_m")).locked, false);
  assert.equal((await adapter.snapshot("cus_m")).plan, "pro");
  await adapter.apply({
    id: "evt_many_cancel",
    type: "customer.subscription.deleted",
    customerId: "cus_m",
    canceled: true,
  });
  const afterRevoke = tableRows(many.db);
  assert.equal(afterRevoke.every((row) => row.active === 0), true);
  assert.equal((await adapter.snapshot("cus_m")).locked, true);
} finally {
  fs.rmSync(many.dir, { recursive: true, force: true });
}

for (const rel of [
  "docs/bring-your-own-schema.md",
  "docs/onboarding.md",
  "site/src/content/docs/bring-your-own-schema.md",
  "site/src/content/docs/onboarding.md",
]) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  assert.ok(text.includes(EVENT_DEDUPE_FINDING), `${rel} missing dedupe finding`);
  assert.ok(text.includes("S1–S12"), `${rel} missing the free suite`);
  assert.ok(text.includes("17 goldens"), `${rel} missing the golden count`);
}

console.log("bring-your-own-schema: PASS");

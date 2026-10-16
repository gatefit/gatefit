import { createRequire } from "node:module";
import type { AccessAdapter, AccessSnapshot, BillingEvent } from "../access-adapter.ts";
import { nextSnapshot } from "../access-rules.ts";

const require = createRequire(import.meta.url);

function sqliteUnavailable(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(
      [
        "gatefit: SQLite adapter cannot load better-sqlite3.",
        "What is missing: the better-sqlite3 native module.",
        "Why: better-sqlite3 is optional. Its package ships prebuilds for linux, darwin, and win32 (x64 and arm64) and does not compile during npm install. This process has no usable prebuild.",
        "How to fix: reinstall so the prebuild is unpacked (npm install better-sqlite3, or reinstall gatefit). npm rebuild better-sqlite3 does not compile it. On a platform without a prebuild, install make and a C++ compiler (Xcode Command Line Tools on macOS, or build-essential on Linux), then in the better-sqlite3 directory run npm run build-release.",
        "--version, --help, and adapter-check do not need this module.",
        `Detail: ${detail}`,
      ].join("\n"),
  );
}

function loadDatabase(): typeof import("better-sqlite3") {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const probe = new Database(":memory:");
    probe.close();
    return Database;
  } catch (err) {
    throw sqliteUnavailable(err);
  }
}

type AccessRow = {
  customer_id: string;
  locked: number;
  plan: string | null;
  seats: number | null;
  features: string | null;
};

function rowToSnapshot(row: AccessRow | undefined): AccessSnapshot {
  if (!row) return { locked: true };
  const snap: AccessSnapshot = { locked: row.locked === 1 };
  if (row.plan != null) snap.plan = row.plan;
  if (row.seats != null) snap.seats = row.seats;
  if (row.features != null) snap.features = JSON.parse(row.features) as string[];
  return snap;
}

export function createAdapter(): AccessAdapter {
  const filename = process.env.GATEFIT_SQLITE_PATH ?? ":memory:";
  const Database = loadDatabase();
  const db = new Database(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS access (
      customer_id TEXT PRIMARY KEY,
      locked INTEGER NOT NULL,
      plan TEXT,
      seats INTEGER,
      features TEXT
    );
    CREATE TABLE IF NOT EXISTS seen_events (
      event_id TEXT PRIMARY KEY
    );
  `);
  const seenAdd = db.prepare("INSERT OR IGNORE INTO seen_events (event_id) VALUES (?)");
  const accessGet = db.prepare(
    "SELECT customer_id, locked, plan, seats, features FROM access WHERE customer_id = ?",
  );
  const accessUpsert = db.prepare(`
    INSERT INTO access (customer_id, locked, plan, seats, features)
    VALUES (@customer_id, @locked, @plan, @seats, @features)
    ON CONFLICT(customer_id) DO UPDATE SET
      locked = excluded.locked,
      plan = excluded.plan,
      seats = excluded.seats,
      features = excluded.features
  `);
  const clearAccess = db.prepare("DELETE FROM access");
  const clearSeen = db.prepare("DELETE FROM seen_events");
  const applyEvent = db.transaction((event: BillingEvent) => {
    const inserted = seenAdd.run(event.id);
    if (inserted.changes === 0) return;
    const current = rowToSnapshot(accessGet.get(event.customerId) as AccessRow | undefined);
    const next = nextSnapshot(current, event);
    accessUpsert.run({
      customer_id: event.customerId,
      locked: next.locked ? 1 : 0,
      plan: next.plan ?? null,
      seats: next.seats ?? null,
      features: next.features ? JSON.stringify(next.features) : null,
    });
  });

  return {
    apply(event: BillingEvent) {
      applyEvent(event);
    },
    snapshot(customerId: string) {
      return rowToSnapshot(accessGet.get(customerId) as AccessRow | undefined);
    },
    reset() {
      clearAccess.run();
      clearSeen.run();
    },
  };
}

export default createAdapter;

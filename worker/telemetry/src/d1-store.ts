/**
 * D1 adapters for the collector (GATEFIT-H25 counts) and status checks (GATEFIT-H30).
 * Minimal local D1 types keep this free of new dependencies; the tests run it against
 * node:sqlite through a small shim.
 */
import type { CountRow, Stats, TelemetryStore } from "./handler.ts";
import { rollupWindow, type Check, type DayAgg, type StatusStore } from "./status.ts";

export interface D1Result<T> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

const COLUMNS = [
  "day",
  "kind",
  "command",
  "version",
  "node",
  "platform",
  "arch",
  "outcome",
  "template",
  "pack",
  "suite",
  "event",
] as const satisfies readonly (keyof CountRow)[];

export function d1Store(db: D1Database): TelemetryStore {
  return {
    async increment(row) {
      await db
        .prepare(
          `INSERT INTO counts (${COLUMNS.join(",")}, n) VALUES (${COLUMNS.map(() => "?").join(",")}, 1)
           ON CONFLICT (${COLUMNS.join(",")}) DO UPDATE SET n = n + 1`,
        )
        .bind(...COLUMNS.map((c) => row[c]))
        .run();
    },
    async addInstall(day, hash) {
      await db.prepare("INSERT OR IGNORE INTO installs (day, install_hash) VALUES (?, ?)").bind(day, hash).run();
    },
    async stats(sinceDay) {
      const counts = await db
        .prepare(`SELECT ${COLUMNS.join(",")}, n FROM counts WHERE day >= ? ORDER BY day, kind`)
        .bind(sinceDay)
        .all<Stats["counts"][number]>();
      const installs = await db
        .prepare('SELECT day, COUNT(*) AS "distinct" FROM installs WHERE day >= ? GROUP BY day ORDER BY day')
        .bind(sinceDay)
        .all<Stats["installs"][number]>();
      return { counts: counts.results, installs: installs.results };
    },
  };
}

// "no version" Action rows (npm failed, so no tag to check) never count toward uptime.
const AGGREGATE = `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, service,
  COUNT(*) AS total, SUM(ok) AS up, SUM(ok = 1 AND latency_ms > 3000) AS slow
  FROM checks WHERE ts >= ? AND ts < ? AND detail != 'no version' GROUP BY 1, 2`;

export function d1StatusStore(db: D1Database): StatusStore {
  return {
    async record(rows: Check[]) {
      if (!rows.length) return;
      await db.batch(
        rows.map((r) =>
          db
            .prepare("INSERT OR REPLACE INTO checks (ts, service, ok, latency_ms, detail) VALUES (?, ?, ?, ?, ?)")
            .bind(r.ts, r.service, r.ok, r.latency_ms, r.detail),
        ),
      );
    },
    async latest() {
      const res = await db
        .prepare(
          `SELECT c.ts, c.service, c.ok, c.latency_ms, c.detail FROM checks c
           JOIN (SELECT service, MAX(ts) AS ts FROM checks GROUP BY service) m
           ON c.service = m.service AND c.ts = m.ts`,
        )
        .all<Check>();
      return res.results;
    },
    async days(sinceDay: string) {
      const res = await db
        .prepare("SELECT day, service, total, up, slow FROM check_days WHERE day >= ?")
        .bind(sinceDay)
        .all<DayAgg>();
      return res.results;
    },
    async liveDays(sinceTs: number) {
      const res = await db.prepare(AGGREGATE).bind(sinceTs, Number.MAX_SAFE_INTEGER).all<DayAgg>();
      return res.results;
    },
    // One batch, so it applies fully or not at all. It recomputes finished days from raw
    // rows (idempotent), never today, and only days whose raw rows are all still kept.
    async rollup(now: Date) {
      const w = rollupWindow(now);
      await db.batch([
        db
          .prepare(`INSERT OR REPLACE INTO check_days (day, service, total, up, slow) ${AGGREGATE}`)
          .bind(w.from, w.to),
        db.prepare("DELETE FROM checks WHERE ts < ?").bind(w.from),
        db.prepare("DELETE FROM check_days WHERE day < ?").bind(w.dayCutoff),
      ]);
    },
  };
}

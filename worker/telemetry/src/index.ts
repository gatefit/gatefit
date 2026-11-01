/**
 * Cloudflare Worker entry for the GATEFIT-H25 collector. Thin D1 adapter around the
 * pure handler. Minimal local D1 types keep this free of new dependencies; the repo
 * tests never import this file.
 */
import { handleRequest, type CountRow, type Stats, type TelemetryStore } from "./handler.ts";

interface D1Result<T> {
  results: T[];
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
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

function d1Store(db: D1Database): TelemetryStore {
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

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, d1Store(env.DB));
  },
};

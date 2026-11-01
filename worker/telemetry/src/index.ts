// Cloudflare entry: wires the pure handler to D1. Never imported by repo tests.
import { handleRequest, type CountRow, type Stats, type TelemetryStore } from "./handler.ts";

// Minimal local D1 surface, so the Worker adds no dependency to the repo.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

type Env = { DB: D1Database };

const COUNT_COLUMNS = [
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
          `INSERT INTO counts (${COUNT_COLUMNS.join(", ")}, n) VALUES (${COUNT_COLUMNS.map(() => "?").join(", ")}, 1)
           ON CONFLICT (${COUNT_COLUMNS.join(", ")}) DO UPDATE SET n = n + 1`,
        )
        .bind(...COUNT_COLUMNS.map((c) => row[c]))
        .run();
    },
    async addInstall(day, hash) {
      await db.prepare("INSERT OR IGNORE INTO installs (day, install_hash) VALUES (?, ?)").bind(day, hash).run();
    },
    async stats(sinceDay) {
      const counts = await db
        .prepare(`SELECT ${COUNT_COLUMNS.join(", ")}, n FROM counts WHERE day >= ? ORDER BY day, kind`)
        .bind(sinceDay)
        .all<Stats["counts"][number]>();
      const installs = await db
        .prepare("SELECT day, COUNT(*) AS distinct_installs FROM installs WHERE day >= ? GROUP BY day ORDER BY day")
        .bind(sinceDay)
        .all<{ day: string; distinct_installs: number }>();
      return {
        counts: counts.results,
        installs: installs.results.map((r) => ({ day: r.day, distinct: r.distinct_installs })),
      };
    },
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(req, d1Store(env.DB), new Date());
    } catch {
      return new Response(null, { status: 500 });
    }
  },
};

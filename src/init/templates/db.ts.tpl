// Postgres access for the Gatefit adapter ({{TEMPLATE}} template).
// {{DB_NOTE}}
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

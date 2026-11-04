// GATEFIT-H30 status probes, rollup, and /v1/status fail modes. Pure status.ts with a fake
// fetch, plus d1-store.ts over node:sqlite through a small D1 shim running both migrations.
// The Cloudflare entry (worker/telemetry/src/index.ts) is never imported here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { handleRequest, type TelemetryStore } from "../../worker/telemetry/src/handler.ts";
import {
  DAYS,
  POLAR_CHECKOUT_URL,
  SERVICES,
  buildStatus,
  dayState,
  probePolarNow,
  runChecks,
  sampleState,
  type Check,
  type ProbeDeps,
} from "../../worker/telemetry/src/status.ts";
import { d1Store, d1StatusStore, type D1Database, type D1PreparedStatement } from "../../worker/telemetry/src/d1-store.ts";
import { DEFAULT_POLAR_CHECKOUT_URL } from "../../site/src/lib/polarCheckout.ts";

const root = path.join(import.meta.dirname, "../..");
const NOW = new Date("2026-11-03T12:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
const TODAY0 = Date.parse("2026-11-03T00:00:00Z");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
};

let DatabaseSync: (new (file: string) => Sqlite) | undefined;
try {
  ({ DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (file: string) => Sqlite });
} catch {
  DatabaseSync = undefined;
}
const noSqlite = DatabaseSync ? false : "node:sqlite is not available in this Node";

class ShimStmt implements D1PreparedStatement {
  constructor(
    readonly db: Sqlite,
    readonly sql: string,
    readonly args: unknown[] = [],
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new ShimStmt(this.db, this.sql, values);
  }
  runSync(): void {
    this.db.prepare(this.sql).run(...this.args);
  }
  async run(): Promise<unknown> {
    this.runSync();
    return { success: true };
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...(r as object) })) as T[] };
  }
}

// D1 batch runs as one transaction: all statements apply or none do.
class ShimD1 implements D1Database {
  constructor(readonly db: Sqlite) {}
  prepare(sql: string): D1PreparedStatement {
    return new ShimStmt(this.db, sql);
  }
  async batch(stmts: D1PreparedStatement[]): Promise<unknown[]> {
    this.db.exec("BEGIN");
    try {
      for (const s of stmts) (s as ShimStmt).runSync();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return stmts.map(() => ({ success: true }));
  }
}

function freshDb(): { sql: Sqlite; d1: ShimD1 } {
  const sql = new DatabaseSync!(":memory:");
  for (const f of ["0001_init.sql", "0002_checks.sql"]) sql.exec(read(`worker/telemetry/migrations/${f}`));
  return { sql, d1: new ShimD1(sql) };
}

function check(service: Check["service"], ts: number, ok: 0 | 1 = 1, latency_ms = 120, detail = ""): Check {
  return { ts, service, ok, latency_ms, detail };
}

type Route = (req: Request) => Promise<Response> | Response;

function fakeFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const route = routes[`${req.method} ${req.url}`] ?? routes[req.url];
    if (!route) return new Response("nope", { status: 404 });
    return route(req);
  }) as typeof fetch;
}

const NPM = "https://registry.npmjs.org/gatefit/latest";
const SITE = "https://gatefit.io/";
const ACTION = (v: string) => `https://raw.githubusercontent.com/gatefit/gatefit/v${v}/action.yml`;

function healthyRoutes(): Record<string, Route> {
  return {
    [SITE]: () => new Response("<title>Gatefit</title>", { status: 200 }),
    [NPM]: () => Response.json({ name: "gatefit", version: "0.6.0" }),
    [ACTION("0.6.0")]: () => new Response("runs:\n  using: composite\n", { status: 200 }),
    [`HEAD ${POLAR_CHECKOUT_URL}`]: () => new Response(null, { status: 200 }),
  };
}

function deps(routes: Record<string, Route>, extra: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    fetch: fakeFetch(routes),
    selfCheck: async () => Response.json({ counts: [], installs: [] }),
    clock: () => NOW.getTime(),
    timeoutMs: 50,
    ...extra,
  };
}

function byService(rows: Check[]): Record<string, Check> {
  return Object.fromEntries(rows.map((r) => [r.service, r]));
}

class MemoryReader {
  constructor(
    public latestRows: Check[] = [],
    public dayRows: { day: string; service: string; total: number; up: number; slow: number }[] = [],
    public liveRows: { day: string; service: string; total: number; up: number; slow: number }[] = [],
  ) {}
  async latest() {
    return this.latestRows;
  }
  async days() {
    return this.dayRows;
  }
  async liveDays() {
    return this.liveRows;
  }
}

const noStore: TelemetryStore = {
  async increment() {},
  async addInstall() {},
  async stats() {
    return { counts: [], installs: [] };
  },
};

test("healthy probes record ok rows with the npm version on npm and action", async () => {
  const rows = byService(await runChecks(deps(healthyRoutes()), { polar: true }));
  assert.deepEqual(Object.keys(rows).sort(), [...SERVICES].sort());
  for (const s of SERVICES) assert.equal(rows[s]!.ok, 1, s);
  assert.equal(rows.npm!.detail, "0.6.0");
  assert.equal(rows.action!.detail, "0.6.0");
  assert.equal(POLAR_CHECKOUT_URL, DEFAULT_POLAR_CHECKOUT_URL, "worker probes the committed Checkout Link");
});

test("probe_timeout_records_down_not_ok", async () => {
  const routes = healthyRoutes();
  routes[SITE] = (req) =>
    new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(req.signal.reason)));
  const hang = () => new Promise<Response>(() => {});
  const rows = byService(await runChecks(deps(routes, { selfCheck: hang }), { polar: false }));
  assert.equal(rows.site!.ok, 0);
  assert.equal(rows.site!.detail, "timeout");
  assert.equal(rows.telemetry!.ok, 0);
  assert.equal(rows.telemetry!.detail, "timeout");
  assert.equal(sampleState(rows.site!), "down");
});

test("non-200 and wrong bodies are down with a short detail code, never the body", async () => {
  const routes = healthyRoutes();
  routes[SITE] = () => new Response("Gatefit maintenance", { status: 503 });
  routes[`HEAD ${POLAR_CHECKOUT_URL}`] = () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
  const rows = byService(await runChecks(deps(routes), { polar: true }));
  assert.deepEqual([rows.site!.ok, rows.site!.detail], [0, "http 503"]);
  assert.equal(rows.polar!.ok, 0, "redirect off polar.sh is down");
  const ok = healthyRoutes();
  ok[SITE] = () => new Response("<title>Something else</title>");
  ok[`HEAD ${POLAR_CHECKOUT_URL}`] = () => new Response(null, { status: 303, headers: { location: "https://polar.sh/checkout/x" } });
  const again = byService(await runChecks(deps(ok), { polar: true }));
  assert.deepEqual([again.site!.ok, again.site!.detail], [0, "bad body"]);
  assert.equal(again.polar!.ok, 1, "redirect onto polar.sh is ok");
  for (const r of [...Object.values(rows), ...Object.values(again)]) assert.ok(r.detail.length <= 64);
});

test("polar HEAD 405 falls back to GET without following redirects", async () => {
  const routes = healthyRoutes();
  let mode: RequestRedirect | undefined;
  routes[`HEAD ${POLAR_CHECKOUT_URL}`] = () => new Response(null, { status: 405 });
  routes[`GET ${POLAR_CHECKOUT_URL}`] = (req) => {
    mode = req.redirect;
    return new Response("checkout", { status: 200 });
  };
  const rows = byService(await runChecks(deps(routes), { polar: true }));
  assert.equal(rows.polar!.ok, 1);
  assert.equal(mode, "manual");
});

test("polar is probed only on the :00 and :30 runs", async () => {
  assert.equal(probePolarNow(Date.parse("2026-11-03T12:00:00Z")), true);
  assert.equal(probePolarNow(Date.parse("2026-11-03T12:30:00Z")), true);
  assert.equal(probePolarNow(Date.parse("2026-11-03T12:05:00Z")), false);
  assert.equal(probePolarNow(Date.parse("2026-11-03T12:35:00Z")), false);
  let hits = 0;
  const routes = healthyRoutes();
  routes[`HEAD ${POLAR_CHECKOUT_URL}`] = () => {
    hits++;
    return new Response(null, { status: 200 });
  };
  const rows = await runChecks(deps(routes), { polar: false });
  assert.equal(hits, 0);
  assert.ok(!rows.some((r) => r.service === "polar"));
});

test("npm_bad_json_is_down_with_detail", async () => {
  for (const [body, detail] of [
    ["{nope", "bad body"],
    [JSON.stringify({ version: "latest; rm" }), "bad body"],
    [JSON.stringify([1]), "bad body"],
  ] as const) {
    const routes = healthyRoutes();
    routes[NPM] = () => new Response(body, { status: 200 });
    const rows = byService(await runChecks(deps(routes), { polar: false }));
    assert.deepEqual([rows.npm!.ok, rows.npm!.detail], [0, detail], body);
  }
});

test("action_unknown_when_npm_version_missing", async () => {
  const routes = healthyRoutes();
  routes[NPM] = () => new Response("down", { status: 500 });
  const rows = byService(await runChecks(deps(routes), { polar: false }));
  assert.deepEqual([rows.action!.ok, rows.action!.detail], [0, "no version"]);
  const status = await buildStatus(new MemoryReader([rows.action!, rows.npm!]), NOW);
  const svc = Object.fromEntries(status.services.map((s) => [s.id, s]));
  assert.equal(svc.action!.state, "unknown");
  assert.equal(svc.npm!.state, "down");
  assert.equal(svc.action!.version, undefined);
});

test("action tag missing for the npm version is down, not unknown", async () => {
  const routes = healthyRoutes();
  routes[NPM] = () => Response.json({ version: "0.7.0" });
  const rows = byService(await runChecks(deps(routes), { polar: false }));
  assert.deepEqual([rows.action!.ok, rows.action!.detail], [0, "http 404"]);
});

test("stale_latest_check_reports_unknown", async () => {
  const fresh = NOW.getTime() - 4 * MIN;
  const old = NOW.getTime() - 16 * MIN;
  const status = await buildStatus(
    new MemoryReader([
      check("site", old),
      check("npm", fresh, 1, 100, "0.6.0"),
      check("telemetry", fresh),
      check("action", fresh, 1, 100, "0.6.0"),
      check("polar", NOW.getTime() - 40 * MIN),
    ]),
    NOW,
  );
  const svc = Object.fromEntries(status.services.map((s) => [s.id, s]));
  assert.equal(svc.site!.state, "unknown", "16 min old is stale");
  assert.equal(svc.npm!.state, "ok");
  assert.equal(svc.npm!.version, "0.6.0");
  assert.equal(svc.action!.version, "0.6.0");
  assert.equal(svc.polar!.state, "ok", "polar runs every 30 min, stale only after 45");
  const stalePolar = await buildStatus(new MemoryReader([check("polar", NOW.getTime() - 46 * MIN)]), NOW);
  assert.equal(stalePolar.services.find((s) => s.id === "polar")!.state, "unknown");
  assert.equal(status.checked_at, new Date(fresh).toISOString());
});

test("future_checked_at_beyond_5_min_is_not_fresh", async () => {
  const at = async (service: Check["service"], ts: number) =>
    (await buildStatus(new MemoryReader([check(service, ts)]), NOW)).services.find((s) => s.id === service)!.state;
  const t = NOW.getTime();
  assert.equal(await at("site", t + 5 * MIN), "ok", "now+5:00 is within the skew tolerance");
  assert.equal(await at("site", t + 5 * MIN + 1), "unknown", "now+5:00.001 is in the future, not fresh");
  assert.equal(await at("site", t + 5 * MIN + 1000), "unknown", "now+5:01 is not fresh");
  assert.equal(await at("site", t + 10 * MIN), "unknown", "now+10 min is never ok");
  assert.equal(await at("polar", t + 10 * MIN), "unknown", "polar's longer window does not cover the future");
});

test("no_rows_reports_unknown_and_null_checked_at", async () => {
  const status = await buildStatus(new MemoryReader(), NOW);
  assert.equal(status.checked_at, null);
  assert.deepEqual(status.services.map((s) => s.id), [...SERVICES]);
  for (const s of status.services) {
    assert.equal(s.state, "unknown");
    assert.equal(s.days.length, DAYS);
    assert.ok(s.days.every((d) => d.state === "none" && d.up_pct === null));
  }
});

test("slow_ok_is_degraded", () => {
  assert.equal(sampleState(check("site", 0, 1, 3001)), "deg");
  assert.equal(sampleState(check("site", 0, 1, 3000)), "ok");
  assert.equal(sampleState(check("site", 0, 0, 10)), "down");
  assert.deepEqual(dayState({ total: 100, up: 100, slow: 0 }), { up_pct: 100, state: "ok" });
  assert.deepEqual(dayState({ total: 100, up: 99, slow: 0 }), { up_pct: 99, state: "ok" });
  assert.deepEqual(dayState({ total: 100, up: 100, slow: 11 }), { up_pct: 100, state: "deg" }, ">10% slow");
  assert.deepEqual(dayState({ total: 100, up: 100, slow: 10 }), { up_pct: 100, state: "ok" });
  assert.deepEqual(dayState({ total: 100, up: 95, slow: 0 }), { up_pct: 95, state: "deg" });
  assert.deepEqual(dayState({ total: 100, up: 94, slow: 0 }), { up_pct: 94, state: "down" });
  assert.deepEqual(dayState({ total: 3, up: 2, slow: 0 }), { up_pct: 66.67, state: "down" });
  assert.deepEqual(dayState({ total: 0, up: 0, slow: 0 }), { up_pct: null, state: "none" });
});

test("status_has_90_days_oldest_first_none_for_gaps", async () => {
  const status = await buildStatus(
    new MemoryReader(
      [check("site", NOW.getTime() - MIN)],
      [
        { day: "2026-08-06", service: "site", total: 288, up: 288, slow: 0 },
        { day: "2026-10-01", service: "site", total: 288, up: 200, slow: 0 },
        { day: "2026-11-02", service: "site", total: 288, up: 288, slow: 0 },
      ],
      [{ day: "2026-11-02", service: "site", total: 10, up: 5, slow: 0 }],
    ),
    NOW,
  );
  const site = status.services.find((s) => s.id === "site")!;
  assert.equal(site.days.length, 90);
  assert.equal(site.days[0]!.day, "2026-08-06");
  assert.equal(site.days[89]!.day, "2026-11-03");
  assert.deepEqual(site.days[0], { day: "2026-08-06", up_pct: 100, state: "ok" });
  assert.equal(site.days.find((d) => d.day === "2026-10-01")!.state, "down");
  assert.equal(site.days.find((d) => d.day === "2026-10-02")!.state, "none");
  assert.deepEqual(site.days[88], { day: "2026-11-02", up_pct: 50, state: "down" }, "raw wins over rolled-up");
  assert.equal(site.days[89]!.state, "none");
  const sorted = [...site.days].map((d) => d.day).sort();
  assert.deepEqual(site.days.map((d) => d.day), sorted);
});

test("status_and_stats_send_cors_gatefit_io_and_vary_origin", async () => {
  const reader = new MemoryReader();
  for (const url of ["https://t.gatefit.io/v1/status", "https://t.gatefit.io/v1/stats?days=7"]) {
    const res = await handleRequest(new Request(url, { headers: { origin: "https://evil.example" } }), noStore, NOW, reader);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://gatefit.io", url);
    assert.match(res.headers.get("vary") ?? "", /Origin/, url);
    assert.equal(res.headers.get("content-type"), "application/json", url);
  }
  const pre = await handleRequest(new Request("https://t.gatefit.io/v1/status", { method: "OPTIONS" }), noStore, NOW, reader);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://gatefit.io");
});

test("event_still_has_no_cors", async () => {
  const res = await handleRequest(new Request("https://t.gatefit.io/v1/event", { method: "POST", body: "{}" }), noStore, NOW, new MemoryReader());
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("status_cache_control_public_max_age_60", async () => {
  for (const url of ["https://t.gatefit.io/v1/status", "https://t.gatefit.io/v1/stats"]) {
    const res = await handleRequest(new Request(url), noStore, NOW, new MemoryReader());
    assert.equal(res.headers.get("cache-control"), "public, max-age=60", url);
  }
});

test("status_head_has_get_headers_and_no_body", async () => {
  const res = await handleRequest(new Request("https://t.gatefit.io/v1/status", { method: "HEAD" }), noStore, NOW, new MemoryReader());
  assert.equal(res.status, 200);
  assert.equal(res.body, null);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("cache-control"), "public, max-age=60");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://gatefit.io");
  assert.match(res.headers.get("vary") ?? "", /Origin/);
});

test("probes cancel unread bodies on non-200 and on the Polar HEAD", async () => {
  const cancelled: string[] = [];
  const tracked = (name: string, status: number) =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new TextEncoder().encode("x"));
        },
        cancel() {
          cancelled.push(name);
        },
      }),
      { status },
    );
  const routes = healthyRoutes();
  routes[SITE] = () => tracked("site", 503);
  routes[NPM] = () => Response.json({ version: "0.7.0" });
  routes[ACTION("0.7.0")] = () => tracked("action", 404);
  routes[`HEAD ${POLAR_CHECKOUT_URL}`] = () => tracked("polar-head", 200);
  await runChecks(deps(routes), { polar: true });
  const npmDown = healthyRoutes();
  npmDown[NPM] = () => tracked("npm", 500);
  npmDown[`HEAD ${POLAR_CHECKOUT_URL}`] = () => tracked("polar-head-405", 405);
  npmDown[`GET ${POLAR_CHECKOUT_URL}`] = () => tracked("polar-get", 200);
  await runChecks(deps(npmDown), { polar: true });
  assert.deepEqual(cancelled.sort(), ["action", "npm", "polar-get", "polar-head", "polar-head-405", "site"]);
});

test("d1 latest() reads one indexed row per service, not a table scan", () => {
  const src = read("worker/telemetry/src/d1-store.ts");
  assert.doesNotMatch(src, /MAX\(ts\)/);
  assert.match(src, /ORDER BY ts DESC LIMIT 1/);
});

test("status_rejects_post_405", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await handleRequest(new Request("https://t.gatefit.io/v1/status", { method }), noStore, NOW, new MemoryReader());
    assert.equal(res.status, 405, method);
  }
  const unwired = await handleRequest(new Request("https://t.gatefit.io/v1/status"), noStore, NOW);
  assert.equal(unwired.status, 404, "no status store wired");
});

test("status body carries no detail strings, latency, or ids", async () => {
  const status = await buildStatus(new MemoryReader([check("site", NOW.getTime() - MIN, 0, 77, "http 503")]), NOW);
  const text = JSON.stringify(status);
  assert.doesNotMatch(text, /http 503|latency|"ts"/);
  assert.deepEqual(Object.keys(status).sort(), ["checked_at", "services"]);
});

test("d1 status store records, reads latest per service, and live-aggregates today", { skip: noSqlite }, async () => {
  const { d1 } = freshDb();
  const store = d1StatusStore(d1);
  const t = NOW.getTime();
  await store.record([check("site", t - 10 * MIN), check("npm", t - 10 * MIN, 1, 100, "0.6.0")]);
  await store.record([check("site", t - 5 * MIN, 0, 5000, "timeout"), check("npm", t - 5 * MIN, 1, 4000, "0.6.0")]);
  await store.record([check("action", t - 5 * MIN, 0, 0, "no version")]);
  const latest = byService(await store.latest());
  assert.equal(latest.site!.detail, "timeout");
  assert.equal(latest.npm!.latency_ms, 4000);
  const live = await store.liveDays(TODAY0 - DAY);
  const site = live.find((r) => r.service === "site")!;
  assert.deepEqual({ ...site }, { day: "2026-11-03", service: "site", total: 2, up: 1, slow: 0 });
  const npm = live.find((r) => r.service === "npm")!;
  assert.equal(npm.slow, 1);
  assert.ok(!live.some((r) => r.service === "action"), "'no version' rows never count toward uptime");
  const status = await buildStatus(store, NOW);
  assert.equal(status.services.find((s) => s.id === "site")!.state, "down");
  assert.equal(status.services.find((s) => s.id === "npm")!.state, "deg");
});

test("rollup_is_idempotent", { skip: noSqlite }, async () => {
  const { sql, d1 } = freshDb();
  const store = d1StatusStore(d1);
  const yday = TODAY0 - DAY;
  await store.record([
    check("site", yday + 60 * MIN),
    check("site", yday + 65 * MIN, 0, 10, "http 500"),
    check("site", yday + 70 * MIN, 1, 4000),
    check("site", TODAY0 - 2 * DAY + MIN),
  ]);
  await store.rollup(NOW);
  const once = sql.prepare("SELECT * FROM check_days ORDER BY day, service").all().map((r) => ({ ...(r as object) }));
  await store.rollup(NOW);
  const twice = sql.prepare("SELECT * FROM check_days ORDER BY day, service").all().map((r) => ({ ...(r as object) }));
  assert.deepEqual(twice, once);
  assert.deepEqual(once, [
    { day: "2026-11-01", service: "site", total: 1, up: 1, slow: 0 },
    { day: "2026-11-02", service: "site", total: 3, up: 2, slow: 1 },
  ]);
});

test("rollup_keeps_raw_from_start_of_utc_day_two_back_48_to_72h_and_90_days", { skip: noSqlite }, async () => {
  const { sql, d1 } = freshDb();
  const store = d1StatusStore(d1);
  // A full day 3 days back was rolled up on an earlier night; its raw rows are past retention.
  sql.exec("INSERT INTO check_days VALUES ('2026-10-31', 'site', 288, 288, 0)");
  sql.exec("INSERT INTO check_days VALUES ('2026-08-05', 'site', 288, 288, 0)");
  sql.exec("INSERT INTO check_days VALUES ('2026-08-06', 'site', 288, 288, 0)");
  await store.record([check("site", Date.parse("2026-10-31T23:55:00Z")), check("site", TODAY0 - 2 * DAY)]);
  await store.rollup(NOW);
  const ts = sql.prepare("SELECT ts FROM checks ORDER BY ts").all().map((r) => (r as { ts: number }).ts);
  assert.deepEqual(ts, [TODAY0 - 2 * DAY], "raw kept from the start of the day before yesterday");
  const days = sql.prepare("SELECT day, total FROM check_days ORDER BY day").all().map((r) => ({ ...(r as object) }));
  assert.deepEqual(days, [
    { day: "2026-08-06", total: 288 },
    { day: "2026-10-31", total: 288 },
    { day: "2026-11-01", total: 1 },
  ], "90-day window kept, and a partly pruned day is never overwritten with partial counts");
});

test("rollup_never_rolls_today", { skip: noSqlite }, async () => {
  const { sql, d1 } = freshDb();
  const store = d1StatusStore(d1);
  await store.record([check("site", TODAY0 + MIN), check("npm", TODAY0 - MIN, 1, 1, "0.6.0")]);
  await store.rollup(NOW);
  const days = sql.prepare("SELECT day, service FROM check_days").all().map((r) => ({ ...(r as object) }));
  assert.deepEqual(days, [{ day: "2026-11-02", service: "npm" }]);
  const raw = sql.prepare("SELECT COUNT(*) AS n FROM checks").all()[0] as { n: number };
  assert.equal(raw.n, 2, "rollup keeps raw rows inside retention");
});

test("rollup is one batch: a failing statement leaves everything as it was", { skip: noSqlite }, async () => {
  const { sql, d1 } = freshDb();
  const store = d1StatusStore(d1);
  await store.record([check("site", TODAY0 - 3 * DAY)]);
  sql.exec("DROP TABLE check_days");
  await assert.rejects(store.rollup(NOW));
  const raw = sql.prepare("SELECT COUNT(*) AS n FROM checks").all()[0] as { n: number };
  assert.equal(raw.n, 1, "prune rolled back");
});

test("d1 telemetry store still serves /v1/stats and the in-process self-check", { skip: noSqlite }, async () => {
  const { d1 } = freshDb();
  const res = await handleRequest(new Request("https://t.gatefit.io/v1/stats?days=1"), d1Store(d1), NOW);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { counts: [], installs: [] });
});

test("migration 0002 shape: CHECK constraints, both primary keys, no ids, IPs, or bodies", () => {
  const sql = read("worker/telemetry/migrations/0002_checks.sql");
  assert.match(sql, /CREATE TABLE checks/);
  assert.match(sql, /CREATE TABLE check_days/);
  assert.match(sql, /service TEXT NOT NULL CHECK \(service IN \('site', ?'npm', ?'telemetry', ?'action', ?'polar'\)\)/);
  assert.match(sql, /ok INTEGER NOT NULL CHECK \(ok IN \(0, ?1\)\)/);
  assert.match(sql, /latency_ms INTEGER NOT NULL CHECK \(latency_ms >= 0\)/);
  assert.match(sql, /CHECK \(length\(detail\) <= 64\)/);
  assert.match(sql, /PRIMARY KEY \(service, ts\)/);
  assert.match(sql, /PRIMARY KEY \(day, service\)/);
  assert.match(sql, /CREATE INDEX checks_ts ON checks \(ts\);/);
  const columns = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(columns, /install_id|\bip\b|body|user_agent|header/i);
  assert.ok(!fs.existsSync(path.join(root, "worker/telemetry/migrations/0003_checks.sql")));
});

test("migration 0002 rejects out-of-range rows", { skip: noSqlite }, () => {
  const { sql } = freshDb();
  assert.throws(() => sql.exec("INSERT INTO checks VALUES (1, 'other', 1, 1, '')"));
  assert.throws(() => sql.exec("INSERT INTO checks VALUES (1, 'site', 2, 1, '')"));
  assert.throws(() => sql.exec("INSERT INTO checks VALUES (1, 'site', 1, -1, '')"));
  assert.throws(() => sql.exec(`INSERT INTO checks VALUES (1, 'site', 1, 1, '${"x".repeat(65)}')`));
});

test("wrangler.toml declares both crons and still has no credentials", () => {
  const toml = read("worker/telemetry/wrangler.toml");
  assert.match(toml, /\[triggers\]\s*\ncrons\s*=\s*\["\*\/5 \* \* \* \*", "15 0 \* \* \*"\]/);
  assert.doesNotMatch(toml, /api_token|secret|password/i);
  const entry = read("worker/telemetry/src/index.ts");
  assert.match(entry, /scheduled\(/);
  assert.match(entry, /"15 0 \* \* \*"/);
  assert.match(entry, /caches\.default/);
});

test("status sources never log, read client IPs, or read user agents", () => {
  for (const f of ["handler.ts", "index.ts", "status.ts", "d1-store.ts"]) {
    const text = read(`worker/telemetry/src/${f}`);
    assert.doesNotMatch(text, /console\./, f);
    assert.doesNotMatch(text, /cf-connecting-ip/i, f);
    assert.doesNotMatch(text, /user-agent/i, f);
    assert.doesNotMatch(text, /x-forwarded-for/i, f);
  }
});

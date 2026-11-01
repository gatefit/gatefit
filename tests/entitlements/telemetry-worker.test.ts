// GATEFIT-H25 collector Worker fail modes. Pure handler against an in-memory store;
// the Cloudflare entry (worker/telemetry/src/index.ts) is never imported here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ALLOWED,
  EVENT_KEYS,
  SITE_ORIGIN,
  handleRequest,
  type CountRow,
  type TelemetryStore,
} from "../../worker/telemetry/src/handler.ts";
import * as cli from "../../src/telemetry.ts";

const root = path.join(import.meta.dirname, "../..");
const NOW = new Date("2026-11-01T12:00:00Z");
const ID = "0b9f3c4e-1d2a-4b5c-8d6e-7f8091a2b3c4";

class MemoryStore implements TelemetryStore {
  counts = new Map<string, CountRow & { n: number }>();
  installs = new Set<string>();
  async increment(row: CountRow): Promise<void> {
    const key = JSON.stringify(row);
    const cur = this.counts.get(key);
    this.counts.set(key, { ...row, n: (cur?.n ?? 0) + 1 });
  }
  async addInstall(day: string, hash: string): Promise<void> {
    this.installs.add(`${day}|${hash}`);
  }
  async stats(sinceDay: string) {
    const counts = [...this.counts.values()].filter((r) => r.day >= sinceDay);
    const perDay = new Map<string, number>();
    for (const k of this.installs) {
      const day = k.split("|")[0]!;
      if (day >= sinceDay) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    return { counts, installs: [...perDay].map(([day, distinct]) => ({ day, distinct })) };
  }
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    install_id: ID,
    version: "0.5.2",
    node: "22",
    platform: "linux",
    arch: "x64",
    command: "run",
    outcome: "pass",
    template: "",
    pack: "",
    suite: "paid_grants_access",
    ...overrides,
  };
}

function post(pathname: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://t.gatefit.io${pathname}`, { method: "POST", body, headers });
}

test("worker allowlists match the CLI payload contract", () => {
  assert.deepEqual([...EVENT_KEYS], [...cli.PAYLOAD_KEYS]);
  assert.deepEqual([...ALLOWED.command], [...cli.COMMANDS]);
  assert.deepEqual([...ALLOWED.outcome], [...cli.OUTCOMES]);
  assert.deepEqual([...ALLOWED.platform], [...cli.PLATFORMS]);
  assert.deepEqual([...ALLOWED.arch], [...cli.ARCHS]);
  assert.deepEqual([...ALLOWED.template], ["", ...cli.TEMPLATES]);
  assert.deepEqual([...ALLOWED.pack], ["", ...cli.PACKS]);
  assert.deepEqual([...ALLOWED.suite], ["", "pack", "custom", ...cli.SUITES]);
});

test("valid event counts once and stores only a day hash of the install id", async () => {
  const store = new MemoryStore();
  const res = await handleRequest(post("/v1/event", JSON.stringify(event())), store, NOW);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS on /v1/event");
  assert.equal(store.counts.size, 1);
  const [row] = [...store.counts.values()];
  assert.equal(row!.n, 1);
  assert.equal(row!.day, "2026-11-01");
  assert.equal(row!.kind, "cli");
  assert.ok(!JSON.stringify(row).includes(ID));
  assert.equal(store.installs.size, 1);
  const [install] = [...store.installs];
  const hash = install!.split("|")[1]!;
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.ok(!ID.replaceAll("-", "").includes(hash));

  const again = await handleRequest(post("/v1/event", JSON.stringify(event({ outcome: "fail" }))), store, NOW);
  assert.equal(again.status, 204);
  assert.equal(store.installs.size, 1, "same id same day is one distinct install");
  assert.equal(store.counts.size, 2);
});

test("event rejects unknown, missing, or bad keys and oversize or non-JSON bodies", async () => {
  const store = new MemoryStore();
  const missing = event();
  delete missing.suite;
  const bad: [string, string][] = [
    ["unknown key", JSON.stringify(event({ repo: "x" }))],
    ["missing key", JSON.stringify(missing)],
    ["bad command", JSON.stringify(event({ command: "deploy" }))],
    ["bad suite path", JSON.stringify(event({ suite: "/home/u/repo" }))],
    ["bad id", JSON.stringify(event({ install_id: "user@example.com" }))],
    ["bad v", JSON.stringify(event({ v: 2 }))],
    ["v as string", JSON.stringify(event({ v: "1" }))],
    ["node not major", JSON.stringify(event({ node: "22.1.0" }))],
    ["bad version", JSON.stringify(event({ version: "0.5.2; drop" }))],
    ["number value", JSON.stringify(event({ node: 22 }))],
    ["array", JSON.stringify([event()])],
    ["non-JSON", "{nope"],
    ["oversize", JSON.stringify(event({ pad: "x".repeat(2000) }))],
  ];
  for (const [label, body] of bad) {
    const res = await handleRequest(post("/v1/event", body), store, NOW);
    assert.equal(res.status, label === "oversize" ? 413 : 400, label);
  }
  assert.equal(store.counts.size, 0);
  assert.equal(store.installs.size, 0);
});

test("wrong methods and paths are refused", async () => {
  const store = new MemoryStore();
  const get = await handleRequest(new Request("https://t.gatefit.io/v1/event"), store, NOW);
  assert.equal(get.status, 405);
  const del = await handleRequest(new Request("https://t.gatefit.io/v1/stats", { method: "DELETE" }), store, NOW);
  assert.equal(del.status, 405);
  const nope = await handleRequest(post("/v1/other", "{}"), store, NOW);
  assert.equal(nope.status, 404);
});

test("site beacon needs the gatefit.io origin and exactly the buy_click body", async () => {
  const store = new MemoryStore();
  const body = '{"event":"buy_click"}';
  const cases: [Record<string, string>, string, number][] = [
    [{}, body, 403],
    [{ origin: "https://evil.example" }, body, 403],
    [{ origin: "https://gatefit-bdu.pages.dev" }, body, 403],
    [{ origin: SITE_ORIGIN }, '{"event":"buy_click","id":"x"}', 400],
    [{ origin: SITE_ORIGIN }, '{"event":"view"}', 400],
    [{ origin: SITE_ORIGIN }, "nope", 400],
    [{ origin: SITE_ORIGIN }, `{"event":"buy_click"}${" ".repeat(80)}`, 413],
  ];
  for (const [headers, b, status] of cases) {
    const res = await handleRequest(post("/v1/site", b, headers), store, NOW);
    assert.equal(res.status, status, `${JSON.stringify(headers)} ${b.slice(0, 40)}`);
  }
  assert.equal(store.counts.size, 0);

  const ok = await handleRequest(post("/v1/site", body, { origin: SITE_ORIGIN, "content-type": "text/plain;charset=UTF-8" }), store, NOW);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), SITE_ORIGIN);
  const [row] = [...store.counts.values()];
  assert.equal(row!.kind, "site");
  assert.equal(row!.event, "buy_click");
  assert.equal(store.installs.size, 0);

  const pre = await handleRequest(
    new Request("https://t.gatefit.io/v1/site", { method: "OPTIONS", headers: { origin: SITE_ORIGIN } }),
    store,
    NOW,
  );
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), SITE_ORIGIN);
});

test("stats returns aggregates without hashes or ids", async () => {
  const store = new MemoryStore();
  await handleRequest(post("/v1/event", JSON.stringify(event())), store, NOW);
  await handleRequest(post("/v1/site", '{"event":"buy_click"}', { origin: SITE_ORIGIN }), store, NOW);
  const res = await handleRequest(new Request("https://t.gatefit.io/v1/stats?days=7"), store, NOW);
  assert.equal(res.status, 200);
  const text = await res.text();
  const parsed = JSON.parse(text) as { counts: unknown[]; installs: { day: string; distinct: number }[] };
  assert.equal(parsed.counts.length, 2);
  assert.deepEqual(parsed.installs, [{ day: "2026-11-01", distinct: 1 }]);
  assert.ok(!text.includes(ID));
  const [install] = [...store.installs];
  assert.ok(!text.includes(install!.split("|")[1]!));
  for (const bad of ["0", "91", "abc", "-1"]) {
    const r = await handleRequest(new Request(`https://t.gatefit.io/v1/stats?days=${bad}`), store, NOW);
    assert.equal(r.status, 400, bad);
  }
  const def = await handleRequest(new Request("https://t.gatefit.io/v1/stats"), store, NOW);
  assert.equal(def.status, 200);
});

test("handler never logs, reads client IPs, or reads user agents", () => {
  const src = fs.readFileSync(path.join(root, "worker/telemetry/src/handler.ts"), "utf8");
  const entry = fs.readFileSync(path.join(root, "worker/telemetry/src/index.ts"), "utf8");
  for (const text of [src, entry]) {
    assert.doesNotMatch(text, /console\./);
    assert.doesNotMatch(text, /cf-connecting-ip/i);
    assert.doesNotMatch(text, /user-agent/i);
    assert.doesNotMatch(text, /x-forwarded-for/i);
  }
});

test("worker ships deploy files and stays out of the npm tarball", () => {
  const toml = fs.readFileSync(path.join(root, "worker/telemetry/wrangler.toml"), "utf8");
  assert.match(toml, /main\s*=\s*"src\/index\.ts"/);
  assert.match(toml, /binding\s*=\s*"DB"/);
  assert.match(toml, /t\.gatefit\.io/);
  assert.match(toml, /custom_domain\s*=\s*true/);
  assert.doesNotMatch(toml, /api_token|secret|password/i);
  const sql = fs.readFileSync(path.join(root, "worker/telemetry/migrations/0001_init.sql"), "utf8");
  assert.match(sql, /CREATE TABLE counts/);
  assert.match(sql, /CREATE TABLE installs/);
  assert.doesNotMatch(sql, /install_id/);
  const readme = fs.readFileSync(path.join(root, "worker/telemetry/README.md"), "utf8");
  assert.match(readme, /d1 create/);
  assert.match(readme, /d1 migrations apply/);
  assert.match(readme, /deploy/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { files: string[] };
  assert.ok(!pkg.files.some((f) => f.startsWith("worker")));
  assert.match(fs.readFileSync(path.join(root, ".npmignore"), "utf8"), /^worker\/$/m);
});

function throwingBody(pathname: string, length: string): Request {
  const body = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("body must not be read when content-length is over the cap");
    },
  });
  return new Request(`https://t.gatefit.io${pathname}`, {
    method: "POST",
    body,
    headers: { "content-length": length, origin: SITE_ORIGIN },
    duplex: "half",
  } as RequestInit);
}

test("oversize content-length is refused with 413 before the body is read", async () => {
  for (const pathname of ["/v1/event", "/v1/site"]) {
    const store = new MemoryStore();
    const req = throwingBody(pathname, "999999");
    assert.equal(req.headers.get("content-length"), "999999", "test request keeps the header");
    const res = await handleRequest(req, store, NOW);
    assert.equal(res.status, 413, pathname);
    assert.equal(req.bodyUsed, false, pathname);
    assert.equal(store.counts.size, 0, pathname);
  }
});

test("a lying small content-length with a large body still returns 413", async () => {
  for (const pathname of ["/v1/event", "/v1/site"]) {
    const store = new MemoryStore();
    const big = new TextEncoder().encode(JSON.stringify(event({ suite: "x".repeat(100_000) })));
    const req = new Request(`https://t.gatefit.io${pathname}`, {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(big);
          controller.close();
        },
      }),
      headers: { "content-length": "10", origin: SITE_ORIGIN },
      duplex: "half",
    } as RequestInit);
    const res = await handleRequest(req, store, NOW);
    assert.equal(res.status, 413, pathname);
    assert.equal(store.counts.size, 0, pathname);
  }
});

// GATEFIT-H25 fail modes for opt-in CLI telemetry, encoded before the implementation.
// Every case runs the real bin against a mock collector on 127.0.0.1.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  ARCHS,
  COMMANDS,
  OUTCOMES,
  PACKS,
  PAYLOAD_KEYS,
  PLATFORMS,
  SUITES,
  TELEMETRY_ENDPOINT,
  TEMPLATES,
  endpoint,
} from "../../src/telemetry.ts";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const HARDENED = "src/adapters/hardened.ts";
const NAIVE = "src/adapters/naive.ts";
const S1 = "paid_grants_access";

type Collector = {
  url: string;
  bodies: string[];
  close: () => Promise<void>;
};

const servers: http.Server[] = [];
after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function collector(mode: "ok" | "500" | "hang" = "ok"): Promise<Collector> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      bodies.push(body);
      if (mode === "hang") return;
      res.statusCode = mode === "500" ? 500 : 204;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1/event`,
    bodies,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function closedPortUrl(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1/event`;
}

type Home = { home: string; xdg: string; dir: string };

function freshHome(): Home {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-tele-home-"));
  const xdg = path.join(home, "xdg");
  fs.mkdirSync(xdg);
  return { home, xdg, dir: path.join(xdg, "gatefit") };
}

type Result = { status: number | null; stdout: string; stderr: string; ms: number };

function runBin(
  args: string[],
  h: Home,
  env: Record<string, string> = {},
  cwd = root,
): Promise<Result> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "DO_NOT_TRACK",
    "CI",
    "GATEFIT_TELEMETRY",
    "GATEFIT_TELEMETRY_URL",
    "GATEFIT_LIVE_CLOCK",
    "GATEFIT_LICENSE_KEY",
    "XDG_CONFIG_HOME",
    "APPDATA",
  ]) {
    delete childEnv[key];
  }
  Object.assign(childEnv, { HOME: h.home, XDG_CONFIG_HOME: h.xdg, INIT_CWD: cwd }, env);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: childEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr, ms: Date.now() - started }));
  });
}

function writeConfig(h: Home, cfg: object): void {
  fs.mkdirSync(h.dir, { recursive: true });
  fs.writeFileSync(path.join(h.dir, "telemetry.json"), JSON.stringify(cfg));
}

const ON_CONFIG = { v: 1, enabled: true, install_id: "0b9f3c4e-1d2a-4b5c-8d6e-7f8091a2b3c4" };

test("default_off_sends_nothing_writes_nothing", async () => {
  const c = await collector();
  const h = freshHome();
  const r = await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(c.bodies.length, 0);
  assert.equal(fs.existsSync(h.dir), false, "telemetry off must not write a config dir");
});

test("do_not_track_beats_env_and_config", async () => {
  const c = await collector();
  const h = freshHome();
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
  });
  assert.equal(fs.existsSync(h.dir), false, "DO_NOT_TRACK must not create an install id");
  writeConfig(h, ON_CONFIG);
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    DO_NOT_TRACK: "1",
  });
  assert.equal(c.bodies.length, 0);
});

test("gatefit_telemetry_0_forces_off_over_config", async () => {
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_TELEMETRY: "0",
  });
  assert.equal(c.bodies.length, 0);
});

test("telemetry_off_beats_env", async () => {
  const c = await collector();
  const h = freshHome();
  const off = await runBin(["telemetry", "off"], h, { GATEFIT_TELEMETRY_URL: c.url });
  assert.equal(off.status, 0, off.stderr);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dir, "telemetry.json"), "utf8"));
  assert.equal(saved.enabled, false);
  assert.equal("install_id" in saved, false, "off must delete the install id");
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_TELEMETRY: "1",
  });
  assert.equal(c.bodies.length, 0);
});

test("ci_without_env_does_not_send", async () => {
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    CI: "true",
  });
  assert.equal(c.bodies.length, 0, "saved `telemetry on` is ignored in CI");
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    CI: "true",
    GATEFIT_TELEMETRY: "1",
  });
  assert.equal(c.bodies.length, 1, "GATEFIT_TELEMETRY=1 opts in even in CI");
});

function assertAllowed(p: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(p).sort(), [...PAYLOAD_KEYS].sort());
  assert.equal(p.v, 1);
  for (const key of PAYLOAD_KEYS) {
    if (key !== "v") assert.equal(typeof p[key], "string", `${key} must be a string`);
  }
  assert.match(String(p.install_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(String(p.version), /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  assert.match(String(p.node), /^\d{1,3}$/);
  assert.ok((PLATFORMS as readonly string[]).includes(String(p.platform)));
  assert.ok((ARCHS as readonly string[]).includes(String(p.arch)));
  assert.ok((COMMANDS as readonly string[]).includes(String(p.command)));
  assert.ok((OUTCOMES as readonly string[]).includes(String(p.outcome)));
  assert.ok(["", ...TEMPLATES].includes(String(p.template)));
  assert.ok(["", ...PACKS].includes(String(p.pack)));
  assert.ok(["", "pack", "custom", ...SUITES].includes(String(p.suite)));
}

test("on_sends_exact_key_set", async () => {
  const c = await collector();
  const h = freshHome();
  const on = await runBin(["telemetry", "on"], h, { GATEFIT_TELEMETRY_URL: c.url });
  assert.equal(on.status, 0, on.stderr);
  const env = { GATEFIT_TELEMETRY_URL: c.url };

  const s1 = await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, env);
  assert.equal(s1.status, 0, s1.stderr);
  const custom = await runBin(["run", "--suite", "tests/entitlements/goldens", "--adapter", NAIVE], h, env);
  assert.equal(custom.status, 1);
  await runBin(["run", "--suite", "chaos", "--adapter", HARDENED], h, env);
  const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-tele-init-"));
  fs.writeFileSync(path.join(tpl, "package.json"), "{}");
  const init = await runBin(["init", "--template", "prisma", "--dry-run"], h, env, tpl);
  assert.equal(init.status, 0, init.stderr);
  await runBin(["adapter-check"], h, env);

  assert.equal(c.bodies.length, 5, "one ping per command");
  const sent = c.bodies.map((b) => JSON.parse(b) as Record<string, unknown>);
  for (const p of sent) assertAllowed(p);
  assert.ok(sent.every((p) => p.install_id === ON_CONFIG.install_id || p.install_id === sent[0]!.install_id));
  assert.equal(new Set(sent.map((p) => p.install_id)).size, 1, "one install id per config");

  const [run1, run2, chaos, initP, check] = sent;
  assert.deepEqual(
    [run1!.command, run1!.outcome, run1!.suite, run1!.pack, run1!.template],
    ["run", "pass", S1, "", ""],
  );
  assert.deepEqual([run2!.command, run2!.outcome, run2!.suite, run2!.pack], ["run", "fail", "custom", ""]);
  assert.deepEqual([chaos!.command, chaos!.suite, chaos!.pack], ["run", "pack", "chaos"]);
  assert.deepEqual(
    [initP!.command, initP!.outcome, initP!.template, initP!.suite, initP!.pack],
    ["init", "pass", "prisma", "", ""],
  );
  assert.deepEqual([check!.command, check!.outcome, check!.suite], ["adapter-check", "pass", ""]);

  const auto = await runBin(["init", "--dry-run", "--template=generic"], h, env, tpl);
  assert.equal(auto.status, 0, auto.stderr);
  assert.equal(JSON.parse(c.bodies.at(-1)!).template, "generic");
});

test("paddle_reports_pack_paddle", async () => {
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  const env = { GATEFIT_TELEMETRY_URL: c.url };
  const paddle = await runBin(["run", "--suite", "paddle", "--adapter", HARDENED], h, env);
  assert.equal(paddle.status, 1, "unlicensed Paddle pack is locked");
  const polar = await runBin(["run", "--suite", "polar", "--adapter", HARDENED], h, env);
  assert.equal(polar.status, 1, "unlicensed Polar pack is locked");
  assert.equal(c.bodies.length, 2);
  const [p1, p2] = c.bodies.map((b) => JSON.parse(b) as Record<string, unknown>);
  for (const p of [p1!, p2!]) assertAllowed(p);
  assert.deepEqual([p1!.command, p1!.suite, p1!.pack, p1!.outcome], ["run", "pack", "paddle", "fail"]);
  assert.deepEqual([p2!.command, p2!.suite, p2!.pack, p2!.outcome], ["run", "pack", "polar", "fail"]);
});

// GATEFIT-H29: a path into a pack's golden directory reports that pack, licensed or not.
test("polar_golden_dir_path_reports_pack_polar", async () => {
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  const r = await runBin(["run", "--suite", "src/packs/polar/goldens", "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
  });
  assert.equal(r.status, 1, "unlicensed Polar path is locked");
  assert.equal(c.bodies.length, 1);
  const p = JSON.parse(c.bodies[0]!) as Record<string, unknown>;
  assertAllowed(p);
  assert.deepEqual([p.command, p.suite, p.pack, p.outcome], ["run", "pack", "polar", "fail"]);
  assert.ok(!c.bodies[0]!.includes("goldens"), "no path sent");
});

test("paddle_golden_file_path_reports_pack_paddle", async () => {
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  const file = "src/packs/paddle/goldens/paddle_transaction_completed_grants.yaml";
  const r = await runBin(["run", "--suite", file, "--adapter", HARDENED], h, { GATEFIT_TELEMETRY_URL: c.url });
  assert.equal(r.status, 1, "unlicensed Paddle path is locked");
  assert.equal(c.bodies.length, 1);
  const p = JSON.parse(c.bodies[0]!) as Record<string, unknown>;
  assertAllowed(p);
  assert.deepEqual([p.command, p.suite, p.pack, p.outcome], ["run", "pack", "paddle", "fail"]);
  assert.ok(!c.bodies[0]!.includes("paddle_transaction"), "no path sent");
});

test("licensed_polar_golden_dir_path_reports_pack_polar_pass", async () => {
  const license = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "granted" }));
    });
  });
  servers.push(license);
  await new Promise<void>((resolve) => license.listen(0, "127.0.0.1", () => resolve()));
  const { port } = license.address() as AddressInfo;
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  const r = await runBin(["run", "--suite", "src/packs/polar/goldens", "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_LICENSE_KEY: "GATEFIT-H29-VALID-KEY",
    GATEFIT_LICENSE_VALIDATE_URL: `http://127.0.0.1:${port}/v1/customer-portal/license-keys/validate`,
    GATEFIT_LICENSE_CACHE: path.join(h.home, "license-cache.json"),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(c.bodies.length, 1);
  const p = JSON.parse(c.bodies[0]!) as Record<string, unknown>;
  assertAllowed(p);
  assert.deepEqual([p.command, p.suite, p.pack, p.outcome], ["run", "pack", "polar", "pass"]);
});

test("planted_secrets_never_leave", async () => {
  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "PLANTREPO-"));
  fs.writeFileSync(path.join(repo, "package.json"), '{"name":"user@PLANT.example"}');
  const adapterDir = path.join(repo, "PLANTREPO-adapters");
  fs.mkdirSync(adapterDir);
  fs.copyFileSync(path.join(root, HARDENED), path.join(adapterDir, "hardened.ts"));
  // Secret-shaped literals are assembled at runtime so no token shape lands in git.
  const env = {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_LICENSE_KEY: "PLANT-LICENSE-0000",
    STRIPE_SECRET_KEY: "sk_" + "test_PLANT" + "x".repeat(20),
    POLAR_ACCESS_TOKEN: "polar_" + "oat_PLANT" + "x".repeat(20),
    DATABASE_URL: "postgres://u:PLANTpw@db.PLANT.example:5432/x",
    GATEFIT_EMAIL: "user@PLANT.example",
  };
  const golden = path.join(root, "tests/entitlements/goldens", `${S1}.yaml`);
  await runBin(["run", "--suite", golden, "--adapter", path.join(adapterDir, "hardened.ts")], h, env, repo);
  await runBin(["run", "--suite", S1, "--adapter", "PLANTREPO-adapters/hardened.ts"], h, env, repo);
  await runBin(["init", "--template", "generic", "--dir", "PLANTREPO-out", "--dry-run"], h, env, repo);
  assert.equal(c.bodies.length, 3);
  for (const body of c.bodies) {
    assert.ok(body.length < 512, "payload stays small");
    assert.doesNotMatch(body, /PLANT/);
    assert.ok(!body.includes(h.home), "no home dir");
    assert.ok(!body.includes(os.tmpdir()), "no tmpdir");
    assert.ok(!body.includes(os.homedir()), "no real home dir");
    assert.doesNotMatch(body, /[\\/@]/);
    assert.doesNotMatch(body, /sk_|pk_|polar_|whsec_/);
  }
  assert.equal(JSON.parse(c.bodies[0]!).suite, "custom");
});

test("unreachable_collector_silent_and_bounded", async () => {
  const url = await closedPortUrl();
  const h = freshHome();
  const args = ["run", "--suite", S1, "--adapter", HARDENED];
  const off = await runBin(args, h, { GATEFIT_TELEMETRY_URL: url });
  writeConfig(h, ON_CONFIG);
  const on = await runBin(args, h, { GATEFIT_TELEMETRY_URL: url });
  assert.equal(on.status, off.status);
  assert.equal(on.stdout, off.stdout);
  assert.equal(on.stderr, off.stderr);
});

test("hanging_collector_bounded", async () => {
  const hang = await collector("hang");
  const h = freshHome();
  const args = ["run", "--suite", S1, "--adapter", HARDENED];
  const off = await runBin(args, h, { GATEFIT_TELEMETRY_URL: hang.url });
  writeConfig(h, ON_CONFIG);
  const on = await runBin(args, h, { GATEFIT_TELEMETRY_URL: hang.url });
  assert.equal(hang.bodies.length, 1, "the hanging collector did receive the ping");
  assert.equal(on.status, off.status);
  assert.equal(on.stdout, off.stdout);
  assert.equal(on.stderr, off.stderr);
  assert.ok(on.ms < off.ms + 2500, `telemetry added ${on.ms - off.ms} ms`);

  const err = await collector("500");
  const on500 = await runBin(args, h, { GATEFIT_TELEMETRY_URL: err.url });
  assert.equal(err.bodies.length, 1);
  assert.equal(on500.status, off.status);
  assert.equal(on500.stdout, off.stdout);
  assert.equal(on500.stderr, off.stderr);
});

test("exit_codes_and_stdout_unchanged", async () => {
  const c = await collector();
  const offHome = freshHome();
  const onHome = freshHome();
  writeConfig(onHome, ON_CONFIG);
  const env = { GATEFIT_TELEMETRY_URL: c.url };
  const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-tele-wf-"));
  fs.writeFileSync(path.join(tpl, "package.json"), "{}");
  const cases: [string[], string, number][] = [
    [["run", "--suite", S1, "--adapter", NAIVE], root, 1],
    [["run", "--suite", S1, "--adapter", HARDENED], root, 0],
    [["init", "--template", "generic", "--print-workflow"], tpl, 0],
  ];
  for (const [args, cwd, code] of cases) {
    const off = await runBin(args, offHome, env, cwd);
    const on = await runBin(args, onHome, env, cwd);
    assert.equal(off.status, code, off.stderr);
    assert.equal(on.status, code, on.stderr);
    assert.equal(on.stdout, off.stdout);
    assert.equal(on.stderr, off.stderr);
  }
  assert.equal(c.bodies.length, 3, "only the opted-in runs sent");
});

test("non_loopback_override_sends_nowhere", async () => {
  assert.equal(TELEMETRY_ENDPOINT, "https://t.gatefit.io/v1/event");
  assert.equal(endpoint({}), TELEMETRY_ENDPOINT);
  for (const bad of [
    "https://evil.example/v1/event",
    "http://evil.example:8080/v1/event",
    "https://127.0.0.1:9/v1/event",
    "http://127.0.0.1/v1/event",
    "http://127.0.0.1.evil.example:80/",
    "http://user@127.0.0.1:80/",
    "not a url",
    "",
  ]) {
    assert.equal(endpoint({ GATEFIT_TELEMETRY_URL: bad }), null, bad);
  }
  assert.equal(endpoint({ GATEFIT_TELEMETRY_URL: "http://127.0.0.1:4000/v1/event" }), "http://127.0.0.1:4000/v1/event");
  assert.equal(endpoint({ GATEFIT_TELEMETRY_URL: "http://localhost:4000/x" }), "http://localhost:4000/x");
  assert.equal(endpoint({ GATEFIT_TELEMETRY_URL: "http://[::1]:4000/x" }), "http://[::1]:4000/x");

  const c = await collector();
  const h = freshHome();
  writeConfig(h, ON_CONFIG);
  const r = await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: "https://evil.example/v1/event",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(c.bodies.length, 0);
});

test("telemetry_subcommands_never_send", async () => {
  const c = await collector();
  const h = freshHome();
  const env = { GATEFIT_TELEMETRY_URL: c.url, GATEFIT_TELEMETRY: "1" };
  const before = await runBin(["telemetry", "status"], h, env);
  assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /<random id, created on enable>|install_id/);
  for (const args of [["telemetry", "on"], ["telemetry", "status"], ["telemetry", "off"], ["--help"], ["--version"], ["run"]]) {
    await runBin(args, h, env);
  }
  assert.equal(c.bodies.length, 0);

  const fresh = freshHome();
  const status = await runBin(["telemetry", "status"], fresh, { GATEFIT_TELEMETRY_URL: c.url });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /off/);
  assert.match(status.stdout, /default/i, "status names the reason");
  for (const key of PAYLOAD_KEYS) assert.match(status.stdout, new RegExp(`"${key}"`));
  assert.match(status.stdout, /<random id, created on enable>/);
  assert.equal(fs.existsSync(fresh.dir), false, "status writes nothing");

  const dnt = await runBin(["telemetry", "status"], h, { DO_NOT_TRACK: "1" });
  assert.match(dnt.stdout, /DO_NOT_TRACK/);
  const bad = await runBin(["telemetry", "maybe"], fresh, {});
  assert.notEqual(bad.status, 0);
  assert.equal(c.bodies.length, 0);
});

test("corrupt_config_counts_as_off", async () => {
  const c = await collector();
  const h = freshHome();
  fs.mkdirSync(h.dir, { recursive: true });
  fs.writeFileSync(path.join(h.dir, "telemetry.json"), "{not json");
  const r = await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_TELEMETRY: "1",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(c.bodies.length, 0);
  assert.equal(fs.readFileSync(path.join(h.dir, "telemetry.json"), "utf8"), "{not json");
});

test("env_opt_in_creates_install_id_without_enabling", async () => {
  const c = await collector();
  const h = freshHome();
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, {
    GATEFIT_TELEMETRY_URL: c.url,
    GATEFIT_TELEMETRY: "1",
  });
  assert.equal(c.bodies.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dir, "telemetry.json"), "utf8"));
  assert.equal(saved.enabled, undefined);
  assert.equal(saved.install_id, JSON.parse(c.bodies[0]!).install_id);
  await runBin(["run", "--suite", S1, "--adapter", HARDENED], h, { GATEFIT_TELEMETRY_URL: c.url });
  assert.equal(c.bodies.length, 1, "without the env var the saved id alone does not opt in");
});

test("init_help_and_usage_errors_never_send", async () => {
  const c = await collector();
  const h = freshHome();
  const env = { GATEFIT_TELEMETRY_URL: c.url, GATEFIT_TELEMETRY: "1" };
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-tele-init-"));
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "two-orms", dependencies: { "drizzle-orm": "1.0.0", "@prisma/client": "5.0.0" } }),
  );
  const cases: [string[], number][] = [
    [["init", "--help"], 0],
    [["init", "-h"], 0],
    [["init", "--bogus"], 2],
    [["init", "--print-workflow", "--write-workflow"], 2],
    [["init", "--template", "nope"], 2],
    [["init", "--no-prompt"], 2],
  ];
  for (const [args, code] of cases) {
    const r = await runBin(args, h, env, project);
    assert.equal(r.status, code, `${args.join(" ")}: ${r.stderr}`);
  }
  assert.equal(c.bodies.length, 0);
  const control = await runBin(["init", "--dry-run", "--template", "generic"], h, env, project);
  assert.equal(control.status, 0, control.stderr);
  assert.equal(c.bodies.length, 1);
});

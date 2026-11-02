import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");

/** Child env with telemetry forced off, so `npm test` never pings a collector. */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["GATEFIT_TELEMETRY", "GATEFIT_TELEMETRY_URL", "DO_NOT_TRACK"]) delete env[key];
  return { ...env, GATEFIT_TELEMETRY: "0", ...extra };
}

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const childEnv = cleanEnv(env);
  if (!("GATEFIT_LIVE_CLOCK" in env)) delete childEnv.GATEFIT_LIVE_CLOCK;
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
}

test("gatefit run hardened goldens exits 0", () => {
  const result = run([
    "run",
    "--suite",
    "tests/entitlements/goldens",
    "--adapter",
    "src/adapters/hardened.ts",
  ]);
  assert.equal(result.status, 0, result.stderr);
});

const s7s9 = [
  "trial_no_card",
  "portal_downgrade_period_end_vs_immediate",
  "entitlements_active_summary",
];

test("gatefit run S7–S9: hardened passes and naive fails each golden", () => {
  for (const id of s7s9) {
    const hardened = run(["run", "--suite", id, "--adapter", "src/adapters/hardened.ts"]);
    assert.equal(hardened.status, 0, hardened.stderr);
    const naive = run(["run", "--suite", id, "--adapter", "src/adapters/naive.ts"]);
    assert.equal(naive.status, 1, naive.stderr);
    assert.match(naive.stderr, new RegExp(`FAIL ${id}`));
  }
});

test("gatefit run naive S1 exits 1", () => {
  const result = run([
    "run",
    "--suite",
    "paid_grants_access",
    "--adapter",
    "src/adapters/naive.ts",
  ]);
  assert.equal(result.status, 1);
});

test("gatefit adapter-check exits 0 when naive fails S1 and hardened passes S1", () => {
  const result = run(["adapter-check"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("gatefit run refuses sk_live in env", () => {
  const result = run(
    ["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/hardened.ts"],
    { STRIPE_SECRET_KEY: "sk_live_should_refuse" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /sk_live/);
});

test("gatefit run refuses GATEFIT_LIVE_CLOCK", () => {
  const result = run(
    ["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/hardened.ts"],
    { GATEFIT_LIVE_CLOCK: "1" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /GATEFIT_LIVE_CLOCK/);
});

test("gatefit --version prints package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gatefit 0\.6\.0/);
});

test("gatefit run from another cwd uses bundled suite id and caller adapter", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-npx-"));
  const adapter = path.join(tmp, "caller-adapter.ts");
  fs.writeFileSync(
    adapter,
    [
      "const rows = new Map();",
      "const seen = new Set();",
      "export function createAdapter() {",
      "  return {",
      "    apply(event) {",
      "      if (seen.has(event.id)) return;",
      "      seen.add(event.id);",
      "      if (event.type === 'invoice.paid' || event.paid === true) {",
      "        rows.set(event.customerId, { locked: false, plan: event.plan });",
      "      }",
      "    },",
      "    snapshot(customerId) { return rows.get(customerId) ?? { locked: true }; },",
      "    reset() { rows.clear(); seen.clear(); },",
      "  };",
      "}",
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    process.execPath,
    [bin, "run", "--suite", "paid_grants_access", "--adapter", "caller-adapter.ts"],
    {
      cwd: tmp,
      encoding: "utf8",
      env: cleanEnv({ INIT_CWD: tmp }),
    },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("gatefit adapter-check from another cwd still uses bundled adapters", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-check-"));
  const result = spawnSync(process.execPath, [bin, "adapter-check"], {
    cwd: tmp,
    encoding: "utf8",
    env: cleanEnv({ INIT_CWD: tmp }),
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("empty caller goldens directory does not false-pass; bundled S1–S6 still run", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-empty-goldens-"));
  fs.mkdirSync(path.join(tmp, "tests/entitlements/goldens"), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [bin, "run", "--suite", "tests/entitlements/goldens", "--adapter", "src/adapters/hardened.ts"],
    {
      cwd: tmp,
      encoding: "utf8",
      env: cleanEnv({ INIT_CWD: tmp }),
    },
  );
  const out = result.stderr + result.stdout;
  assert.equal(result.status, 0, out);
  assert.match(out, /PASS paid_grants_access/);
  assert.match(out, /PASS cancel_revokes_access/);
});

test("gatefit live refuses to run without GATEFIT_LIVE_CLOCK=1", () => {
  const result = run(["live", "--adapter", "src/adapters/hardened.ts"], {
    STRIPE_SECRET_KEY: "sk_test_123",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /GATEFIT_LIVE_CLOCK=1/);
});

test("gatefit live refuses sk_live", () => {
  const result = run(["live", "--adapter", "src/adapters/hardened.ts"], {
    GATEFIT_LIVE_CLOCK: "1",
    STRIPE_SECRET_KEY: "sk_live_nope",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /sk_live/);
});

test("gatefit live without a test key explains the missing secret", () => {
  const result = run(["live", "--adapter", "src/adapters/hardened.ts"], {
    GATEFIT_LIVE_CLOCK: "1",
    STRIPE_SECRET_KEY: "",
    STRIPE_API_KEY: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /STRIPE_SECRET_KEY|STRIPE_API_KEY/);
});

test("gatefit live is listed in usage", () => {
  const result = run([]);
  assert.match(result.stderr + result.stdout, /gatefit live/);
});

test("gatefit bin finds hoisted tsx outside the package directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-hoist-"));
  const prefix = path.join(tmp, "node_modules");
  const pkgDir = path.join(prefix, "gatefit");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.cpSync(path.join(root, "bin"), path.join(pkgDir, "bin"), { recursive: true });
  fs.cpSync(path.join(root, "src"), path.join(pkgDir, "src"), { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(pkgDir, "package.json"));
  fs.cpSync(
    path.join(root, "tests/entitlements/goldens"),
    path.join(pkgDir, "tests/entitlements/goldens"),
    { recursive: true },
  );
  fs.symlinkSync(path.join(root, "node_modules/tsx"), path.join(prefix, "tsx"));
  fs.symlinkSync(path.join(root, "node_modules/yaml"), path.join(prefix, "yaml"));
  const result = spawnSync(process.execPath, [path.join(pkgDir, "bin/gatefit.js"), "--version"], {
    cwd: tmp,
    encoding: "utf8",
    env: cleanEnv({ INIT_CWD: tmp }),
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /gatefit 0\.6\.0/);
});

test("cli test children never send telemetry even when the parent env opts in", async () => {
  let connections = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end());
  });
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const saved = { GATEFIT_TELEMETRY: process.env.GATEFIT_TELEMETRY, GATEFIT_TELEMETRY_URL: process.env.GATEFIT_TELEMETRY_URL };
  process.env.GATEFIT_TELEMETRY = "1";
  process.env.GATEFIT_TELEMETRY_URL = `http://127.0.0.1:${address.port}/v1/event`;
  try {
    const result = run(["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/hardened.ts"]);
    assert.equal(result.status, 0, result.stderr);
    // spawnSync blocked this loop; let any queued connection surface before counting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(connections, 0);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

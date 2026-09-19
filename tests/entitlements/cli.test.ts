import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const childEnv = { ...process.env, ...env };
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
  assert.match(result.stdout, /gatefit 0\.4\.0/);
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
      env: { ...process.env, INIT_CWD: tmp },
    },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("gatefit adapter-check from another cwd still uses bundled adapters", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-check-"));
  const result = spawnSync(process.execPath, [bin, "adapter-check"], {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, INIT_CWD: tmp },
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
      env: { ...process.env, INIT_CWD: tmp },
    },
  );
  const out = result.stderr + result.stdout;
  assert.equal(result.status, 0, out);
  assert.match(out, /PASS paid_grants_access/);
  assert.match(out, /PASS cancel_revokes_access/);
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
    env: { ...process.env, INIT_CWD: tmp },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /gatefit 0\.4\.0/);
});

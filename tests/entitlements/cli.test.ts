import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

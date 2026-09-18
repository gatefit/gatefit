import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";

const root = path.join(import.meta.dirname, "../..");
const actionPath = path.join(root, ".github/actions/gatefit/action.yml");

test("composite action wraps gatefit run with adapter + suite inputs", () => {
  const raw = fs.readFileSync(actionPath, "utf8");
  const action = parseYaml(raw) as {
    inputs?: Record<string, { required?: boolean }>;
    runs?: { using?: string; steps?: Array<{ run?: string }> };
  };
  assert.equal(action.runs?.using, "composite");
  assert.equal(action.inputs?.adapter?.required, true);
  assert.ok(action.inputs?.suite);
  const script = (action.runs?.steps ?? []).map((s) => s.run ?? "").join("\n");
  assert.match(script, /cli\.ts/);
  assert.match(script, /run --suite/);
  assert.match(script, /--adapter/);
});

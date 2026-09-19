import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";

const root = path.join(import.meta.dirname, "../..");

type ActionDoc = {
  name?: string;
  description?: string;
  branding?: { icon?: string; color?: string };
  inputs?: Record<string, { required?: boolean }>;
  runs?: { using?: string; steps?: Array<{ run?: string }> };
};

function loadAction(rel: string): ActionDoc {
  return parseYaml(fs.readFileSync(path.join(root, rel), "utf8")) as ActionDoc;
}

function scriptOf(action: ActionDoc): string {
  return (action.runs?.steps ?? []).map((s) => s.run ?? "").join("\n");
}

test("root action.yml is marketplace-ready and wraps gatefit run", () => {
  const action = loadAction("action.yml");
  assert.equal(action.runs?.using, "composite");
  assert.equal(action.inputs?.adapter?.required, true);
  assert.ok(action.inputs?.suite);
  assert.ok(action.branding?.icon);
  assert.ok(action.branding?.color);
  assert.match(action.name ?? "", /gatefit/i);
  const script = scriptOf(action);
  assert.match(script, /action-run\.sh/);
});

test("nested action.yml remains a documented compatibility shim", () => {
  const action = loadAction(".github/actions/gatefit/action.yml");
  assert.equal(action.runs?.using, "composite");
  assert.equal(action.inputs?.adapter?.required, true);
  assert.match(scriptOf(action), /action-run\.sh/);
});

test("action-run.sh invokes packaged bin gatefit run", () => {
  const sh = fs.readFileSync(path.join(root, "scripts/action-run.sh"), "utf8");
  assert.match(sh, /bin\/gatefit\.js/);
  assert.match(sh, /run --suite/);
  assert.match(sh, /--adapter/);
});

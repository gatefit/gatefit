import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  license?: string;
  publishConfig?: { access?: string };
};
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const publishDoc = fs.readFileSync(path.join(root, "docs/publish.md"), "utf8");

test("package is publishable as gatefit 0.4.0", () => {
  assert.equal(pkg.name, "gatefit");
  assert.equal(pkg.version, "0.4.0");
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.bin?.gatefit, "./bin/gatefit.js");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.publishConfig?.access, "public");
  for (const rel of ["bin", "src", "tests/entitlements/goldens", "action.yml", "LICENSE"]) {
    assert.ok(pkg.files?.includes(rel), `files missing ${rel}`);
  }
});

test("README documents npx, Action, and indie pricing", () => {
  assert.match(readme, /npx gatefit/);
  assert.match(readme, /uses: edipert\/gatefit@v0\.4\.0/);
  assert.match(readme, /\$29/);
  assert.match(readme, /\$49/);
  assert.match(readme, /\$19/);
  assert.doesNotMatch(readme, /buy now|limited time|act now/i);
});

test("publish checklist exists and does not embed tokens", () => {
  assert.match(publishDoc, /npm publish/);
  assert.match(publishDoc, /npm pack/);
  assert.doesNotMatch(publishDoc, /npm_[A-Za-z0-9]+/);
  assert.doesNotMatch(publishDoc, /sk_live/);
});

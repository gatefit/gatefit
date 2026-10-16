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

test("package is publishable as gatefit 0.5.1", () => {
  assert.equal(pkg.name, "gatefit");
  assert.equal(pkg.version, "0.5.1");
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
  assert.match(readme, /uses: gatefit\/gatefit@v0\.5\.1/);
  assert.match(readme, /\$49/);
  assert.doesNotMatch(readme, /\$19/);
  assert.doesNotMatch(readme, /optional updates/i);
  assert.match(readme, /https:\/\/gatefit\.io/);
  assert.doesNotMatch(readme, /\.github\.io\/gatefit/);
  assert.match(readme, /polar/i);
  assert.match(readme, /polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0/);
  assert.match(readme, /Indie License/);
  assert.match(readme, /fail closed|fails closed|not live/i);
  assert.match(readme, /\*\*Docs site:\*\* live/);
  assert.doesNotMatch(readme, /buy now|limited time|act now/i);
});

test("publish checklist exists and does not embed tokens", () => {
  assert.match(publishDoc, /npm publish/);
  assert.match(publishDoc, /npm pack/);
  assert.doesNotMatch(publishDoc, /npm_[A-Za-z0-9]+/);
  assert.doesNotMatch(publishDoc, /sk_live/);
});

test("live clock docs and workflow exist and stay opt-in", () => {
  const liveDoc = fs.readFileSync(path.join(root, "docs/live-clock.md"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/live-clock.yml"), "utf8");
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(liveDoc, /GATEFIT_LIVE_CLOCK=1/);
  assert.match(liveDoc, /paid_grants_access/);
  assert.match(liveDoc, /cancel_revokes_access/);
  assert.match(liveDoc, /trial_to_paid_grants/);
  assert.doesNotMatch(liveDoc, /sk_live_[A-Za-z0-9]+/);
  assert.match(workflow, /GATEFIT_LIVE_CLOCK/);
  assert.match(workflow, /live-clock/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /schedule/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /live-clock skipped: STRIPE_SECRET_KEY not configured/);
  assert.doesNotMatch(workflow, /^ {2}push:/m);
  assert.doesNotMatch(workflow, /if:.*secrets/);
  assert.doesNotMatch(ci, /GATEFIT_LIVE_CLOCK/);
  assert.match(readme, /docs\/live-clock\.md/);
});

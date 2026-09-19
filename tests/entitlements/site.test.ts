import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("Starlight lives in site/ with GitHub Pages site+base", () => {
  const cfg = read("site/astro.config.mjs");
  assert.match(cfg, /edipert\.github\.io/);
  assert.match(cfg, /base:\s*['"]\/gatefit['"]/);
  const pkg = JSON.parse(read("package.json")) as {
    version: string;
    files?: string[];
  };
  assert.equal(pkg.version, "0.4.0");
  assert.ok(!pkg.files?.includes("site"));
});

test("landing, quickstart, Action, and Polar docs exist", () => {
  const index = read("site/src/content/docs/index.mdx");
  const quickstart = read("site/src/content/docs/quickstart.md");
  const action = read("site/src/content/docs/action.md");
  const polar = read("site/src/content/docs/polar.md");
  assert.match(index, /PolarBuyCta/);
  assert.match(index, /\$29/);
  assert.match(index, /\$49/);
  assert.match(quickstart, /npx gatefit/);
  assert.match(quickstart, /adapter/i);
  assert.match(action, /uses: edipert\/gatefit@v0\.4\.0/);
  assert.match(polar, /PUBLIC_POLAR_CHECKOUT_URL/);
});

test("one Polar Buy CTA uses Polar checkout attributes", () => {
  const cta = read("site/src/components/PolarBuyCta.astro");
  assert.match(cta, /data-polar-checkout/);
  assert.match(cta, /PUBLIC_POLAR_CHECKOUT_URL|polar\.sh/);
  assert.doesNotMatch(cta, /buy now/i);
  assert.doesNotMatch(cta, /gumroad|stripe\.com\/checkout|docusaurus|framer/i);
});

test("GitHub Pages workflow builds site/ and stays out of live-clock CI", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /withastro\/action/);
  assert.match(workflow, /path:\s*site/);
  assert.match(workflow, /deploy-pages/);
  assert.doesNotMatch(workflow, /GATEFIT_LIVE_CLOCK/);
});

test("repo Polar setup documents the placeholder checkout env", () => {
  const polar = read("docs/polar.md");
  assert.match(polar, /PUBLIC_POLAR_CHECKOUT_URL/);
  assert.match(polar, /buy\.polar\.sh|placeholder/i);
});

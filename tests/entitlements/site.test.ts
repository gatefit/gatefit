import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  POLAR_CHECKOUT_HREF_RE,
  resolvePolarCheckoutUrl,
} from "../../site/src/lib/polarCheckout.ts";

const root = path.join(import.meta.dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("Starlight lives in site/ at the gatefit.io root", () => {
  const cfg = read("site/astro.config.mjs");
  assert.match(cfg, /https:\/\/gatefit\.io/);
  assert.match(cfg, /base:\s*['"]\/['"]/);
  assert.doesNotMatch(cfg, /base:\s*['"]\/gatefit['"]/);
  const pkg = JSON.parse(read("package.json")) as {
    version: string;
    files?: string[];
  };
  assert.equal(pkg.version, "0.4.0");
  assert.ok(!pkg.files?.includes("site"));
});

test("landing, quickstart, Action, and Polar docs exist", () => {
  const index = read("site/src/pages/index.astro");
  const quickstart = read("site/src/content/docs/quickstart.md");
  const action = read("site/src/content/docs/action.md");
  const polar = read("site/src/pages/polar.astro");
  assert.match(index, /PolarBuyCta/);
  assert.match(index, /\$49/);
  assert.match(index, /Buy for \$49/);
  assert.match(index, /Indie License/);
  assert.doesNotMatch(index, /coming soon/i);
  assert.doesNotMatch(index, /checkout is live/i);
  assert.doesNotMatch(index, /merchant of record/i);
  assert.doesNotMatch(index, /docs live at/i);
  assert.doesNotMatch(index, /["']\/gatefit\//);
  assert.match(quickstart, /npx gatefit/);
  assert.match(quickstart, /adapter/i);
  assert.match(quickstart, /\/action\//);
  assert.doesNotMatch(quickstart, /\/gatefit\/action\//);
  assert.match(action, /uses: gatefit\/gatefit@v0\.4\.0/);
  assert.match(polar, /location\.replace\('\/#pricing'\)/);
  assert.doesNotMatch(polar, /import PolarRedirect/);
  assert.doesNotMatch(polar, /<PolarRedirect/);
});

const GATEFIT_CHECKOUT_URL =
  "https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0";

test("resolvePolarCheckoutUrl fails closed unless Polar Checkout Link", () => {
  assert.equal(resolvePolarCheckoutUrl(undefined), GATEFIT_CHECKOUT_URL);
  assert.equal(resolvePolarCheckoutUrl(""), GATEFIT_CHECKOUT_URL);
  assert.equal(resolvePolarCheckoutUrl("   "), GATEFIT_CHECKOUT_URL);
  assert.match(GATEFIT_CHECKOUT_URL, POLAR_CHECKOUT_HREF_RE);
  assert.equal(resolvePolarCheckoutUrl("https://polar.sh/"), null);
  assert.equal(resolvePolarCheckoutUrl("https://polar.sh/gatefit/gatefit"), null);
  assert.equal(resolvePolarCheckoutUrl("http://buy.polar.sh/polar_cl_abc"), null);
  assert.equal(resolvePolarCheckoutUrl("https://evil.example/polar_cl_abc"), null);
  assert.equal(resolvePolarCheckoutUrl("https://buy.polar.sh/"), null);
  assert.equal(resolvePolarCheckoutUrl("https://buy.polar.sh/products/gatefit-one-time"), null);
  assert.equal(resolvePolarCheckoutUrl("https://buy.polar.sh/products/anything"), null);
  const live = "https://buy.polar.sh/polar_cl_TESTSHAPEONLY";
  assert.equal(resolvePolarCheckoutUrl(live), live);
  assert.equal(resolvePolarCheckoutUrl(` ${live} `), live);
  assert.match(live, POLAR_CHECKOUT_HREF_RE);
});

test("Polar CTA has no polar.sh placeholder fallback", () => {
  const cta = read("site/src/components/PolarBuyCta.astro");
  assert.doesNotMatch(cta, /\|\|\s*['"]https:\/\/polar\.sh\/?['"]/);
  assert.match(cta, /resolvePolarCheckoutUrl/);
  assert.match(cta, /target="_blank"/);
  assert.match(cta, /rel="noopener"/);
  assert.match(cta, /data-checkout-closed/);
  assert.doesNotMatch(cta, /data-polar-checkout/);
  assert.doesNotMatch(cta, /embed\.global\.js/);
  assert.doesNotMatch(cta, /@polar-sh\/checkout/);
  assert.doesNotMatch(cta, /buy now/i);
  assert.doesNotMatch(cta, /gumroad|stripe\.com\/checkout|docusaurus|framer/i);
});

test("GitHub Pages workflow builds site/ and stays out of live-clock CI", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /withastro\/action/);
  assert.match(workflow, /path:\s*site/);
  assert.match(workflow, /deploy-pages/);
  assert.match(workflow, /committed Checkout Link/);
  assert.doesNotMatch(workflow, /Empty \/ unset fails closed/);
  assert.doesNotMatch(workflow, /GATEFIT_LIVE_CLOCK/);
});

test("repo Polar setup documents fail-closed checkout env", () => {
  const polar = read("docs/polar.md");
  const envExample = read("site/.env.example");
  assert.match(polar, /PUBLIC_POLAR_CHECKOUT_URL/);
  assert.match(polar, /buy\.polar\.sh/);
  assert.match(polar, /fail closed|fails closed/i);
  assert.match(polar, /polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0/);
  assert.match(polar, /\$49/);
  assert.match(envExample, /PUBLIC_POLAR_CHECKOUT_URL=/);
  assert.doesNotMatch(envExample, /PUBLIC_POLAR_CHECKOUT_URL=https:\/\/polar\.sh/);
});

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
  assert.equal(pkg.version, "0.6.0");
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
  assert.match(index, /Unlocks Pro packs/);
  assert.match(index, /Chaos mode/);
  assert.match(index, /checks the access row/);
  assert.doesNotMatch(index, /Chaos mode coming/);
  assert.doesNotMatch(index, /\$19/);
  assert.doesNotMatch(index, /optional updates/i);
  assert.doesNotMatch(index, /coming soon/i);
  assert.doesNotMatch(index, /checkout is live/i);
  assert.doesNotMatch(index, /merchant of record/i);
  assert.doesNotMatch(index, /docs live at/i);
  assert.doesNotMatch(index, /["']\/gatefit\//);
  assert.match(quickstart, /npx gatefit/);
  assert.match(quickstart, /adapter/i);
  assert.match(quickstart, /\/action\//);
  assert.doesNotMatch(quickstart, /\/gatefit\/action\//);
  assert.match(action, /uses: gatefit\/gatefit@v0\.6\.0/);
  assert.match(polar, /location\.replace\('\/#pricing'\)/);
  assert.doesNotMatch(polar, /import PolarRedirect/);
  assert.doesNotMatch(polar, /<PolarRedirect/);
});

test("init docs page exists, says init is free, and quickstart points to it", () => {
  const init = read("site/src/content/docs/init.md");
  const quickstart = read("site/src/content/docs/quickstart.md");
  assert.match(init, /init.*is free/i);
  assert.match(init, /not shipped in 0\.5\.2/i);
  assert.match(init, /ships in 0\.6\.0/);
  assert.match(init, /\$49 one-time/);
  assert.doesNotMatch(init, /\$19/);
  assert.doesNotMatch(init, /monthly|coming soon|optional updates/i);
  assert.doesNotMatch(init, /GATEFIT_LICENSE_KEY/);
  assert.match(quickstart, /No adapter yet\? `npx gatefit init`/);
  assert.match(read("site/astro.config.mjs"), /slug: 'init'/);
});

test("Polar pack page is honest about price, release, and HTTP 200", () => {
  const page = read("site/src/content/docs/polar-pack.md");
  const readme = read("README.md");
  const changelog = read("CHANGELOG.md");
  assert.match(page, /gatefit run --suite polar --adapter/);
  assert.match(page, /The Polar provider pack ships in 0\.6\.0\./);
  assert.match(
    page,
    /The only price is the \$49 one-time Gatefit Indie License \(Polar\)\. It unlocks only chaos mode and the provider packs\. S1–S9 and Phase 2 stay free\./,
  );
  assert.match(page, /HTTP 200 is not access/);
  const schema = read("src/polar-pack.ts").match(/export const POLAR_SCHEMA = "([^"]+)";/)?.[1];
  assert.equal(schema, "v1+fixtures.1");
  assert.ok(page.includes(`POLAR_SCHEMA = ${schema}`), "docs cite POLAR_SCHEMA");
  assert.doesNotMatch(page, /v1@\d{4}-\d{2}-\d{2}/);
  assert.match(page, /`subscription\.created`[^|]*`active`[^|]*\|\s*unlocked/);
  assert.match(page, /`provider: polar`/);
  assert.match(page, /order\.\*.*subscription\.\*.*benefit_grant\.\*.*refund\.\*.*checkout\.\*/s);
  assert.match(page, /partially_refunded/);
  assert.match(page, /polar_oat_/);
  for (const text of [page, readme]) {
    assert.doesNotMatch(text, /\$19|monthly|coming soon|optional updates/i);
    assert.doesNotMatch(text, /fixture goldens|names match the goldens|docs live at|checkout is live/i);
  }
  assert.match(readme, /Polar provider pack ships in 0\.6\.0/);
  assert.match(changelog, /gatefit run --suite polar/);
  assert.match(read("site/astro.config.mjs"), /slug: 'polar-pack'/);
});

test("Paddle pack page is honest about price, release, and HTTP 200", () => {
  const page = read("site/src/content/docs/paddle-pack.md");
  const doc = read("docs/paddle.md");
  const readme = read("README.md");
  const changelog = read("CHANGELOG.md");
  assert.match(page, /gatefit run --suite paddle --adapter/);
  assert.match(page, /The Paddle provider pack arrives in the next release\./);
  assert.match(
    page,
    /The only price is the \$49 one-time Gatefit Indie License \(Polar\)\. It unlocks only chaos mode and the provider packs\. S1–S9 and Phase 2 stay free\./,
  );
  assert.match(page, /HTTP 200 is not access/);
  const schema = read("src/paddle-pack.ts").match(/export const PADDLE_SCHEMA = "([^"]+)";/)?.[1];
  assert.equal(schema, "v1+fixtures.1");
  assert.ok(page.includes(`PADDLE_SCHEMA = ${schema}`), "docs cite PADDLE_SCHEMA");
  assert.match(page, /`provider: paddle`/);
  assert.match(page, /pdl_live_/);
  assert.match(page, /transaction\.completed/);
  for (const text of [page, doc, readme, changelog]) {
    assert.doesNotMatch(text, /\$19|monthly|coming soon|optional updates/i);
    assert.doesNotMatch(text, /fixture goldens|names match the goldens|docs live at|checkout is live/i);
    assert.doesNotMatch(text, /paddle[^\n]*(ships in|is live|shipped)/i);
  }
  assert.match(readme, /Paddle provider pack arrives in the next release/);
  assert.match(changelog, /gatefit run --suite paddle/);
  assert.match(read("site/astro.config.mjs"), /slug: 'paddle-pack'/);
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

test("pages workflow builds site/ and does not deploy to GitHub Pages", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /withastro\/action/);
  assert.match(workflow, /path:\s*site/);
  assert.match(workflow, /committed Checkout Link/);
  assert.doesNotMatch(workflow, /deploy-pages/);
  assert.doesNotMatch(workflow, /github-pages/);
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

const CF_BEACON_TOKEN = "82ff14a5563c492d869b6db741aac128";

test("H25: Cloudflare beacon in both heads, telemetry page in the sidebar", () => {
  const cfg = read("site/astro.config.mjs");
  const index = read("site/src/pages/index.astro");
  for (const src of [cfg, index]) {
    assert.match(src, /https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/);
    assert.ok(src.includes(CF_BEACON_TOKEN), "beacon token");
  }
  assert.match(cfg, /slug:\s*'telemetry'/);
  assert.doesNotMatch(read("site/src/pages/polar.astro"), /cloudflareinsights/);
});

test("H25: Buy click beacon never blocks navigation and stores nothing", () => {
  const cta = read("site/src/components/PolarBuyCta.astro");
  const anchor = cta.slice(cta.indexOf("<a"), cta.indexOf("</a>"));
  assert.match(anchor, /data-gf-buy/);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="noopener"/);
  assert.doesNotMatch(cta, /data-polar-checkout/);
  const closed = cta.slice(cta.indexOf(") : ("), cta.indexOf("data-checkout-closed"));
  assert.doesNotMatch(closed, /data-gf-buy/, "closed CTA is never counted");
  const index = read("site/src/pages/index.astro");
  assert.equal((index.match(/<PolarBuyCta/g) ?? []).length, 4, "exactly 4 Buy CTAs");
  assert.match(index, /a\[data-gf-buy\]/);
  assert.match(index, /https:\/\/t\.gatefit\.io\/v1\/site/);
  assert.match(index, /sendBeacon/);
  for (const banned of [/cookie/i, /localStorage/, /sessionStorage/, /preventDefault/, /stopPropagation/]) {
    assert.doesNotMatch(index, banned);
  }
});

test("H25: telemetry docs list every payload key and stay honest", async () => {
  const { PAYLOAD_KEYS } = await import("../../src/telemetry.ts");
  const page = read("site/src/content/docs/telemetry.md");
  const readme = read("README.md");
  for (const doc of [page, readme]) {
    for (const key of PAYLOAD_KEYS) assert.ok(doc.includes(`\`${key}\``), `docs missing ${key}`);
    assert.match(doc, /opt-in/i);
    assert.match(doc, /off by default/i);
    assert.match(doc, /DO_NOT_TRACK/);
    assert.match(doc, /no cookies/i);
    assert.match(doc, /not shipped in 0\.5\.2/);
    assert.match(doc, /ships in 0\.6\.0/);
    assert.match(doc, /collector at `t\.gatefit\.io` is live/);
    assert.match(doc, /gatefit telemetry off/);
    assert.match(doc, /t\.gatefit\.io/);
    for (const banned of [/coming soon/i, /\$19/, /monthly/i, /optional updates/i, /fixture goldens/i, /names match the goldens/i, /docs live at/i, /checkout is live/i]) {
      assert.doesNotMatch(doc, banned);
    }
  }
});

// GATEFIT-H40 /contact. Real channels only: GitHub Issues, @gatefitio,
// mailto:dev@gatefit.io, and the Polar Checkout Link already used by the site.
// One address. No form. Nav and footer on every chrome page, including /status.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_POLAR_CHECKOUT_URL } from "../../site/src/lib/polarCheckout.ts";

const root = path.join(import.meta.dirname, "../..");
const CONTACT = "site/src/pages/contact.astro";
const ISSUES = "https://github.com/gatefit/gatefit/issues";
const X = "https://x.com/gatefitio";
const ADDRESS = "dev@gatefit.io";
const MAILTO = `mailto:${ADDRESS}`;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAILTO_RE = /mailto:[^\s"'<>]+/gi;

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function filesUnder(rel: string): string[] {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(`${rel}/${entry.name}`) : [`${rel}/${entry.name}`],
  );
}

function region(html: string, tag: "nav" | "footer"): string {
  const open = html.indexOf(`<${tag}`);
  const close = html.indexOf(`</${tag}>`);
  assert.ok(open >= 0 && close > open, `missing <${tag}>`);
  return html.slice(open, close);
}

function hasIssueTemplates(): boolean {
  const single = path.join(root, ".github/ISSUE_TEMPLATE.md");
  if (fs.existsSync(single)) return true;
  const dir = path.join(root, ".github/ISSUE_TEMPLATE");
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => !name.startsWith("."));
}

test("contact page lists GitHub Issues, X, the Polar checkout link, and dev@gatefit.io", () => {
  const page = read(CONTACT);
  assert.match(page, /Bugs and questions/);
  if (hasIssueTemplates()) {
    assert.match(page, /href="https:\/\/github\.com\/gatefit\/gatefit\/issues\/new/);
  } else {
    assert.match(page, new RegExp(`href="${ISSUES.replaceAll("/", "\\/")}"`));
    assert.doesNotMatch(page, /\/issues\/new/);
  }
  assert.match(page, /href="https:\/\/x\.com\/gatefitio"/);
  assert.match(page, /@gatefitio/);
  assert.match(page, new RegExp(`href="${MAILTO}"`));
  assert.match(page, /resolvePolarCheckoutUrl\(import\.meta\.env\.PUBLIC_POLAR_CHECKOUT_URL\)/);
  assert.match(page, /href=\{checkoutUrl\}/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener"/);
  assert.equal(
    DEFAULT_POLAR_CHECKOUT_URL,
    "https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0",
  );
  assert.doesNotMatch(page, /customer-portal|polar\.sh\/gatefit|buy\.polar\.sh\/products/);
  assert.match(
    page,
    /The \$49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs\./,
  );
  assert.match(page, /The core, Phase 2, and S1–S12 \(17 goldens\) stay free\./);
  assert.equal(X, "https://x.com/gatefitio");
});

test("contact page has one mailto and no form; no other address is on the site", () => {
  const page = read(CONTACT);
  const pageEmails = page.match(EMAIL_RE) ?? [];
  const pageMailtos = page.match(MAILTO_RE) ?? [];
  assert.ok(pageEmails.length > 0, "missing dev@gatefit.io");
  assert.ok(pageMailtos.length > 0, "missing mailto:dev@gatefit.io");
  assert.deepEqual([...new Set(pageEmails)], [ADDRESS]);
  assert.deepEqual([...new Set(pageMailtos)], [MAILTO]);
  assert.doesNotMatch(page, /<form\b/i);
  assert.doesNotMatch(page, /<\/form>/i);

  const siteFiles = filesUnder("site/src").filter((rel) => /\.(astro|md|mdx|css|ts|mjs)$/.test(rel));
  assert.ok(siteFiles.includes(CONTACT));
  for (const file of siteFiles) {
    const text = read(file);
    for (const email of text.match(EMAIL_RE) ?? []) assert.equal(email, ADDRESS, file);
    for (const mailto of text.match(MAILTO_RE) ?? []) assert.equal(mailto, MAILTO, file);
  }
});

test("nav and footer link to /contact on every page, including /status", () => {
  const dir = path.join(root, "site/src/pages");
  const pages = fs.readdirSync(dir).filter((name) => name.endsWith(".astro")).sort();
  assert.ok(pages.includes("index.astro"));
  assert.ok(pages.includes("status.astro"));
  assert.ok(pages.includes("contact.astro"));
  for (const name of pages) {
    const html = read(`site/src/pages/${name}`);
    if (name === "polar.astro") {
      assert.match(html, /location\.replace\('\/#pricing'\)/);
      assert.doesNotMatch(html, /<nav\b/, "polar is an instant redirect and has no nav");
      assert.doesNotMatch(html, /<footer\b/);
      assert.doesNotMatch(html, /mailto:/i);
      assert.doesNotMatch(html, /<form\b/i);
      continue;
    }
    assert.match(region(html, "nav"), /href="\/contact\/"/, `${name} nav`);
    assert.match(region(html, "footer"), /href="\/contact\/"/, `${name} footer`);
  }

  const cfg = read("site/astro.config.mjs");
  assert.match(cfg, /\{ label: 'Contact', link: '\/contact\/' \}/);
  assert.match(cfg, /Footer: '\.\/src\/components\/docs\/Footer\.astro'/);
  assert.match(cfg, /SocialIcons: '\.\/src\/components\/docs\/SocialIcons\.astro'/);
  const footer = read("site/src/components/docs/Footer.astro");
  assert.match(region(footer, "footer"), /href="\/contact\/"/, "docs footer");
  assert.match(read("site/src/components/docs/SocialIcons.astro"), /href="\/contact\/"/);
});

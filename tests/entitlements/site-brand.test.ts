import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const OG_URL = "https://gatefit.io/og.png";
const ICONS = ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "og.png"];

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function heads(): Array<[string, string]> {
  return [
    ["landing", read("site/src/pages/index.astro")],
    ["docs", read("site/astro.config.mjs")],
  ];
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function pngSize(buf: Buffer): [number, number] {
  assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", "not a PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("H27: both heads reference every brand icon and the files exist", () => {
  for (const [name, src] of heads()) {
    for (const icon of ICONS) assert.ok(src.includes(`/${icon}`), `${name} head missing ${icon}`);
  }
  for (const icon of ICONS) {
    assert.ok(fs.existsSync(path.join(root, "site/public", icon)), `site/public/${icon} missing`);
  }
});

test("H27: both heads carry og:image and twitter:image for the 1200x630 card", () => {
  for (const [name, src] of heads()) {
    for (const key of ["og:image", "twitter:image"]) {
      const re = new RegExp(`['"]${key}['"][^}>]*${OG_URL.replace(/[./]/g, "\\$&")}`);
      assert.match(src, re, `${name} ${key}`);
    }
    assert.match(src, /['"]twitter:card['"][^}>]*summary_large_image/, `${name} twitter:card`);
    assert.match(src, /['"]og:image:width['"][^}>]*1200/, `${name} og:image:width`);
    assert.match(src, /['"]og:image:height['"][^}>]*630/, `${name} og:image:height`);
  }
  assert.doesNotMatch(read("site/src/pages/polar.astro"), /og:image|favicon|cloudflareinsights/);
});

test("H27: rendered image sizes (OG 1200x630, apple-touch 180, ICO 16+32)", () => {
  const pub = (f: string) => fs.readFileSync(path.join(root, "site/public", f));
  assert.deepEqual(pngSize(pub("og.png")), [1200, 630]);
  assert.deepEqual(pngSize(pub("apple-touch-icon.png")), [180, 180]);
  assert.deepEqual(pngSize(pub("favicon-32.png")), [32, 32]);
  const ico = pub("favicon.ico");
  assert.equal(ico.readUInt16LE(2), 1, "ICO type");
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32]);
});

test("H27: brand palette tokens replace the old amber everywhere on the site", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  assert.equal(BRAND.navy, "#0B1B3A");
  assert.equal(BRAND.mint, "#5EE0A8");
  for (const css of ["site/src/styles/landing.css", "site/src/styles/docs.css"]) {
    const src = read(css).toUpperCase();
    assert.ok(src.includes("#0B1B3A"), `${css} navy`);
    assert.ok(src.includes("#5EE0A8"), `${css} mint`);
  }
  assert.match(read("site/src/pages/index.astro"), /name="theme-color" content="#0B1B3A"/);
  const files = [...walk(path.join(root, "site/src")), ...walk(path.join(root, "site/public")),
    ...walk(path.join(root, "site/brand"))].filter((f) => /\.(css|astro|ts|mjs|svg|md|mdx)$/.test(f));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const old of [/f5b83d/i, /245,\s*184,\s*61/, /#0a0a0b/i, /3fcf8e/i, /63,\s*207,\s*142/]) {
      assert.doesNotMatch(src, old, `${path.relative(root, f)} still has ${old}`);
    }
  }
});

function over(fg: string, alpha: number, bg: string): string {
  return "#" + [1, 3, 5].map((i) => {
    const c = parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha);
    return Math.round(c).toString(16).padStart(2, "0");
  }).join("");
}

// Every top-level block for selector, joined (a selector can be declared more than once).
function rule(css: string, selector: string): string {
  const blocks: string[] = [];
  for (let i = css.indexOf(`\n${selector} {`); i >= 0; i = css.indexOf(`\n${selector} {`, i + 1)) {
    blocks.push(css.slice(i, css.indexOf("}", i)));
  }
  assert.ok(blocks.length > 0, `missing rule ${selector}`);
  return blocks.join("\n");
}

test("H27: text tokens pass WCAG AA on navy and surface; CTA navy-on-mint passes", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  for (const bg of [BRAND.navy, BRAND.navyDeep, BRAND.surface]) {
    for (const k of ["text", "body", "muted", "faint", "mint", "red", "redHigh"] as const) {
      const ratio = contrast(BRAND[k], bg);
      assert.ok(ratio >= 4.5, `${k} ${BRAND[k]} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.ok(contrast(BRAND.navy, BRAND.mint) >= 4.5, "CTA navy on mint");
  assert.ok(contrast(BRAND.navy, BRAND.mintHigh) >= 4.5, "CTA hover navy on mint-high");
  assert.ok(contrast(BRAND.mintHigh, BRAND.mintLow) >= 4.5, "chip text on mint-low");
  // The CSS must use the same values the test checked.
  const landing = read("site/src/styles/landing.css").toUpperCase();
  for (const k of ["navy", "surface", "surface2", "text", "body", "muted", "faint", "mint", "red", "redHigh"] as const) {
    assert.ok(landing.includes(BRAND[k].toUpperCase()), `landing.css missing ${k} ${BRAND[k]}`);
  }
});

// H35: the redesigned landing. Red is a tint behind the leaking row and the failed tag; text on it
// is red-high, mint, or muted. Small labels on the raised surface-2 (events, chips).
test("H35: text on surface-2 (events, chips) passes WCAG AA", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const landing = read("site/src/styles/landing.css");
  for (const k of ["text", "body", "muted", "mint", "redHigh"] as const) {
    const ratio = contrast(BRAND[k], BRAND.surface2);
    assert.ok(ratio >= 4.5, `${k} ${BRAND[k]} on surface-2 is ${ratio.toFixed(2)}:1`);
  }
  for (const sel of [".ev", ".chip"]) {
    assert.match(rule(landing, sel), /background: var\(--surface-2\)/, `${sel} sits on surface-2`);
    assert.match(rule(landing, sel), /color: var\(--(body|text)\)/, `${sel} text colour`);
  }
  assert.match(rule(landing, ".chip-row"), /color: var\(--mint\)/);
});

// H36: golden labels sit on the surface. Outcome stamps are navy text on mint or brand red.
test("H36: golden labels and outcome pills pass WCAG AA", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const landing = read("site/src/styles/landing.css");
  const pairs: Array<[string, string, string]> = [
    [".golden-label on surface", BRAND.text, BRAND.surface],
    [".golden-detail on surface", BRAND.muted, BRAND.surface],
    [".golden-id on surface", BRAND.muted, BRAND.surface],
    [".cat-h on navy", BRAND.text, BRAND.navy],
    [".cat-icon", BRAND.mintHigh, BRAND.mintLow],
    [".outcome-kept", BRAND.navy, BRAND.mint],
    [".outcome-revoked", BRAND.navy, BRAND.red],
    [".outcome-locked", BRAND.navy, BRAND.red],
    [".outcome-unchanged", BRAND.text, BRAND.surface2],
  ];
  for (const [what, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
  assert.match(rule(landing, ".golden-row"), /background: var\(--surface\)/);
  assert.match(rule(landing, ".golden-label"), /color: var\(--text\)/);
  assert.match(rule(landing, ".golden-detail"), /color: var\(--muted\)/);
  assert.match(rule(landing, ".golden-id"), /color: var\(--muted\)/);
  assert.match(rule(landing, ".cat-h"), /color: var\(--text\)/);
  assert.match(rule(landing, ".cat-icon"), /background: var\(--mint-low\)/);
  assert.match(rule(landing, ".cat-icon"), /color: var\(--mint-high\)/);
  assert.match(rule(landing, ".outcome-kept"), /background: var\(--mint\)/);
  assert.match(rule(landing, ".outcome-kept"), /color: var\(--navy\)/);
  assert.match(rule(landing, ".outcome-revoked"), /background: var\(--red\)/);
  assert.match(rule(landing, ".outcome-revoked"), /color: var\(--navy\)/);
  assert.match(rule(landing, ".outcome-locked"), /background: var\(--red\)/);
  assert.match(rule(landing, ".outcome-locked"), /color: var\(--navy\)/);
  assert.match(rule(landing, ".outcome-unchanged"), /background: var\(--surface-2\)/);
  assert.match(rule(landing, ".outcome-unchanged"), /color: var\(--text\)/);
});

test("H35: leak text passes WCAG AA over its red tints (access row, failed tag, failed event)", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const landing = read("site/src/styles/landing.css");
  const tint = (selector: string, rgb: string) => {
    const m = new RegExp(`rgba\\(${rgb}, ([\\d.]+)\\)`).exec(rule(landing, selector));
    assert.ok(m, `${selector} tint not found`);
    return Number(m[1]);
  };
  const row = over(BRAND.red, tint(".row-bad", "242, 85, 90"), BRAND.surface);
  const tag = over(BRAND.red, tint(".frame-tag.bad", "242, 85, 90"), BRAND.navyDeep);
  const evN = over(BRAND.red, tint(".ev-bad .ev-n", "242, 85, 90"), BRAND.surface2);
  const okN = over(BRAND.mint, tint(".ev-n", "var\\(--mint-rgb\\)"), BRAND.surface2);
  const pairs: Array<[string, string, string]> = [
    [".row-bad .got", BRAND.redHigh, row],
    [".row-bad .want", BRAND.mint, row],
    [".row-bad .k", BRAND.muted, row],
    [".row-bad td", BRAND.body, row],
    [".frame-tag.bad", BRAND.redHigh, tag],
    [".ev-bad .ev-n", BRAND.redHigh, evN],
    [".ev-n", BRAND.mint, okN],
    [".run-log .bad on navy-deep", BRAND.redHigh, BRAND.navyDeep],
  ];
  for (const [what, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
  assert.match(rule(landing, ".row-bad .got"), /color: var\(--red-high\)/);
  assert.match(rule(landing, ".row-bad .k"), /color: var\(--muted\)/);
  assert.match(rule(landing, ".frame-tag.bad"), /color: var\(--red-high\)/);
  assert.match(rule(landing, ".ev-bad .ev-n"), /color: var\(--red-high\)/);
  // Base red and faint are never text on the landing; base red is only a fill or a border.
  assert.doesNotMatch(landing, /[^-]color: var\(--(red|faint)\)/, "base red or faint used as text");
});

test("H35: the one loop (leaking event pulse) is a border, still under reduced motion", () => {
  const landing = read("site/src/styles/landing.css");
  const motion = landing.slice(landing.indexOf("@media (prefers-reduced-motion: no-preference) {\n\t.ev-bad::after"));
  assert.ok(motion.length > 0, "pulse lives inside a no-preference block");
  assert.match(motion, /animation: leak-pulse 3s/);
  assert.match(landing, /@keyframes leak-pulse \{.*opacity: 0\.8/);
  assert.doesNotMatch(motion.slice(0, motion.indexOf("\n}")), /background:/, "pulse paints no fill under text");
});

test("H27: brand images come from committed outlined SVG sources", () => {
  for (const f of ["site/brand/favicon.svg", "site/brand/og.svg"]) {
    const svg = read(f);
    assert.doesNotMatch(svg, /<text\b/, `${f} must be outlined paths only`);
    assert.doesNotMatch(svg, /<image\b|href="http/, `${f} must be self-contained`);
  }
  // Byte-identical re-render (`brand-assets.mjs --check`) needs sharp from site/node_modules,
  // so ./ci-local.sh runs it after the site/ install instead of here.
  assert.match(read("site/package.json"), /"brand":\s*"node scripts\/brand-assets\.mjs"/);
});

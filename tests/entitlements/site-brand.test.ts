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

test("H27: text on the raised surface-2 (.sim, .dial-card) and the leak pill passes WCAG AA", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const dial = read("site/src/styles/dial.css");
  const landing = read("site/src/styles/landing.css");
  // The leak pill is a translucent red tint over surface-2; check its composited colour.
  const tint = /\.dial-leak \{[^}]*background: rgba\(242, 85, 90, ([\d.]+)\)/.exec(dial);
  assert.ok(tint, "dial-leak tint not found");
  const pill = over(BRAND.red, Number(tint[1]), BRAND.surface2);
  for (const k of ["text", "body", "muted", "mint", "redHigh"] as const) {
    const ratio = contrast(BRAND[k], BRAND.surface2);
    assert.ok(ratio >= 4.5, `${k} ${BRAND[k]} on surface-2 is ${ratio.toFixed(2)}:1`);
  }
  const pillRatio = contrast(BRAND.redHigh, pill);
  assert.ok(pillRatio >= 4.5, `redHigh on leak pill ${pill} is ${pillRatio.toFixed(2)}:1`);
  // faint and base red fail on surface-2, so the labels there must not use them.
  assert.match(rule(landing, ".sim-top"), /color: var\(--muted\)/, ".sim-top colour");
  assert.match(rule(dial, ".dial-card-kicker"), /color: var\(--muted\)/, ".dial-card-kicker colour");
  assert.match(rule(dial, ".dial-leak"), /color: var\(--red-high\)/, ".dial-leak colour");
  for (const [sel, css] of [[".dial-card", dial], [".sim", landing]] as const) {
    assert.doesNotMatch(rule(css, sel), /color: var\(--(faint|red)\)/, `${sel} text colour`);
  }
});

test("H27: red leak text passes WCAG AA over its red tints and glow (hero .db-leak, dial pills, mobile node)", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const dial = read("site/src/styles/dial.css");
  const landing = read("site/src/styles/landing.css");
  const red = (css: string, selector: string) => {
    const m = /rgba\(242, 85, 90, ([\d.]+)\)/.exec(rule(css, selector));
    assert.ok(m, `${selector} red tint not found`);
    return Number(m[1]);
  };
  // Hero: 8% tint over the surface, then the ::after glow at its centre (gradient alpha x opacity).
  const glowRule = rule(landing, ".db-leak::after");
  const glowOpacity = Number(/opacity: ([\d.]+)/.exec(glowRule)?.[1]);
  assert.ok(glowOpacity > 0, ".db-leak::after opacity not found");
  const tinted = over(BRAND.red, red(landing, ".db-leak"), BRAND.surface);
  const glow = over(BRAND.red, red(landing, ".db-leak::after") * glowOpacity, tinted);
  // Dial pills on the dial face (navy) carry the .dial-leak tint.
  const navyPill = over(BRAND.red, red(dial, ".dial-leak"), BRAND.navy);
  const pairs: Array<[string, string, string]> = [
    ["leak-callout on .db-leak tint", BRAND.redHigh, tinted],
    ["leak-callout under .db-leak glow", BRAND.redHigh, glow],
    [".db-leak .k under glow", BRAND.muted, glow],
    [".db-leak value under glow", BRAND.body, glow],
    ["dial pill on navy", BRAND.redHigh, navyPill],
    [".m-node .red on surface", BRAND.red, BRAND.surface],
  ];
  for (const [what, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
  assert.match(rule(landing, ".leak-callout"), /color: var\(--red-high\)/, ".leak-callout colour");
  assert.match(rule(landing, ".db-leak .k"), /color: var\(--muted\)/, ".db-leak .k colour");
  assert.match(rule(landing, ".m-node .red"), /color: var\(--red\)/, ".m-node .red colour (checked on surface)");
  // No .dial-leak variant falls back to base red text.
  assert.doesNotMatch(dial, /\.dial-leak[^{]*\{[^}]*[^-]color: var\(--red\)/, "a .dial-leak rule uses base red text");
});

// Peak opacity a glow reaches: its static opacity, or the highest keyframe of any animation
// that targets it (e.g. the no-JS `breathe` loop on .db-leak::after peaks at 0.9).
function peakOpacity(css: string, selector: string): number {
  let peak = Number(/opacity: ([\d.]+)/.exec(rule(css, selector))?.[1]);
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const targets = new RegExp(`[^{}]*${esc}\\s*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(targets)) {
    const anim = /animation:\s*([\w-]+)/.exec(m[1]!);
    if (!anim) continue;
    const kf = new RegExp(`@keyframes ${anim[1]} \\{(.*)\\}`).exec(css);
    assert.ok(kf, `@keyframes ${anim[1]} not found`);
    for (const o of kf[1]!.matchAll(/opacity: ([\d.]+)/g)) peak = Math.max(peak, Number(o[1]));
  }
  return peak;
}

test("H29: text passes WCAG AA at the glow peak (hero .db-leak breathe, flow .node red glow)", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const landing = read("site/src/styles/landing.css");
  const red = (selector: string) => {
    const m = /rgba\(242, 85, 90, ([\d.]+)\)/.exec(rule(landing, selector));
    assert.ok(m, `${selector} red tint not found`);
    return Number(m[1]);
  };
  // Hero: 8% tint, then the ::after glow centre at its animated peak.
  const peak = peakOpacity(landing, ".db-leak::after");
  assert.ok(peak >= 0.9, `.db-leak::after peak ${peak} (breathe reaches 0.9)`);
  const tinted = over(BRAND.red, red(".db-leak"), BRAND.surface);
  const dbGlow = over(BRAND.red, red(".db-leak::after") * peak, tinted);
  // Flow node: 16% tint, then the ::after glow centre (the .red span peaks at opacity 1).
  const nodeTint = over(BRAND.red, red(".node .red"), BRAND.surface);
  const nodeGlow = over(BRAND.red, red(".node .red::after") * peakOpacity(landing, ".node .red::after"), nodeTint);
  const pairs: Array<[string, string, string]> = [
    ["leak-callout at .db-leak glow peak", BRAND.redHigh, dbGlow],
    [".db-leak .k at glow peak", BRAND.muted, dbGlow],
    [".db-leak value at glow peak", BRAND.body, dbGlow],
    [".node h3 on red tint", BRAND.muted, nodeTint],
    [".node h3 at red glow centre", BRAND.muted, nodeGlow],
    [".node p at red glow centre", BRAND.body, nodeGlow],
  ];
  for (const [what, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
  // .node h3 must not use faint (4.30:1 on the tint alone).
  assert.match(rule(landing, ".node h3"), /color: var\(--muted\)/, ".node h3 colour");
  // The glows are absolutely positioned; the text must paint above them, or the glow
  // tints the glyphs too and the ratios above overstate contrast.
  assert.match(rule(landing, ".db-leak > *"), /position: relative; z-index: 1/, ".db-leak text above its ::after glow");
  assert.match(rule(landing, ".node h3"), /position: relative/, ".node h3 above the .red overlay");
});

test("H29: the dispute station .dial-halo glow stays clear of its .dial-label text", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const dial = read("site/src/styles/dial.css");
  const astro = read("site/src/components/AccessDial.astro");
  const halo = rule(dial, ".dial-halo");
  const z = (css: string) => Number(/z-index: (\d+)/.exec(css)?.[1]);
  assert.ok(z(rule(dial, ".dial-label")) > z(halo), "labels paint above the halo");
  // Halo radius at its largest keyframe scale vs the leak label's cqw gap from the station centre.
  const radius = Number(/width: ([\d.]+)cqw/.exec(halo)?.[1]) / 2;
  const kf = /@keyframes dial-halo \{([\s\S]*?)\n\}/.exec(dial);
  assert.ok(kf, "@keyframes dial-halo not found");
  const scale = Math.max(1, ...[...kf[1]!.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1])));
  const gap = Number(/station\.leak \? '([\d.]+)cqw'/.exec(astro)?.[1]);
  const offset = Number(/\$\{gap\} \+ (\d+)px\)/.exec(astro)?.[1]);
  assert.ok(gap >= radius * scale, `leak label gap ${gap}cqw inside halo ${radius * scale}cqw`);
  // Pixels left between the ring's outer edge (border included) and the label's right edge.
  const border = Number(/border: (\d+)px solid/.exec(halo)?.[1]);
  const clear = offset - border;
  // CSS blur is a Gaussian with sigma = blur / 2; residual shadow alpha at the label edge.
  const shadow = /box-shadow: 0 0 (\d+)px rgba\(242, 85, 90, ([\d.]+)\)/.exec(halo);
  assert.ok(shadow, ".dial-halo box-shadow not found");
  const sigma = Number(shadow[1]) / 2;
  const erf = (x: number) => {
    const t = 1 / (1 + 0.3275911 * x);
    const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return 1 - y * Math.exp(-x * x);
  };
  const residual = Number(shadow[2]) * (1 - 0.5 * (1 + erf(clear / sigma / Math.SQRT2)));
  const bg = over(BRAND.red, residual, BRAND.navy);
  const tint = /\.dial-leak \{[^}]*background: rgba\(242, 85, 90, ([\d.]+)\)/.exec(dial);
  assert.ok(tint, "dial-leak tint not found");
  const pairs: Array<[string, string, string]> = [
    [".dial-name by the halo", BRAND.muted, bg],
    [".dial-chip by the halo", BRAND.mint, over(BRAND.mint, 0.1, bg)],
    ["leak pill by the halo", BRAND.redHigh, over(BRAND.red, Number(tint[1]), bg)],
  ];
  for (const [what, fg, back] of pairs) {
    const ratio = contrast(fg, back);
    assert.ok(ratio >= 4.5, `${what} (shadow alpha ${residual.toFixed(3)}): ${fg} on ${back} is ${ratio.toFixed(2)}:1`);
  }
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

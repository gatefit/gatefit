// GATEFIT-H30 /status page fail modes. Static sources plus the pure view model in
// site/src/scripts/status.ts; the DOM glue there is not run here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  STATUS_URL,
  loadStatus,
  loadStats,
  parseStats,
  parseStatus,
  statusView,
  usageView,
} from "../../site/src/scripts/status.ts";

const root = path.join(import.meta.dirname, "../..");
const NOW = new Date("2026-11-03T12:00:00Z");
const IDS = ["site", "npm", "telemetry", "action", "polar"] as const;
const CF_BEACON_TOKEN = "82ff14a5563c492d869b6db741aac128";

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function days(state = "ok", up: number | null = 100) {
  const out = [];
  for (let k = 89; k >= 0; k--) {
    const d = new Date(Date.parse("2026-11-03T00:00:00Z") - k * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: d, up_pct: state === "none" ? null : up, state });
  }
  return out;
}

function payload(states: Partial<Record<(typeof IDS)[number], string>> = {}, checkedAt = "2026-11-03T11:55:00.000Z") {
  return {
    checked_at: checkedAt,
    services: IDS.map((id) => ({
      id,
      state: states[id] ?? "ok",
      ...(id === "npm" || id === "action" ? { version: "9.9.9" } : {}),
      days: days(),
    })),
  };
}

function fetchReturning(make: () => Promise<Response>): typeof fetch {
  return (async () => make()) as unknown as typeof fetch;
}

test("status page inlines exactly one Cloudflare beacon with the token", () => {
  const page = read("site/src/pages/status.astro");
  assert.equal((page.match(/cloudflareinsights/g) ?? []).length, 1);
  assert.ok(page.includes(CF_BEACON_TOKEN));
  assert.doesNotMatch(read("site/src/pages/polar.astro"), /cloudflareinsights/);
});

test("Status is in the landing nav, the docs sidebar, and the status page nav without a Buy CTA", () => {
  const index = read("site/src/pages/index.astro");
  assert.match(index, /<a class="nav-link" href="\/status\/">Status<\/a>/);
  assert.equal((index.match(/class="nav-link"/g) ?? []).length, 4);
  assert.match(read("site/astro.config.mjs"), /\{ label: 'Status', link: '\/status\/' \}/);
  const page = read("site/src/pages/status.astro");
  assert.match(page, /<header class="site-nav">/);
  assert.match(page, /<a class="nav-link" href="\/status\/" aria-current="page">Status<\/a>/);
  for (const href of ["/quickstart/", "/action/", "/#pricing"]) assert.ok(page.includes(`class="nav-link" href="${href}"`), href);
  assert.doesNotMatch(page, /PolarBuyCta|data-gf-buy|\/pricing\/"/);
});

test("status page ships no sample data, no hard-coded versions, and no state switch", () => {
  for (const f of ["site/src/pages/status.astro", "site/src/scripts/status.ts", "site/src/styles/status.css"]) {
    const src = read(f);
    assert.doesNotMatch(src, /STATS\s*=|TODAY\s*=|history\(|rng\(|SAMPLE/, f);
    assert.doesNotMatch(src, /\b0\.6\.0\b|v0\.6\.0/, f);
    assert.doesNotMatch(src, /\?state=|URLSearchParams/, f);
    assert.doesNotMatch(src, /\b(TR|UTC\+3)\b/, f);
  }
  const page = read("site/src/pages/status.astro");
  assert.match(page, /Status unknown/);
  assert.doesNotMatch(page, /All systems operational|Operational</);
});

test("status script stores nothing, never uses innerHTML, and times out its fetches", () => {
  const src = read("site/src/scripts/status.ts");
  for (const banned of [/cookie/i, /localStorage/, /sessionStorage/, /indexedDB/, /innerHTML|outerHTML|insertAdjacentHTML/]) {
    assert.doesNotMatch(src, banned);
  }
  assert.match(src, /textContent/);
  assert.match(src, /AbortSignal\.timeout\(5000\)|timeoutMs = 5000/);
  assert.equal(STATUS_URL, "https://t.gatefit.io/v1/status");
});

test("every fetch failure renders unknown for the banner and every tile, never ok", async () => {
  const failures: Array<[string, typeof fetch]> = [
    ["reject", fetchReturning(() => Promise.reject(new TypeError("network")))],
    ["timeout", fetchReturning(() => Promise.reject(new DOMException("timed out", "TimeoutError")))],
    ["500", fetchReturning(async () => new Response("{}", { status: 500 }))],
    ["404", fetchReturning(async () => new Response("not found", { status: 404 }))],
    ["bad JSON", fetchReturning(async () => new Response("{nope", { status: 200 }))],
    ["wrong shape", fetchReturning(async () => Response.json({ services: "all good" }))],
    ["missing services", fetchReturning(async () => Response.json({ checked_at: null }))],
    ["30 days", fetchReturning(async () => Response.json({ ...payload(), services: payload().services.map((s) => ({ ...s, days: s.days.slice(60) })) }))],
    ["bad state", fetchReturning(async () => Response.json(payload({ site: "green" })))],
  ];
  for (const [label, f] of failures) {
    const parsed = await loadStatus(f);
    assert.equal(parsed, null, label);
    const view = statusView(parsed, NOW);
    assert.equal(view.banner.state, "unknown", label);
    assert.equal(view.banner.text, "Status unknown", label);
    assert.equal(view.services.length, 5, label);
    for (const s of view.services) {
      assert.equal(s.state, "unknown", `${label} ${s.id}`);
      assert.equal(s.label, "Unknown", `${label} ${s.id}`);
      assert.equal(s.uptime, "—", `${label} ${s.id}`);
      assert.equal(s.ticks.length, 90);
      assert.ok(s.ticks.every((t) => t.state === "none"));
    }
    assert.equal(view.checkedAt, null, label);
    assert.equal(await loadStats(f, 30), null, label);
    const usage = usageView(null, 30, "2026-11-03");
    assert.equal(usage.available, false);
    assert.equal(usage.note, "Usage unavailable");
    assert.ok(usage.cards.every((c) => c.v === "—"));
  }
});

test("only five fresh ok services make the banner green", () => {
  const green = statusView(parseStatus(payload()), NOW);
  assert.equal(green.banner.state, "ok");
  assert.equal(green.banner.text, "All systems operational");
  const stale = statusView(parseStatus(payload({}, "2026-11-03T11:44:00.000Z")), NOW);
  assert.equal(stale.banner.state, "unknown", "checked_at 16 minutes old");
  assert.ok(stale.services.every((s) => s.state === "unknown"));
  const nullChecked = statusView(parseStatus(payload({}, null as unknown as string)), NOW);
  assert.equal(nullChecked.banner.state, "unknown");
  const partly = statusView(parseStatus(payload({ polar: "unknown" })), NOW);
  assert.equal(partly.banner.state, "unknown");
  assert.equal(partly.banner.text, "Status partly unknown");
  const missing = payload();
  missing.services = missing.services.filter((s) => s.id !== "action");
  const missingView = statusView(parseStatus(missing), NOW);
  assert.equal(missingView.banner.state, "unknown", "a missing service is not ok");
  assert.equal(missingView.services.find((s) => s.id === "action")!.state, "unknown");
  const deg = statusView(parseStatus(payload({ telemetry: "deg", polar: "unknown" })), NOW);
  assert.deepEqual(deg.banner, { state: "deg", text: "Degraded performance: t.gatefit.io" });
  const down = statusView(parseStatus(payload({ telemetry: "deg", polar: "down" })), NOW);
  assert.deepEqual(down.banner, { state: "down", text: "Partial outage: Polar checkout. Degraded: t.gatefit.io" });
  const unknownId = payload();
  (unknownId.services[0] as { id: string }).id = "mystery";
  assert.equal(parseStatus(unknownId), null, "unknown ids fail the strict parse");
});

test("versions, uptime, and ticks come from the API", () => {
  const p = payload();
  p.services[0]!.days = days("ok", 100).map((d, i) => (i < 88 ? { ...d, up_pct: null, state: "none" } : i === 88 ? { ...d, up_pct: 99, state: "ok" } : d));
  const view = statusView(parseStatus(p), NOW);
  const site = view.services.find((s) => s.id === "site")!;
  assert.equal(site.uptime, "99.50");
  assert.equal(site.ticks.filter((t) => t.state === "none").length, 88);
  assert.match(site.ticks[88]!.title, /2026-11-02/);
  assert.equal(view.services.find((s) => s.id === "npm")!.detail, "gatefit@9.9.9");
  assert.equal(view.services.find((s) => s.id === "action")!.detail, "gatefit/gatefit@v9.9.9");
  const none = statusView(null, NOW);
  assert.equal(none.services.find((s) => s.id === "npm")!.detail, "—");
  assert.equal(view.checkedAt, "2026-11-03T11:55:00.000Z");
});

test("usage cards count runs, init, buy clicks, and only provider packs", () => {
  const row = (day: string, o: Record<string, string>, n: number) => ({
    day, kind: "cli", command: "", version: "", node: "", platform: "", arch: "", outcome: "",
    template: "", pack: "", suite: "", event: "", ...o, n,
  });
  const stats = parseStats({
    counts: [
      row("2026-11-03", { command: "run", pack: "chaos" }, 3),
      row("2026-11-02", { command: "run", pack: "paddle" }, 2),
      row("2026-11-02", { command: "init" }, 1),
      row("2026-11-02", { command: "run", pack: "evil" }, 1),
      row("2026-11-01", { kind: "site", event: "buy_click" }, 4),
      row("2026-09-01", { command: "run", pack: "polar" }, 9),
    ],
    installs: [],
  });
  assert.ok(stats);
  const usage = usageView(stats, 7, "2026-11-03");
  assert.equal(usage.available, true);
  assert.deepEqual(usage.cards.map((c) => [c.k, c.v]), [
    ["gatefit run", "6"],
    ["gatefit init", "1"],
    ["Buy clicks", "4"],
    ["Provider packs", "2"],
  ]);
  assert.equal(usage.bars.length, 7);
  assert.equal(usage.bars[6]!.day, "2026-11-03");
  assert.equal(usage.from, "2026-10-28");
  assert.equal(parseStats({ counts: [{ day: 1 }], installs: [] }), null);
  assert.equal(parseStats({ counts: "x" }), null);
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function over(fg: string, alpha: number, bg: string): string {
  return "#" + [1, 3, 5].map((i) => {
    const c = parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha);
    return Math.round(c).toString(16).padStart(2, "0");
  }).join("");
}

function rgb(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
}

function rule(css: string, selector: string): string {
  const blocks: string[] = [];
  for (let i = css.indexOf(`\n${selector} {`); i >= 0; i = css.indexOf(`\n${selector} {`, i + 1)) {
    blocks.push(css.slice(i, css.indexOf("}", i)));
  }
  assert.ok(blocks.length > 0, `missing rule ${selector}`);
  return blocks.join("\n");
}

test("status text passes WCAG AA on navy, the surface, and the banner tints; fills reach 3:1", async () => {
  const { BRAND } = await import("../../site/src/lib/brand.ts");
  const b = BRAND as Record<string, string>;
  for (const k of ["amber", "unknown", "tickEmpty"]) assert.match(b[k] ?? "", /^#[0-9A-F]{6}$/i, k);
  for (const bg of [BRAND.navy, BRAND.surface]) {
    for (const k of ["text", "amber", "redHigh", "muted", "faint", "mint"]) {
      const ratio = contrast(b[k]!, bg);
      assert.ok(ratio >= 4.5, `${k} ${b[k]} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    for (const k of ["unknown", "tickEmpty", "mint", "amber", "red"]) {
      const ratio = contrast(b[k]!, bg);
      assert.ok(ratio >= 3, `fill ${k} ${b[k]} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
  const css = read("site/src/styles/status.css");
  for (const k of ["amber", "unknown", "tickEmpty", "redHigh"]) assert.ok(css.toUpperCase().includes(b[k]!.toUpperCase()), `status.css ${k}`);
  const tints: Array<[string, string]> = [
    [".banner.ok", BRAND.mint],
    [".banner.deg", b.amber!],
    [".banner.down", BRAND.red],
    [".banner.unknown", BRAND.muted],
  ];
  for (const [sel, fg] of tints) {
    const m = new RegExp(`background: rgba\\(${rgb(fg)}, ([\\d.]+)\\)`).exec(rule(css, sel));
    assert.ok(m, `${sel} tint not found`);
    const bg = over(fg, Number(m[1]), BRAND.navy);
    for (const k of ["text", "muted"]) {
      const ratio = contrast(b[k]!, bg);
      assert.ok(ratio >= 4.5, `${k} on ${sel} ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.match(rule(css, ".state.down"), /color: var\(--red-high\)/);
  assert.match(rule(css, ".state.deg"), /color: var\(--amber\)/);
  assert.match(rule(css, ".state.unknown"), /color: var\(--muted\)/);
  assert.doesNotMatch(css, /color: var\(--red\)/, "base red is not text on the status page");
  assert.doesNotMatch(css, /#FF8A8A/i);
});

test("new status copy stays honest and avoids banned phrases", () => {
  const changelog = read("CHANGELOG.md");
  const start = changelog.indexOf("## [Unreleased]");
  const unreleased = changelog.slice(start, changelog.indexOf("\n## [", start + 1));
  const telemetry = read("site/src/content/docs/telemetry.md");
  const readme = read("worker/telemetry/README.md");
  const texts: Array<[string, string]> = [
    ["status.astro", read("site/src/pages/status.astro")],
    ["status.ts", read("site/src/scripts/status.ts")],
    ["telemetry.md", telemetry],
    ["worker README", readme],
    ["[Unreleased]", unreleased],
  ];
  for (const [name, text] of texts) {
    for (const banned of [/coming soon/i, /fixture goldens/i, /names match the goldens/i, /docs live at/i, /checkout is live/i, /\$19/, /monthly/i, /optional updates/i]) {
      assert.doesNotMatch(text, banned, `${name} ${banned}`);
    }
  }
  assert.match(unreleased, /\/status/);
  assert.match(unreleased, /\/v1\/status/);
  assert.match(unreleased, /0002/);
  assert.match(unreleased, /redeploy/);
  assert.match(telemetry, /## Status page/);
  assert.match(telemetry, /in-process|inside the Worker/i);
  assert.match(telemetry, /30 minutes/);
  assert.match(telemetry, /90 days/);
  assert.match(telemetry, /not access/i);
  assert.match(readme, /0002/);
  assert.doesNotMatch(readme, /No retention job/);
});

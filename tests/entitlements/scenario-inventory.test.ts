import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const goldenDir = path.join(root, "tests/entitlements/goldens");

/**
 * Older release notes and the changelog record the suite that version shipped.
 * Current pages must follow the golden directory instead.
 */
const HISTORICAL = new Set([
  "CHANGELOG.md",
  "docs/release-v0.4.0.md",
  "docs/release-v0.5.0.md",
  "docs/release-v0.5.1.md",
  "docs/release-v0.5.2.md",
  "docs/release-v0.6.0.md",
  "docs/release-v0.7.0.md",
]);

/** Pages that state the current Stripe suite, not a derived landing count. */
const MUST_STATE_SUITE = [
  "README.md",
  "CLAUDE.md",
  ".cursor/skills/verify-gate/SKILL.md",
  "docs/bring-your-adapter.md",
  "docs/onboarding.md",
  "docs/chaos.md",
  "docs/license.md",
  "docs/live-clock.md",
  "docs/paddle.md",
  "docs/polar.md",
  "docs/publish.md",
  "docs/release-v0.8.0.md",
  "site/README.md",
  "site/src/content/docs/action.md",
  "site/src/content/docs/goldens.md",
  "site/src/content/docs/init.md",
  "site/src/content/docs/paddle-pack.md",
  "site/src/content/docs/polar-pack.md",
  "site/src/content/docs/onboarding.md",
  "site/src/content/docs/quickstart.md",
  "site/src/content/docs/telemetry.md",
  "src/init/templates/README.md.tpl",
  "src/packs/paddle/README.md",
  "src/packs/polar/README.md",
  "tests/entitlements/goldens/README.md",
  "worker/telemetry/README.md",
];

/** Files that name every Stripe golden, not a subset. */
const FULL_ID_LISTS = [
  "CLAUDE.md",
  ".cursor/skills/verify-gate/SKILL.md",
  "site/src/content/docs/goldens.md",
  "tests/entitlements/goldens/README.md",
];

const ROW = /^\| `([a-z0-9_]+)` \| ((?:S|H)\d+) \|/;

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function walk(rel: string, acc: string[]): void {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child, acc);
    else acc.push(child);
  }
}

function livingDocs(): string[] {
  const files = [
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
    "site/README.md",
    "worker/telemetry/README.md",
    "tests/entitlements/goldens/README.md",
    ".cursor/HARNESS.md",
    ".cursor/rules/gatefit-cloud.mdc",
    ".cursor/skills/verify-gate/SKILL.md",
    "src/packs/polar/README.md",
    "src/packs/paddle/README.md",
  ];
  for (const name of fs.readdirSync(path.join(root, "docs"))) {
    if (name.endsWith(".md")) files.push(`docs/${name}`);
  }
  for (const name of fs.readdirSync(path.join(root, "site/src/content/docs"))) {
    if (name.endsWith(".md")) files.push(`site/src/content/docs/${name}`);
  }
  for (const name of fs.readdirSync(path.join(root, "site/src/pages"))) {
    if (name.endsWith(".astro")) files.push(`site/src/pages/${name}`);
  }
  walk("src/init/templates", files);
  return files.filter((rel) => !HISTORICAL.has(rel));
}

function inventory() {
  const files = fs.readdirSync(goldenDir).filter((name) => name.endsWith(".yaml"));
  const ids = files.map((name) => name.slice(0, -".yaml".length)).sort();
  const rows: Array<{ id: string; pack: string }> = [];
  for (const line of read("tests/entitlements/goldens/README.md").split("\n")) {
    const match = ROW.exec(line);
    if (match) rows.push({ id: match[1], pack: match[2] });
  }
  const sNums = rows.filter((row) => row.pack.startsWith("S")).map((row) => Number(row.pack.slice(1)));
  sNums.sort((a, b) => a - b);
  return { ids, rows, sNums, count: ids.length, maxS: sNums.at(-1) ?? 0 };
}

test("stripe scenario lists and counts match tests/entitlements/goldens", () => {
  const { ids, rows, sNums, count, maxS } = inventory();
  assert.ok(count > 0, "golden directory is empty");
  assert.deepEqual(
    sNums,
    Array.from({ length: maxS }, (_, i) => i + 1),
    "S packs must be one file each, S1 through the last S",
  );
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    ids,
    "goldens README pack table must list every yaml and nothing else",
  );
  for (const id of ids) {
    const header = read(`tests/entitlements/goldens/${id}.yaml`).match(/^id:\s*(\S+)/m);
    assert.equal(header?.[1], id, `${id}.yaml id field`);
  }
  const suite = `S1–S${maxS}`;
  const countPhrase = `${count} goldens`;

  for (const rel of MUST_STATE_SUITE) {
    const text = read(rel);
    assert.ok(text.includes(suite), `${rel} must say ${suite}`);
    assert.ok(text.includes(countPhrase), `${rel} must say ${countPhrase}`);
  }

  for (const rel of FULL_ID_LISTS) {
    const mentioned = new Set(
      [...read(rel).matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]).filter((id) => ids.includes(id)),
    );
    assert.deepEqual([...mentioned].sort(), ids, `${rel} golden id list drifted`);
  }

  for (const rel of livingDocs()) {
    const text = read(rel);
    for (const match of text.matchAll(/S(\d+)–S(\d+)/g)) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      assert.ok(start >= 1 && start <= end && end <= maxS, `${rel} has S${start}–S${end} outside S1–S${maxS}`);
      if (start === 1 && end < maxS) {
        assert.ok(text.includes(suite), `${rel} says S1–S${end} without ${suite}`);
      }
    }
    for (const match of text.matchAll(/\b(\d+)\s+goldens\b/g)) {
      const at = match.index ?? 0;
      const prefix = text.slice(Math.max(0, at - 6), at);
      if (/Phase\s*$/.test(prefix)) continue;
      assert.equal(Number(match[1]), count, `${rel} says ${match[1]} goldens`);
    }
    assert.doesNotMatch(text, /S10–S12[^\n]{0,80}(unreleased|not yet|not shipped|not published|not in this release)/i, rel);
  }

  const index = read("site/src/pages/index.astro");
  const goldensSection = index.slice(index.indexOf('id="goldens"'), index.indexOf('id="pricing"'));
  assert.match(index, /\{sets\.sLabel\}/);
  assert.match(index, /\{groups\.total\}/);
  assert.doesNotMatch(goldensSection, /S1–S\d+/);
  assert.doesNotMatch(goldensSection, /\b\d+\s+goldens\b/);
});

test("telemetry probe rules stay one sentence across the docs", () => {
  const page = read("site/src/content/docs/telemetry.md");
  const start = page.indexOf("Each check has a 5-second timeout.");
  const tail = "Down and degraded from the Worker stay down and degraded.";
  const end = page.indexOf(tail, start);
  assert.ok(start >= 0 && end > start, "telemetry page is missing the probe rule");
  const rule = page.slice(start, end + tail.length);
  assert.match(rule, /5-second timeout/);
  assert.match(rule, /:00 and :30 runs/);
  assert.match(rule, /FUTURE_SKEW_MS/);
  assert.match(rule, /returns a non-200, or has a body the page cannot parse is unknown/);
  const copies = ["README.md", "worker/telemetry/README.md", "docs/paddle.md", "site/src/content/docs/telemetry.md"];
  for (const rel of copies) {
    const text = read(rel);
    assert.ok(text.includes(rule), `${rel} probe rule diverged from the telemetry page`);
    assert.equal(text.split("Each check has a 5-second timeout.").length - 1, 1, `${rel} probe rule count`);
  }
});

test("living docs do not leave 0.8.0 unpublished or call 0.7.0 current", () => {
  const stale = [
    /gatefit@0\.7\.0/,
    /v0\.7\.0 is already released/,
    /v0\.7\.0` is the last release/,
    /Tag `v0\.7\.0` is the last release/,
    /not published yet/,
    /does not publish `?0\.8\.0`?/,
    /does not publish that tag/,
    /does not publish it\b/,
    /tag is not cut/i,
    /That tag is not cut/,
    /0\.7\.0 is the current/i,
    /S10–S12 are unreleased/i,
  ];
  for (const rel of livingDocs()) {
    const text = read(rel);
    for (const re of stale) assert.doesNotMatch(text, re, `${rel} matches ${re}`);
  }
});

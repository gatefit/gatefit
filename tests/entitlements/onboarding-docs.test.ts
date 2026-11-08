import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const tsc = path.join(root, "node_modules/typescript/bin/tsc");
const pages = ["docs/onboarding.md", "site/src/content/docs/onboarding.md"];

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function tsFences(markdown: string): string[] {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => `${match[1].replace(/\s+$/, "")}\n`);
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, GATEFIT_TELEMETRY: "0" };
  if (!("GATEFIT_LIVE_CLOCK" in extra)) delete env.GATEFIT_LIVE_CLOCK;
  for (const key of ["GATEFIT_TELEMETRY_URL", "DO_NOT_TRACK"]) delete env[key];
  return env;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: cleanEnv(env),
  });
}

const LICENSE =
  "The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free.";

test("onboarding pages match, sit in the nav, and state the free suite", () => {
  const docs = read("docs/onboarding.md");
  const site = read("site/src/content/docs/onboarding.md");
  assert.match(site, /^---\ntitle: Onboarding\n/);
  assert.deepEqual(tsFences(docs), tsFences(site));
  assert.ok(docs.includes(LICENSE));
  assert.ok(site.includes(LICENSE));
  assert.match(read("site/src/content/docs/quickstart.md"), /\/onboarding\//);
  assert.match(read("site/astro.config.mjs"), /label: 'Onboarding', slug: 'onboarding'/);
  assert.match(read("docs/bring-your-adapter.md"), /onboarding\.md/);
  assert.match(read("README.md"), /docs\/onboarding\.md/);
  for (const text of [docs, site]) {
    assert.match(text, /npx gatefit@0\.8\.0/);
    assert.match(text, /gatefit init/);
    assert.doesNotMatch(text, /new in 0\.\d/i);
    assert.doesNotMatch(text, /ships in 0\.\d/i);
    assert.doesNotMatch(text, /first release that ships/i);
    assert.doesNotMatch(text, /\bdeployed\b/i);
    assert.doesNotMatch(text, /\bis live\b/i);
  }
});

test("onboarding quotes real errors and the runner's first fail lines", () => {
  const docs = read("docs/onboarding.md");
  const site = read("site/src/content/docs/onboarding.md");
  const quoted: Array<[string, string]> = [
    ["src/access-adapter.ts", "refuse sk_live: Gatefit will not load a live Stripe secret"],
    ["src/access-adapter.ts", "must export createAdapter() or AccessAdapter with apply + snapshot"],
    ["src/paths.ts", "path not found:"],
    ["src/cli.ts", "suite not found:"],
    ["src/cli.ts", "gatefit: PASS "],
    ["src/cli.ts", "gatefit: FAIL "],
    ["src/cli.ts", "gatefit adapter-check: naive failed S1 (expected)"],
    ["src/cli.ts", "gatefit adapter-check: hardened passed S1 (expected)"],
    ["src/fixture-driver.ts", "adapter.reset is required when running more than one golden"],
    ["src/fixture-driver.ts", "fixture-first driver refuses GATEFIT_LIVE_CLOCK; use YAML step order only"],
    ["src/init/templates/db.ts.tpl", "gatefit adapter: set DATABASE_URL to a disposable Postgres (CI service container or local dev DB)"],
    ["src/init/templates/db.ts.tpl", "gatefit adapter: DATABASE_URL is not a valid postgres:// URL"],
    ["src/init/templates/db.ts.tpl", "gatefit adapter: DATABASE_URL host is not local. Goldens truncate gatefit_access between runs."],
    ["src/init.ts", "gatefit init: refuse sk_live: a live Stripe secret is present in "],
    ["src/init.ts", "Gatefit only works with test mode. Remove the live key, then rerun. Nothing was written."],
    ["src/init.ts", "gatefit init: these files already exist. Nothing was written."],
    ["src/init.ts", "Rerun with --force to overwrite them, or pick another --dir."],
    ["src/init.ts", "gatefit init: unknown template:"],
    ["src/init.ts", "no ORM found in package.json (drizzle-orm, @prisma/client or prisma, @supabase/supabase-js)"],
    ["src/stripe-clock.ts", "live lane is opt-in: set GATEFIT_LIVE_CLOCK=1"],
    ["src/stripe-clock.ts", "live lane requires STRIPE_SECRET_KEY or STRIPE_API_KEY (sk_test_ only)"],
    ["src/stripe-clock.ts", "refuse non-test Stripe secret: live lane requires sk_test_"],
    ["src/license.ts", "Pro pack requires GATEFIT_LICENSE_KEY."],
    ["src/license.ts", "Buy the Indie License:"],
    ["src/license.ts", "https://gatefit.io/#pricing"],
    ["src/adapters/sqlite.ts", "gatefit: SQLite adapter cannot load better-sqlite3."],
    ["src/init.ts", "Prisma Client is not loaded in CI."],
    ["src/init.ts", "Your drizzle client is not loaded in CI."],
    ["src/init.ts", "No Supabase API keys are needed."],
    ["src/init.ts", "local port 54322"],
    ["src/stripe-clock.ts", "2025-10-29.clover"],
  ];
  for (const [file, needle] of quoted) {
    assert.ok(read(file).includes(needle), `${file} no longer contains ${needle}`);
    assert.ok(docs.includes(needle), `docs onboarding missing ${needle}`);
    assert.ok(site.includes(needle), `site onboarding missing ${needle}`);
  }

  const naive = run(["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/naive.ts"]);
  assert.equal(naive.status, 1);
  assert.ok(docs.includes(naive.stderr.trim()), "docs missing naive S1 stderr");
  const trial = run(["run", "--suite", "trial_no_card", "--adapter", "src/adapters/naive.ts"]);
  assert.equal(trial.status, 1);
  assert.ok(docs.includes("gatefit: FAIL trial_no_card"));
  assert.ok(trial.stderr.includes("step 1: locked: expected true, got false"));
  assert.ok(docs.includes("step 1: locked: expected true, got false"));
  const missingSuite = run(["run", "--suite", "missing-suite", "--adapter", "./nope.ts"]);
  assert.ok(docs.includes(missingSuite.stderr.trim()));
  const missingPath = run(["run", "--suite", "paid_grants_access", "--adapter", "./gatefit/adapter.ts"]);
  assert.ok(docs.includes(missingPath.stderr.trim()));
  const liveFlag = run(["run", "--suite", "paid_grants_access", "--adapter", "src/adapters/hardened.ts"], {
    GATEFIT_LIVE_CLOCK: "1",
  });
  assert.ok(docs.includes(liveFlag.stderr.trim()));
  const check = run(["adapter-check"]);
  assert.equal(check.status, 0);
  assert.ok(docs.includes(check.stderr.trim()));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-onboarding-"));
  const adapter = path.join(dir, "nodedupe.mts");
  fs.writeFileSync(
    adapter,
    `import { nextSnapshot } from ${JSON.stringify(path.join(root, "src/access-rules.ts"))};
import type { AccessAdapter, AccessSnapshot, BillingEvent } from ${JSON.stringify(path.join(root, "src/access-adapter.ts"))};
export function createAdapter(): AccessAdapter {
  const rows = new Map<string, AccessSnapshot>();
  return {
    apply(event: BillingEvent) {
      const current = rows.get(event.customerId) ?? { locked: true };
      rows.set(event.customerId, nextSnapshot(current, event));
    },
    snapshot(customerId: string) { return rows.get(customerId) ?? { locked: true }; },
    reset() { rows.clear(); },
  };
}
`,
  );
  try {
    const replay = run(["run", "--suite", "duplicate_webhook_idempotent", "--adapter", adapter]);
    assert.equal(replay.status, 1, replay.stderr);
    assert.match(replay.stderr, /step 3: locked: expected true, got false/);
    assert.ok(docs.includes("step 3: locked: expected true, got false"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("onboarding adapter snippets typecheck against exported AccessAdapter", () => {
  const fences = tsFences(read("docs/onboarding.md"));
  assert.equal(fences.length, 6);
  const connect = fences.filter((fence) => fence.includes("export function connect("));
  const adapters = fences.filter((fence) => fence.includes("export function createAdapter("));
  assert.equal(connect.length, 1);
  assert.equal(adapters.length, 5);
  for (const fence of fences) {
    for (const spec of fence.matchAll(/from "([^"]+)"/g)) {
      assert.ok(["./access-rules.ts", "./db.ts", "pg"].includes(spec[1]), spec[1]);
    }
    assert.doesNotMatch(fence, /fetch\s*\(/);
    assert.doesNotMatch(fence, /@prisma\/client|drizzle-orm|@supabase\/supabase-js/);
  }

  const doc = read("docs/onboarding.md");
  for (const heading of ["### Postgres table", "### Supabase", "### Prisma and other ORMs", "### HTTP endpoint"]) {
    const start = doc.indexOf(heading);
    assert.ok(start >= 0, heading);
    const rest = doc.slice(start + heading.length);
    const next = rest.search(/\n### /);
    const section = next === -1 ? rest : rest.slice(0, next);
    assert.match(section, /export function createAdapter\(\)/);
  }
  assert.match(doc, /Gatefit does not fetch an HTTP endpoint for access\./);
  assert.match(doc, /There is no HTTP adapter\./);
  const select = read("src/init/templates/adapter.ts.tpl").match(/const SELECT_ROW = "([^"]+)"/)?.[1];
  assert.ok(select);
  assert.ok(doc.includes(select));
  assert.ok(doc.includes("ALTER TABLE gatefit_access ENABLE ROW LEVEL SECURITY;"));
  assert.ok(doc.includes("ALTER TABLE gatefit_seen_events ENABLE ROW LEVEL SECURITY;"));

  const dir = fs.mkdtempSync(path.join(root, "tests/entitlements/.onboarding-typecheck-"));
  try {
    const rel = (file: string) => {
      let out = path.relative(dir, path.join(root, file)).split(path.sep).join("/");
      if (!out.startsWith(".")) out = `./${out}`;
      return out;
    };
    fs.writeFileSync(
      path.join(dir, "access-rules.ts"),
      `export type { AccessAdapter, AccessSnapshot, BillingEvent } from ${JSON.stringify(rel("src/access-adapter.ts"))};\nexport { nextSnapshot } from ${JSON.stringify(rel("src/access-rules.ts"))};\n`,
    );
    const files = ["access-rules.ts"];
    fences.forEach((fence, index) => {
      const name = fence.includes("export function connect(") ? "db.ts" : `snippet-${index}.ts`;
      fs.writeFileSync(path.join(dir, name), fence);
      files.push(name);
    });
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          verbatimModuleSyntax: true,
          allowImportingTsExtensions: true,
          types: ["node"],
        },
        files,
      }),
    );
    execFileSync(process.execPath, [tsc, "-p", path.join(dir, "tsconfig.json")], { encoding: "utf8" });

    const memory = fences.find((fence) => fence.includes("new Map<string, AccessSnapshot>()"));
    assert.ok(memory);
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-onboarding-memory-"));
    try {
      fs.writeFileSync(
        path.join(runDir, "access-rules.ts"),
        `export type { AccessAdapter, AccessSnapshot, BillingEvent } from ${JSON.stringify(path.join(root, "src/access-adapter.ts"))};\nexport { nextSnapshot } from ${JSON.stringify(path.join(root, "src/access-rules.ts"))};\n`,
      );
      fs.writeFileSync(path.join(runDir, "memory.ts"), memory);
      const result = spawnSync(process.execPath, [bin, "run", "--suite", "tests/entitlements/goldens", "--adapter", path.join(runDir, "memory.ts")], {
        cwd: root,
        encoding: "utf8",
        env: cleanEnv(),
      });
      assert.equal(result.status, 0, result.stderr);
      for (const name of fs.readdirSync(path.join(root, "tests/entitlements/goldens")).filter((file) => file.endsWith(".yaml"))) {
        assert.match(result.stderr, new RegExp(`gatefit: PASS ${name.slice(0, -".yaml".length)}\\b`));
      }
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

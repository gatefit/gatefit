import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { STRIPE_API_VERSION } from "../../src/stripe-clock.ts";
import { findPgBinDir, startEphemeralPg, type EphemeralPg } from "./helpers/pg-ephemeral.ts";

// GATEFIT-H23 `gatefit init`. Fail modes first, then the Postgres lane that runs
// every free golden through each generated adapter against a real local Postgres.

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const TEMPLATES = ["drizzle", "prisma", "supabase", "generic"] as const;
type Template = (typeof TEMPLATES)[number];

const COMMON = ["gatefit/adapter.ts", "gatefit/db.ts", "gatefit/README.md", "gatefit/env.example"];
const EXTRA: Record<Template, string[]> = {
  drizzle: ["gatefit/schema.ts", "gatefit/migration.sql"],
  prisma: ["gatefit/access.prisma", "gatefit/migration.sql"],
  supabase: [],
  generic: ["gatefit/migration.sql"],
};
const SUPABASE_MIGRATION = /^supabase\/migrations\/\d{14}_gatefit_access\.sql$/;

function tmpProject(pkg?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-init-"));
  if (pkg) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  return dir;
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(STRIPE_|GATEFIT_LICENSE|POLAR_|DATABASE_URL$)/.test(key)) delete env[key];
  }
  delete env.GATEFIT_LIVE_CLOCK;
  delete env.GATEFIT_ALLOW_REMOTE_DB;
  return { ...env, ...extra };
}

function init(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  // npm sets INIT_CWD to the repo root when ci-local runs tests; point it at the project.
  return spawnSync(process.execPath, [bin, "init", ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnv({ INIT_CWD: cwd, ...env }),
  });
}

function gatefit(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnv({ INIT_CWD: cwd, ...env }),
  });
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === "node_modules") continue;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  walk("");
  return out.sort();
}

function expectedFiles(dir: string, template: Template): string[] {
  const files = [...COMMON, ...EXTRA[template]];
  if (template === "supabase") {
    const migration = listFiles(dir).find((f) => SUPABASE_MIGRATION.test(f));
    assert.ok(migration, `supabase migration missing in ${listFiles(dir).join(", ")}`);
    files.push(migration);
  }
  return files.sort();
}

function migrationFile(dir: string, template: Template): string {
  if (template !== "supabase") return path.join(dir, "gatefit/migration.sql");
  const rel = listFiles(dir).find((f) => SUPABASE_MIGRATION.test(f));
  assert.ok(rel, "supabase migration missing");
  return path.join(dir, rel);
}

describe("gatefit init fail modes", () => {
  test("init_unknown_template_exits_2_and_writes_nothing", () => {
    const dir = tmpProject({ name: "app" });
    const result = init(dir, ["--template", "mongoose"]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /unknown template: mongoose/);
    for (const t of TEMPLATES) assert.match(result.stderr, new RegExp(t));
    assert.deepEqual(listFiles(dir), ["package.json"]);
  });

  test("init_unknown_flag_exits_2_and_writes_nothing", () => {
    const dir = tmpProject({ name: "app" });
    const result = init(dir, ["--template", "generic", "--yes-overwrite-everything"]);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(listFiles(dir), ["package.json"]);
  });

  test("init_dir_escaping_project_exits_2_and_writes_nothing", () => {
    const dir = tmpProject({ name: "app" });
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside`);
    for (const target of ["../" + path.basename(outside), outside]) {
      const result = init(dir, ["--template", "generic", "--dir", target]);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /inside the project/);
    }
    assert.equal(fs.existsSync(outside), false);
    assert.deepEqual(listFiles(dir), ["package.json"]);
  });

  test("init_existing_file_without_force_exits_3_and_writes_nothing", () => {
    const dir = tmpProject({ name: "app" });
    fs.mkdirSync(path.join(dir, "gatefit"));
    fs.writeFileSync(path.join(dir, "gatefit/db.ts"), "// mine\n");
    const result = init(dir, ["--template", "generic"]);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /gatefit\/db\.ts/);
    assert.match(result.stderr, /--force/);
    assert.equal(fs.readFileSync(path.join(dir, "gatefit/db.ts"), "utf8"), "// mine\n");
    // All-or-nothing: no other planned file appears either.
    assert.deepEqual(listFiles(dir), ["gatefit/db.ts", "package.json"]);
  });

  test("init_rerun_exits_3_and_leaves_first_run_untouched", () => {
    const dir = tmpProject({ name: "app" });
    assert.equal(init(dir, ["--template", "generic"]).status, 0);
    const before = new Map(listFiles(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
    fs.appendFileSync(path.join(dir, "gatefit/adapter.ts"), "// my edit\n");
    const second = init(dir, ["--template", "generic"]);
    assert.equal(second.status, 3, second.stderr);
    assert.match(fs.readFileSync(path.join(dir, "gatefit/adapter.ts"), "utf8"), /\/\/ my edit\n$/);
    assert.deepEqual(listFiles(dir), [...before.keys()]);
  });

  test("init_force_overwrites_existing_files", () => {
    const dir = tmpProject({ name: "app" });
    fs.mkdirSync(path.join(dir, "gatefit"));
    fs.writeFileSync(path.join(dir, "gatefit/db.ts"), "// mine\n");
    const result = init(dir, ["--template", "generic", "--force"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /overwrite gatefit\/db\.ts/);
    assert.notEqual(fs.readFileSync(path.join(dir, "gatefit/db.ts"), "utf8"), "// mine\n");
  });

  test("init_supabase_existing_gatefit_migration_is_a_conflict", () => {
    const dir = tmpProject({ name: "app", dependencies: { "@supabase/supabase-js": "^2" } });
    fs.mkdirSync(path.join(dir, "supabase/migrations"), { recursive: true });
    const prior = "supabase/migrations/20250101000000_gatefit_access.sql";
    fs.writeFileSync(path.join(dir, prior), "-- applied already\n");
    const result = init(dir, ["--template", "supabase"]);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /20250101000000_gatefit_access\.sql/);
    assert.deepEqual(listFiles(dir), ["package.json", prior]);
    const forced = init(dir, ["--template", "supabase", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    // --force rewrites the existing migration in place; it does not add a second one.
    const migrations = listFiles(dir).filter((f) => SUPABASE_MIGRATION.test(f));
    assert.deepEqual(migrations, [prior]);
    assert.match(fs.readFileSync(path.join(dir, prior), "utf8"), /gatefit_access/);
  });

  test("init_refuses_sk_live_in_env_exits_4_without_echoing_it", () => {
    const dir = tmpProject({ name: "app" });
    const secret = "sk_live_" + "51Hdeadbeefdeadbeefdeadbeef";
    const result = init(dir, ["--template", "generic"], { STRIPE_SECRET_KEY: secret });
    assert.equal(result.status, 4, result.stderr);
    assert.match(result.stderr, /refuse sk_live/);
    assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
    assert.deepEqual(listFiles(dir), ["package.json"]);
  });

  test("init_refuses_sk_live_in_project_env_file_exits_4", () => {
    const dir = tmpProject({ name: "app" });
    const secret = "sk_live_" + "51Hcafebabecafebabecafebabe";
    fs.writeFileSync(path.join(dir, ".env.local"), `STRIPE_SECRET_KEY=${secret}\n`);
    const result = init(dir, ["--template", "generic"]);
    assert.equal(result.status, 4, result.stderr);
    assert.match(result.stderr, /\.env\.local/);
    assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
    assert.deepEqual(listFiles(dir), [".env.local", "package.json"]);
  });

  test("init_dry_run_prints_plan_and_writes_nothing", () => {
    const dir = tmpProject({ name: "app" });
    const result = init(dir, ["--template", "prisma", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    for (const f of [...COMMON, ...EXTRA.prisma]) assert.match(result.stdout, new RegExp(`create ${f}`));
    assert.deepEqual(listFiles(dir), ["package.json"]);
  });

  test("init_detects_template_from_package_json", () => {
    const cases: [Record<string, unknown>, Template][] = [
      [{ dependencies: { "drizzle-orm": "^0.44.0" } }, "drizzle"],
      [{ devDependencies: { prisma: "^6" }, dependencies: { "@prisma/client": "^6" } }, "prisma"],
      [{ dependencies: { "@supabase/supabase-js": "^2" } }, "supabase"],
      [{ dependencies: { express: "^5" } }, "generic"],
    ];
    for (const [deps, template] of cases) {
      const dir = tmpProject({ name: "app", ...deps });
      const result = init(dir, []);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`template: ${template}`));
      assert.deepEqual(listFiles(dir), [...expectedFiles(dir, template), "package.json"].sort());
    }
    const bare = tmpProject();
    const result = init(bare, []);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /template: generic/);
  });

  test("init_generated_files_pin_stripe_api_version_and_hold_no_secrets", () => {
    for (const template of TEMPLATES) {
      const dir = tmpProject({ name: "app" });
      const result = init(dir, ["--template", template]);
      assert.equal(result.status, 0, result.stderr);
      const files = expectedFiles(dir, template);
      assert.deepEqual(listFiles(dir), [...files, "package.json"].sort());
      const adapter = fs.readFileSync(path.join(dir, "gatefit/adapter.ts"), "utf8");
      assert.ok(adapter.includes(`"${STRIPE_API_VERSION}"`), `${template}: adapter does not pin ${STRIPE_API_VERSION}`);
      for (const f of files) {
        const body = fs.readFileSync(path.join(dir, f), "utf8");
        assert.doesNotMatch(body, /\{\{|\}\}/, `${template}:${f} has an unfilled placeholder`);
        assert.doesNotMatch(body, /sk_live/, `${template}:${f} mentions sk_live`);
        assert.doesNotMatch(body, /sk_test_[A-Za-z0-9]{8,}|rk_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/, `${template}:${f} holds a key`);
        assert.doesNotMatch(body, /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]+@/, `${template}:${f} holds a DB password`);
        assert.doesNotMatch(body, /GATEFIT_LICENSE_KEY|polar\.sh|\$19|monthly|coming soon/i, `${template}:${f} has license or pricing copy`);
      }
    }
  });

  test("init_import_graph_never_reaches_license_or_packs", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        visit(path.resolve(path.dirname(file), m[1]!));
      }
    };
    visit(path.join(root, "src/init.ts"));
    const rel = [...seen].map((f) => path.relative(root, f));
    assert.ok(rel.includes("src/init.ts"));
    assert.equal(rel.includes("src/license.ts"), false, rel.join(", "));
    assert.equal(rel.includes("src/packs.ts"), false, rel.join(", "));
  });

  test("init_template_sources_never_retype_the_stripe_api_version", () => {
    const templateRoot = path.join(root, "src/init/templates");
    const hits = listFiles(templateRoot).filter((f) =>
      fs.readFileSync(path.join(templateRoot, f), "utf8").includes(STRIPE_API_VERSION),
    );
    assert.deepEqual(hits, []);
    assert.equal(fs.readFileSync(path.join(root, "src/init.ts"), "utf8").includes(STRIPE_API_VERSION), false);
  });

  test("generated_adapter_refuses_remote_database_url", () => {
    const dir = tmpProject({ name: "app" });
    assert.equal(init(dir, ["--template", "generic"]).status, 0);
    linkDeps(dir);
    const result = gatefit(dir, ["run", "--suite", "paid_grants_access", "--adapter", "gatefit/adapter.ts"], {
      DATABASE_URL: "postgres://app@db.example.com:5432/prod",
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /GATEFIT_ALLOW_REMOTE_DB/);
    assert.doesNotMatch(result.stderr, /gatefit: PASS/);
  });

  test("generated_adapter_without_database_url_fails_clearly", () => {
    const dir = tmpProject({ name: "app" });
    assert.equal(init(dir, ["--template", "generic"]).status, 0);
    linkDeps(dir);
    const result = gatefit(dir, ["run", "--suite", "paid_grants_access", "--adapter", "gatefit/adapter.ts"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /DATABASE_URL/);
  });
});

/** The project would `npm i -D gatefit pg`; link this checkout and its pg instead. */
function linkDeps(dir: string): void {
  const nm = path.join(dir, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  fs.symlinkSync(root, path.join(nm, "gatefit"), "dir");
  fs.symlinkSync(path.join(root, "node_modules/pg"), path.join(nm, "pg"), "dir");
}

const GOLDENS = fs
  .readdirSync(path.join(root, "tests/entitlements/goldens"))
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""));

const pgBin = findPgBinDir();
const pgSkip = pgBin ? false : "no initdb/pg_ctl/psql found (set GATEFIT_PG_BIN); Postgres lane skipped";

describe("gatefit init Postgres lane", { skip: pgSkip }, () => {
  let pg: EphemeralPg;
  before(async () => {
    pg = await startEphemeralPg(pgBin!);
    console.error(`gatefit init: Postgres lane ran (${pgBin})`);
  });
  after(() => pg?.stop());

  for (const template of TEMPLATES) {
    test(`init_${template}_adapter_passes_every_golden_on_postgres`, () => {
      const dir = tmpProject({ name: "app" });
      assert.equal(init(dir, ["--template", template]).status, 0);
      linkDeps(dir);
      pg.psql("DROP TABLE IF EXISTS gatefit_access, gatefit_seen_events");
      pg.psqlFile(migrationFile(dir, template));
      // Migrations are re-runnable.
      pg.psqlFile(migrationFile(dir, template));
      const env = { DATABASE_URL: pg.url };
      const result = gatefit(dir, ["run", "--suite", "tests/entitlements/goldens", "--adapter", "gatefit/adapter.ts"], env);
      assert.equal(result.status, 0, result.stderr);
      for (const id of GOLDENS) assert.match(result.stderr, new RegExp(`gatefit: PASS ${id}\\b`));
      assert.doesNotMatch(result.stderr, /gatefit: FAIL/);
      console.error(`gatefit init: Postgres lane ${template} PASS (${GOLDENS.length} goldens)`);
    });

    test(`init_${template}_access_rows_in_postgres_match_the_transition`, () => {
      const dir = tmpProject({ name: "app" });
      assert.equal(init(dir, ["--template", template]).status, 0);
      linkDeps(dir);
      pg.psql("DROP TABLE IF EXISTS gatefit_access, gatefit_seen_events");
      pg.psqlFile(migrationFile(dir, template));
      const env = { DATABASE_URL: pg.url };

      const paid = gatefit(dir, ["run", "--suite", "paid_grants_access", "--adapter", "gatefit/adapter.ts"], env);
      assert.equal(paid.status, 0, paid.stderr);
      assert.equal(pg.psql("SELECT locked FROM gatefit_access WHERE customer_id = 'cus_s1'").trim(), "f");

      const dup = gatefit(dir, ["run", "--suite", "duplicate_webhook_idempotent", "--adapter", "gatefit/adapter.ts"], env);
      assert.equal(dup.status, 0, dup.stderr);
      assert.equal(pg.psql("SELECT count(*) FROM gatefit_access").trim(), "1");
      // Three deliveries of evt_s6_invoice_paid plus one deletion: two distinct ids.
      assert.equal(pg.psql("SELECT count(*) FROM gatefit_seen_events").trim(), "2");
      assert.equal(pg.psql("SELECT locked FROM gatefit_access WHERE customer_id = 'cus_s6'").trim(), "t");

      const cancel = gatefit(dir, ["run", "--suite", "cancel_revokes_access", "--adapter", "gatefit/adapter.ts"], env);
      assert.equal(cancel.status, 0, cancel.stderr);
      assert.equal(pg.psql("SELECT bool_and(locked) FROM gatefit_access").trim(), "t");
    });
  }
});

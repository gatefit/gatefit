import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { assertNoLiveStripeSecret } from "./access-adapter.ts";
import { packageRoot, userCwd } from "./paths.ts";
import { STRIPE_API_VERSION } from "./stripe-clock.ts";

// `gatefit init`: free. No license check, no Polar call, no network.
// Exit codes (init only): 0 written, 2 usage, 3 would overwrite, 4 sk_live refused.
export const INIT_OK = 0;
export const INIT_USAGE = 2;
export const INIT_CONFLICT = 3;
export const INIT_LIVE_KEY = 4;

export const INIT_TEMPLATES = ["drizzle", "prisma", "supabase", "generic"] as const;
export type InitTemplate = (typeof INIT_TEMPLATES)[number];

type PlannedFile = { rel: string; abs: string; content: string; exists: boolean };

const DB_NOTES: Record<InitTemplate, string> = {
  drizzle: "Uses node-postgres (pg), the driver behind drizzle-orm/node-postgres. Your drizzle client is not loaded in CI.",
  prisma: "Uses node-postgres (pg) against the database Prisma migrates. Prisma Client is not loaded in CI.",
  supabase: "Use the Postgres connection string (`supabase start` prints it; local port 54322). No Supabase API keys are needed.",
  generic: "Uses node-postgres (pg). Any Postgres 13 or newer works.",
};

const SUPABASE_RLS = [
  "",
  "-- Supabase exposes public tables through the Data API. RLS with no policies",
  "-- keeps these rows server-only (anon and authenticated roles are denied).",
  "ALTER TABLE gatefit_access ENABLE ROW LEVEL SECURITY;",
  "ALTER TABLE gatefit_seen_events ENABLE ROW LEVEL SECURITY;",
  "",
].join("\n");

export function initUsage(): string {
  return [
    "Usage:",
    "  gatefit init [--template <name>] [--dir <path>] [--force] [--dry-run]",
    "",
    `Templates: ${INIT_TEMPLATES.join(", ")} (default: detected from package.json, else generic)`,
    "  --dir      where adapter files go, inside the project (default: gatefit)",
    "  --force    overwrite files that already exist",
    "  --dry-run  print the write plan and write nothing",
    "",
    "Exit codes: 0 written, 2 usage, 3 would overwrite (use --force), 4 sk_live refused",
  ].join("\n");
}

function readDeps(cwd: string): Set<string> {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
    return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

export function detectTemplate(cwd: string): InitTemplate {
  const deps = readDeps(cwd);
  if (deps.has("drizzle-orm")) return "drizzle";
  if (deps.has("@prisma/client") || deps.has("prisma")) return "prisma";
  if (deps.has("@supabase/supabase-js") || fs.existsSync(path.join(cwd, "supabase/config.toml"))) return "supabase";
  return "generic";
}

function readTemplate(name: string): string {
  return fs.readFileSync(path.join(packageRoot(), "src/init/templates", name), "utf8");
}

function fill(source: string, values: Record<string, string>): string {
  const out = source.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => values[key] ?? match);
  const missing = out.match(/\{\{[A-Z_]+\}\}/);
  if (missing) throw new Error(`gatefit init: template placeholder not filled: ${missing[0]}`);
  return out;
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function supabaseMigrationRel(cwd: string, now: Date): string {
  const dir = path.join(cwd, "supabase/migrations");
  if (fs.existsSync(dir)) {
    const prior = fs
      .readdirSync(dir)
      .filter((name) => /^\d{14}_gatefit_access\.sql$/.test(name))
      .sort();
    if (prior.length > 0) return `supabase/migrations/${prior[0]}`;
  }
  return `supabase/migrations/${utcStamp(now)}_gatefit_access.sql`;
}

function schemaStep(template: InitTemplate, dir: string, migration: string): string {
  const psql = `\`psql "$DATABASE_URL" -f ${migration}\``;
  if (template === "drizzle") return `${psql}, or add \`${dir}/schema.ts\` to your drizzle-kit schema and run \`npx drizzle-kit push\`.`;
  if (template === "prisma") return `${psql}, or paste \`${dir}/access.prisma\` into \`prisma/schema.prisma\` and run \`npx prisma migrate dev\`.`;
  if (template === "supabase") return `\`supabase db reset\` applies \`${migration}\` locally; \`supabase db push\` applies it to a linked project. In CI, ${psql} works too.`;
  return `${psql}.`;
}

export function planInit(cwd: string, template: InitTemplate, dirRel: string, now = new Date()): PlannedFile[] {
  const dir = toPosix(dirRel);
  const migration = template === "supabase" ? supabaseMigrationRel(cwd, now) : `${dir}/migration.sql`;
  const sources: [string, string][] = [
    [`${dir}/adapter.ts`, "adapter.ts.tpl"],
    [`${dir}/db.ts`, "db.ts.tpl"],
    [`${dir}/README.md`, "README.md.tpl"],
    [`${dir}/env.example`, "env.example.tpl"],
  ];
  if (template === "drizzle") sources.push([`${dir}/schema.ts`, "drizzle/schema.ts.tpl"]);
  if (template === "prisma") sources.push([`${dir}/access.prisma`, "prisma/access.prisma.tpl"]);
  sources.push([migration, "migration.sql.tpl"]);
  const values: Record<string, string> = {
    TEMPLATE: template,
    DIR: dir,
    STRIPE_API_VERSION,
    DB_NOTE: DB_NOTES[template],
    MIGRATION_TAIL: template === "supabase" ? SUPABASE_RLS : "",
    FILE_LIST: sources.map(([rel]) => `- \`${rel}\``).join("\n"),
    SCHEMA_STEP: schemaStep(template, dir, migration),
  };
  return sources.map(([rel, source]) => {
    const abs = path.join(cwd, rel);
    return { rel, abs, content: fill(readTemplate(source), values), exists: fs.existsSync(abs) };
  });
}

function hasLiveKey(text: string): boolean {
  try {
    assertNoLiveStripeSecret(text);
    return false;
  } catch {
    return true;
  }
}

/** Names of places holding an sk_live key. Never returns the key itself. */
function liveKeySources(cwd: string, plan: PlannedFile[]): string[] {
  const hits: string[] = [];
  if (hasLiveKey(JSON.stringify(process.env))) hits.push("the environment");
  for (const name of fs.readdirSync(cwd)) {
    if (!/^\.env(\..+)?$/.test(name)) continue;
    const file = path.join(cwd, name);
    if (fs.statSync(file).isFile() && hasLiveKey(fs.readFileSync(file, "utf8"))) hits.push(name);
  }
  for (const file of plan) {
    if (file.exists && fs.statSync(file.abs).isFile() && hasLiveKey(fs.readFileSync(file.abs, "utf8"))) hits.push(file.rel);
    if (hasLiveKey(file.content)) hits.push(`generated ${file.rel}`);
  }
  return hits;
}

/** Path components that exist but are not directories would break the write midway. */
function blockedParents(cwd: string, plan: PlannedFile[]): string[] {
  const blocked = new Set<string>();
  for (const file of plan) {
    let dir = path.dirname(file.abs);
    while (dir.startsWith(cwd) && dir !== cwd) {
      if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) blocked.add(toPosix(path.relative(cwd, dir)));
      dir = path.dirname(dir);
    }
    if (file.exists && fs.statSync(file.abs).isDirectory()) blocked.add(file.rel);
  }
  return [...blocked];
}

/** Stage every file, then rename into place. On any error, remove what this run created. */
function writeAll(plan: PlannedFile[]): void {
  const createdDirs: string[] = [];
  const staged: { tmp: string; abs: string }[] = [];
  const renamed: string[] = [];
  try {
    for (const file of plan) {
      const parent = path.dirname(file.abs);
      const first = fs.mkdirSync(parent, { recursive: true });
      if (first) createdDirs.push(first);
      const tmp = `${file.abs}.gatefit-init-${process.pid}.tmp`;
      fs.writeFileSync(tmp, file.content, { flag: "wx" });
      staged.push({ tmp, abs: file.abs });
    }
    for (const { tmp, abs } of staged) {
      fs.renameSync(tmp, abs);
      renamed.push(abs);
    }
  } catch (err) {
    for (const { tmp } of staged) fs.rmSync(tmp, { force: true });
    for (const file of plan) if (!file.exists && renamed.includes(file.abs)) fs.rmSync(file.abs, { force: true });
    for (const dir of createdDirs.reverse()) fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function runInit(argv: string[]): number {
  let values: { template?: string; dir?: string; force?: boolean; "dry-run"?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        template: { type: "string" },
        dir: { type: "string" },
        force: { type: "boolean" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    console.error(`gatefit init: ${err instanceof Error ? err.message : String(err)}`);
    console.error(initUsage());
    return INIT_USAGE;
  }
  if (values.help) {
    console.log(initUsage());
    return INIT_OK;
  }

  const cwd = path.resolve(userCwd());
  let template: InitTemplate;
  let how: string;
  if (values.template !== undefined) {
    if (!(INIT_TEMPLATES as readonly string[]).includes(values.template)) {
      console.error(`gatefit init: unknown template: ${values.template}`);
      console.error(initUsage());
      return INIT_USAGE;
    }
    template = values.template as InitTemplate;
    how = "--template";
  } else {
    template = detectTemplate(cwd);
    how = "detected";
  }

  const dirAbs = path.resolve(cwd, values.dir ?? "gatefit");
  const dirRel = path.relative(cwd, dirAbs);
  if (dirRel === "" || dirRel.startsWith("..") || path.isAbsolute(dirRel)) {
    console.error(`gatefit init: --dir must be a subdirectory inside the project (${cwd})`);
    return INIT_USAGE;
  }

  const plan = planInit(cwd, template, dirRel);

  const live = liveKeySources(cwd, plan);
  if (live.length > 0) {
    console.error(`gatefit init: refuse sk_live: a live Stripe secret is present in ${live.join(", ")}.`);
    console.error("Gatefit only works with test mode. Remove the live key, then rerun. Nothing was written.");
    return INIT_LIVE_KEY;
  }

  const blocked = blockedParents(cwd, plan);
  if (blocked.length > 0) {
    console.error(`gatefit init: cannot write through: ${blocked.join(", ")} (not a regular file path). Nothing was written.`);
    return INIT_CONFLICT;
  }
  const conflicts = plan.filter((f) => f.exists);
  if (conflicts.length > 0 && !values.force) {
    console.error("gatefit init: these files already exist. Nothing was written.");
    for (const f of conflicts) console.error(`  ${f.rel}`);
    console.error("Rerun with --force to overwrite them, or pick another --dir.");
    return INIT_CONFLICT;
  }

  const dry = values["dry-run"] === true;
  console.log(`gatefit init: template: ${template} (${how})${dry ? " [dry run, nothing written]" : ""}`);
  for (const f of plan) console.log(`  ${f.exists ? "overwrite" : "create"} ${f.rel}`);
  if (dry) return INIT_OK;

  writeAll(plan);
  const dir = toPosix(dirRel);
  console.log("");
  console.log("Next:");
  console.log("  npm install --save-dev gatefit pg");
  console.log(`  apply the migration to a disposable Postgres (see ${dir}/README.md)`);
  console.log(`  DATABASE_URL=... npx gatefit run --suite tests/entitlements/goldens --adapter ${dir}/adapter.ts`);
  return INIT_OK;
}

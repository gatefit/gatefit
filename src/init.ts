import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { assertNoLiveStripeSecret } from "./access-adapter.ts";
import { packageRoot, readPackageVersion, userCwd } from "./paths.ts";
import { STRIPE_API_VERSION } from "./stripe-clock.ts";

// `gatefit init`: free. No license check, no Polar call, no network.
// Exit codes (init only): 0 written, 1 error, 2 usage, 3 would overwrite, 4 sk_live refused.
export const INIT_OK = 0;
export const INIT_ERROR = 1;
export const INIT_USAGE = 2;
export const INIT_CONFLICT = 3;
export const INIT_LIVE_KEY = 4;

export const INIT_TEMPLATES = ["drizzle", "prisma", "supabase", "generic"] as const;
export type InitTemplate = (typeof INIT_TEMPLATES)[number];

export type PlannedFile = { rel: string; abs: string; content: string; exists: boolean };
type WriteOps = Pick<typeof fs, "mkdirSync" | "writeFileSync" | "renameSync" | "rmSync" | "lstatSync">;

const WORKFLOW_REL = ".github/workflows/gatefit.yml";
const CONFIG_REL = "gatefit.config.json";
const DEFAULT_SUITE = "paid_grants_access";

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
    "  gatefit init [--template <name>] [--dir <path>] [--force] [--dry-run] [--no-prompt]",
    "               [--print-workflow | --write-workflow]",
    "",
    `Templates: ${INIT_TEMPLATES.join(", ")}`,
    "  Without --template, init uses the one ORM found in package.json. If none or more",
    "  than one is found, it asks on a terminal and otherwise exits 2.",
    "  --dir             where adapter files go, inside the project (default: gatefit)",
    "  --force           overwrite files that already exist",
    "  --dry-run         print the write plan and write nothing",
    "  --no-prompt       never ask (implied by CI and a non-terminal stdin)",
    "  --print-workflow  print a GitHub Actions workflow and write nothing",
    `  --write-workflow  also write ${WORKFLOW_REL}`,
    "",
    "Exit codes: 0 written, 1 error, 2 usage, 3 would overwrite (use --force), 4 sk_live refused",
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

/** Every ORM template package.json points at. Generic is never detected; it is chosen. */
export function detectTemplates(cwd: string): InitTemplate[] {
  const deps = readDeps(cwd);
  const found: InitTemplate[] = [];
  if (deps.has("drizzle-orm")) found.push("drizzle");
  if (deps.has("@prisma/client") || deps.has("prisma")) found.push("prisma");
  if (deps.has("@supabase/supabase-js") || fs.existsSync(path.join(cwd, "supabase/config.toml"))) found.push("supabase");
  return found;
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

/** True for files, directories, and symlinks, dangling or not. */
function present(p: string, ops: Pick<typeof fs, "lstatSync"> = fs): boolean {
  try {
    ops.lstatSync(p);
    return true;
  } catch {
    return false;
  }
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

export type InitPlan = { files: PlannedFile[]; workflow: string; migration: string };

export function planInit(
  cwd: string,
  template: InitTemplate,
  dirRel: string,
  opts: { writeWorkflow?: boolean } = {},
  now = new Date(),
): InitPlan {
  const dir = toPosix(dirRel);
  const migration = template === "supabase" ? supabaseMigrationRel(cwd, now) : `${dir}/migration.sql`;
  const sources: [string, string][] = [
    [`${dir}/access-rules.ts`, "access-rules.ts.tpl"],
    [`${dir}/adapter.ts`, "adapter.ts.tpl"],
    [`${dir}/db.ts`, "db.ts.tpl"],
    [`${dir}/README.md`, "README.md.tpl"],
    [`${dir}/env.example`, "env.example.tpl"],
  ];
  if (template === "drizzle") sources.push([`${dir}/schema.ts`, "drizzle/schema.ts.tpl"]);
  if (template === "prisma") sources.push([`${dir}/access.prisma`, "prisma/access.prisma.tpl"]);
  sources.push([migration, "migration.sql.tpl"]);
  const listed = [...sources.map(([rel]) => rel), CONFIG_REL, ...(opts.writeWorkflow ? [WORKFLOW_REL] : [])];
  const values: Record<string, string> = {
    TEMPLATE: template,
    DIR: dir,
    MIGRATION: migration,
    STRIPE_API_VERSION,
    GATEFIT_VERSION: readPackageVersion(),
    DB_NOTE: DB_NOTES[template],
    MIGRATION_TAIL: template === "supabase" ? SUPABASE_RLS : "",
    FILE_LIST: listed.map((rel) => `- \`${rel}\``).join("\n"),
    SCHEMA_STEP: schemaStep(template, dir, migration),
  };
  const workflow = fill(readTemplate("workflow.yml.tpl"), values);
  const config = `${JSON.stringify({ adapter: `${dir}/adapter.ts`, suite: DEFAULT_SUITE, stripeApiVersion: STRIPE_API_VERSION }, null, 2)}\n`;
  const entries: [string, string][] = sources.map(([rel, source]) => [rel, fill(readTemplate(source), values)]);
  entries.push([CONFIG_REL, config]);
  if (opts.writeWorkflow) entries.push([WORKFLOW_REL, workflow]);
  const files = entries.map(([rel, content]) => {
    const abs = path.join(cwd, rel);
    return { rel, abs, content, exists: present(abs) };
  });
  return { files, workflow, migration };
}

function hasLiveKey(text: string): boolean {
  try {
    assertNoLiveStripeSecret(text);
    return false;
  } catch {
    return true;
  }
}

type Preflight = { hits: string[]; warnings: string[]; unreadable: string[] };

/**
 * Live-key scan that runs before argv is parsed, so no message ever echoes a key
 * typed into a flag. Returns names of places holding an sk_live key, never the key.
 */
function preflightLiveKeys(cwd: string, argv: string[]): Preflight {
  const out: Preflight = { hits: [], warnings: [], unreadable: [] };
  if (hasLiveKey(argv.join("\n"))) out.hits.push("the command-line arguments");
  if (hasLiveKey(JSON.stringify(process.env))) out.hits.push("the environment");
  let names: string[] = [];
  try {
    names = fs.readdirSync(cwd);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^\.env(\..+)?$/.test(name)) continue;
    const file = path.join(cwd, name);
    if (fs.lstatSync(file).isSymbolicLink() && !fs.existsSync(file)) {
      out.warnings.push(`gatefit init: skipping ${name}: dangling symlink, nothing to scan`);
      continue;
    }
    try {
      if (fs.statSync(file).isFile() && hasLiveKey(fs.readFileSync(file, "utf8"))) out.hits.push(name);
    } catch {
      out.unreadable.push(name);
    }
  }
  return out;
}

function plannedLiveKeys(plan: PlannedFile[]): string[] {
  const hits: string[] = [];
  for (const file of plan) {
    if (file.exists && fs.existsSync(file.abs) && fs.statSync(file.abs).isFile() && hasLiveKey(fs.readFileSync(file.abs, "utf8"))) {
      hits.push(file.rel);
    }
    if (hasLiveKey(file.content)) hits.push(`generated ${file.rel}`);
  }
  return hits;
}

function refuseLive(where: string[]): number {
  console.error(`gatefit init: refuse sk_live: a live Stripe secret is present in ${where.join(", ")}.`);
  console.error("Gatefit only works with test mode. Remove the live key, then rerun. Nothing was written.");
  return INIT_LIVE_KEY;
}

function inside(rootReal: string, target: string): boolean {
  const rel = path.relative(rootReal, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Where a write to abs actually lands once symlinks in its existing prefix resolve. */
function realTarget(abs: string): string {
  let existing = abs;
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...rest);
}

function escapes(cwd: string, plan: PlannedFile[]): string[] {
  const rootReal = fs.realpathSync(cwd);
  return plan.filter((file) => !inside(rootReal, realTarget(file.abs))).map((file) => file.rel);
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
    if (fs.existsSync(file.abs) && fs.statSync(file.abs).isDirectory()) blocked.add(file.rel);
  }
  return [...blocked];
}

/**
 * Stage every file next to its target, then move originals aside and rename the
 * staged files in. On any error, remove what this run created and put every
 * original back, so the project is left as it was.
 */
export function writeAll(plan: PlannedFile[], ops: WriteOps = fs): void {
  const suffix = `.gatefit-init-${process.pid}`;
  const createdDirs: string[] = [];
  const staged: { tmp: string; abs: string }[] = [];
  const backups: { abs: string; bak: string }[] = [];
  const installed: string[] = [];
  try {
    for (const file of plan) {
      const first = ops.mkdirSync(path.dirname(file.abs), { recursive: true });
      if (first) createdDirs.push(first);
      const tmp = `${file.abs}${suffix}.tmp`;
      ops.writeFileSync(tmp, file.content, { flag: "wx" });
      staged.push({ tmp, abs: file.abs });
    }
    for (const { tmp, abs } of staged) {
      if (present(abs, ops)) {
        const bak = `${abs}${suffix}.bak`;
        ops.renameSync(abs, bak);
        backups.push({ abs, bak });
      }
      ops.renameSync(tmp, abs);
      installed.push(abs);
    }
  } catch (err) {
    for (const { tmp } of staged) ops.rmSync(tmp, { force: true });
    for (const abs of installed) ops.rmSync(abs, { force: true });
    for (const { abs, bak } of backups.reverse()) ops.renameSync(bak, abs);
    for (const dir of createdDirs.reverse()) ops.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  for (const { bak } of backups) ops.rmSync(bak, { force: true });
}

function ciEnv(): boolean {
  const ci = process.env.CI;
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false";
}

async function askTemplate(choices: readonly InitTemplate[]): Promise<InitTemplate | undefined> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`gatefit init: template [${choices.join("/")}]: `)).trim();
    return (INIT_TEMPLATES as readonly string[]).includes(answer) ? (answer as InitTemplate) : undefined;
  } finally {
    rl.close();
  }
}

type InitFlags = {
  template?: string;
  dir?: string;
  force?: boolean;
  "dry-run"?: boolean;
  "no-prompt"?: boolean;
  "print-workflow"?: boolean;
  "write-workflow"?: boolean;
  help?: boolean;
};

export async function runInit(argv: string[]): Promise<number> {
  const cwd = path.resolve(userCwd());

  // Live keys first: before parsing, so neither a usage error nor a template
  // error can echo a key, and an env key wins over any other mistake.
  const pre = preflightLiveKeys(cwd, argv);
  if (pre.hits.length > 0) return refuseLive(pre.hits);
  if (pre.unreadable.length > 0) {
    console.error(`gatefit init: cannot read ${pre.unreadable.join(", ")} to check for a live Stripe key. Nothing was written.`);
    return INIT_ERROR;
  }
  for (const warning of pre.warnings) console.error(warning);

  let values: InitFlags;
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
        "no-prompt": { type: "boolean" },
        "print-workflow": { type: "boolean" },
        "write-workflow": { type: "boolean" },
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
  if (values["print-workflow"] && values["write-workflow"]) {
    console.error("gatefit init: use --print-workflow or --write-workflow, not both");
    return INIT_USAGE;
  }

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
    const found = detectTemplates(cwd);
    if (found.length === 1) {
      template = found[0]!;
      how = "detected";
    } else {
      const why =
        found.length === 0
          ? "no ORM found in package.json (drizzle-orm, @prisma/client or prisma, @supabase/supabase-js)"
          : `more than one ORM found in package.json (${found.join(", ")})`;
      const canAsk = process.stdin.isTTY === true && !values["no-prompt"] && !ciEnv();
      const asked = canAsk ? await askTemplate(found.length > 0 ? found : INIT_TEMPLATES) : undefined;
      if (!asked) {
        console.error(`gatefit init: ${why}; pass --template ${INIT_TEMPLATES.join("|")}. Nothing was written.`);
        return INIT_USAGE;
      }
      template = asked;
      how = "chosen";
    }
  }

  const dirAbs = path.resolve(cwd, values.dir ?? "gatefit");
  const dirRel = path.relative(cwd, dirAbs);
  if (dirRel === "" || dirRel.startsWith("..") || path.isAbsolute(dirRel)) {
    console.error(`gatefit init: --dir must be a subdirectory inside the project (${cwd})`);
    return INIT_USAGE;
  }

  const plan = planInit(cwd, template, dirRel, { writeWorkflow: values["write-workflow"] === true });
  const escaped = escapes(cwd, plan.files);
  if (escaped.length > 0) {
    console.error(`gatefit init: ${escaped.join(", ")} resolve outside the project through a symlink.`);
    console.error(`Every file must stay inside the project (${cwd}). Nothing was written.`);
    return INIT_USAGE;
  }

  const live = plannedLiveKeys(plan.files);
  if (live.length > 0) return refuseLive(live);

  if (values["print-workflow"]) {
    process.stdout.write(plan.workflow);
    return INIT_OK;
  }

  const blocked = blockedParents(cwd, plan.files);
  if (blocked.length > 0) {
    console.error(`gatefit init: cannot write through: ${blocked.join(", ")} (not a regular file path). Nothing was written.`);
    return INIT_CONFLICT;
  }
  const conflicts = plan.files.filter((f) => f.exists);
  if (conflicts.length > 0 && !values.force) {
    console.error("gatefit init: these files already exist. Nothing was written.");
    for (const f of conflicts) console.error(`  ${f.rel}`);
    console.error("Rerun with --force to overwrite them, or pick another --dir.");
    return INIT_CONFLICT;
  }

  const dry = values["dry-run"] === true;
  console.log(`gatefit init: template: ${template} (${how})${dry ? " [dry run, nothing written]" : ""}`);
  for (const f of plan.files) console.log(`  ${f.exists ? "overwrite" : "create"} ${f.rel}`);
  if (dry) return INIT_OK;

  try {
    writeAll(plan.files);
  } catch (err) {
    console.error(`gatefit init: write failed, project left as it was: ${err instanceof Error ? err.message : String(err)}`);
    return INIT_ERROR;
  }
  const dir = toPosix(dirRel);
  const adapter = `${dir}/adapter.ts`;
  console.log("");
  console.log("Next:");
  console.log("  1. npm install --save-dev gatefit pg");
  console.log(`  2. apply ${plan.migration} to a disposable Postgres (see ${dir}/README.md)`);
  console.log("  3. set DATABASE_URL to that test database (local or CI host only)");
  console.log(`  4. npx gatefit run --suite ${DEFAULT_SUITE} --adapter ${adapter}`);
  console.log(
    values["write-workflow"]
      ? `  5. commit ${WORKFLOW_REL}`
      : `  5. add CI: npx gatefit init --template ${template}${values.dir ? ` --dir ${dir}` : ""} --print-workflow`,
  );
  console.log(`  6. run the full free suite (S1–S9 and Phase 2): npx gatefit run --suite tests/entitlements/goldens --adapter ${adapter}`);
  console.log("HTTP 200 from Stripe is not access. Gatefit asserts the gatefit_access row.");
  return INIT_OK;
}

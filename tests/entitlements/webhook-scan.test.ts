import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FINDING_LINES, type FindingKind } from "../../src/webhook-scan.ts";

// Failure modes for `gatefit check-my-webhook`, encoded before the scanner:
// starter-kit shape flags possible missing dedupe and ordering (and the other
// gaps that shape has); a guarded handler is quiet; comments and strings do
// not count as safeguards; one removed guard flags only that guard; the
// command does not write, execute, phone home, or read a license key.

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const fixtures = path.join(root, "tests/fixtures/webhook-scan");
const starter = path.join(fixtures, "starter-kit");
const guarded = path.join(fixtures, "guarded");
const handlerRel = "pages/api/webhooks/stripe.ts";

const CLAIM = /\b(bug|vulnerability|definitely|confirmed)\b/i;
const LICENSE =
  "The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free.";

type SpawnResult = { status: number | null; stdout: string; stderr: string };

function childEnv(extra: NodeJS.ProcessEnv = {}, track = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.GATEFIT_LIVE_CLOCK;
  delete env.INIT_CWD;
  if (track) delete env.DO_NOT_TRACK;
  else env.DO_NOT_TRACK = "1";
  if (!extra.GATEFIT_TELEMETRY) env.GATEFIT_TELEMETRY = "0";
  if (!("GATEFIT_LICENSE_KEY" in extra)) delete env.GATEFIT_LICENSE_KEY;
  if (!("GATEFIT_LICENSE_VALIDATE_URL" in extra)) delete env.GATEFIT_LICENSE_VALIDATE_URL;
  if (!("GATEFIT_TELEMETRY_URL" in extra)) delete env.GATEFIT_TELEMETRY_URL;
  return env;
}

function run(args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}, track = false): SpawnResult {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv(extra, track),
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function copyFixture(name: "starter-kit" | "guarded"): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-"));
  fs.cpSync(path.join(fixtures, name), dest, { recursive: true });
  return dest;
}

function write(dir: string, rel: string, text: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function patch(dir: string, from: string, to: string): void {
  const file = path.join(dir, handlerRel);
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes(from), `patch anchor missing: ${from}`);
  fs.writeFileSync(file, text.replace(from, to));
}

function fingerprint(dir: string): string {
  const lines: string[] = [];
  const walk = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const st = fs.lstatSync(full);
      const rel = path.relative(dir, full);
      if (st.isSymbolicLink()) {
        lines.push(`link ${rel} ${fs.readlinkSync(full)} ${st.mode.toString(8)}`);
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      const hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      lines.push(`file ${rel} ${st.mode.toString(8)} ${st.size} ${hash}`);
    }
  };
  walk(dir);
  return lines.sort().join("\n");
}

function expectScan(dir: string, kinds: readonly FindingKind[], file = handlerRel): SpawnResult {
  const result = run(["check-my-webhook", "--dir", dir], root);
  const lines = result.stdout.trim().split("\n");
  const expected = [`gatefit check-my-webhook: ${file}`, ...kinds.map((kind) => FINDING_LINES[kind])];
  assert.deepEqual(lines, expected, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, kinds.length === 0 ? 0 : 1);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, CLAIM);
  for (const line of lines.slice(1)) assert.match(line, /^possible /);
  return result;
}

test("finding lines say possible and do not claim a defect", () => {
  for (const line of Object.values(FINDING_LINES)) {
    assert.match(line, /^possible /);
    assert.doesNotMatch(line, CLAIM);
  }
});

test("starter-kit-shaped handler flags possible missing dedupe and ordering", () => {
  const source = fs.readFileSync(path.join(starter, handlerRel), "utf8");
  assert.match(source, /boxyhq\/saas-starter-kit/);
  assert.match(source, /seen\.add\(event\.id\)/);
  assert.match(source, /event\.created < row\.lastEventCreated/);
  assert.match(source, /constructEvent/);
  assert.match(source, /active:\s*true/);
  assert.match(source, /onSubscriptionCreated\(event\)/);
  const before = fingerprint(starter);
  const result = expectScan(starter, ["dedupe", "ordering", "status_on_create", "recreate_deleted"]);
  assert.doesNotMatch(result.stdout, /missing signature check/);
  assert.equal(fingerprint(starter), before);
});

test("guarded handler stays quiet", () => {
  const before = fingerprint(guarded);
  const result = expectScan(guarded, []);
  assert.doesNotMatch(result.stdout, /possible/);
  assert.equal(fingerprint(guarded), before);
  const again = run(["check-my-webhook", "--dir", guarded], root);
  assert.equal(again.stdout, result.stdout);
  assert.equal(again.status, 0);
});

test("check-my-webhook is not license-gated", () => {
  const bare = run(["check-my-webhook", "--dir", guarded], root);
  const keyed = run(["check-my-webhook", "--dir", starter], root, {
    GATEFIT_LICENSE_KEY: "GATEFIT-not-a-real-key",
    GATEFIT_LICENSE_VALIDATE_URL: "http://127.0.0.1:9/validate",
  });
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(keyed.status, 1);
  assert.match(keyed.stdout, /possible missing event-id dedupe/);
  const text = `${bare.stdout}${bare.stderr}${keyed.stdout}${keyed.stderr}`;
  assert.doesNotMatch(text, /Indie License|GATEFIT_LICENSE_KEY|buy\.polar|api\.polar/);
});

test("check-my-webhook makes no network call and writes no telemetry file", async () => {
  const hits = { n: 0 };
  const server = createServer((_req, res) => {
    hits.n += 1;
    res.statusCode = 500;
    res.end("no");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}/v1/event`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-home-"));
  try {
    const result = run(["check-my-webhook", "--dir", starter], root, {
      GATEFIT_TELEMETRY: "1",
      GATEFIT_TELEMETRY_URL: url,
      GATEFIT_LICENSE_KEY: "GATEFIT-not-a-real-key",
      GATEFIT_LICENSE_VALIDATE_URL: url,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "xdg"),
    }, true);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(hits.n, 0);
    assert.equal(fs.existsSync(path.join(home, "xdg", "gatefit", "telemetry.json")), false);
    assert.equal(fs.existsSync(path.join(home, ".gatefit")), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("a comment or a string does not count as a safeguard", () => {
  const dir = copyFixture("starter-kit");
  const file = path.join(dir, handlerRel);
  fs.appendFileSync(
    file,
    '\nconsole.log("seen.add(event.id)");\nconsole.log("if (event.created < row.lastEventCreated) return;");\n',
  );
  expectScan(dir, ["dedupe", "ordering", "status_on_create", "recreate_deleted"]);
});

test("removing only the signature check flags only that gap", () => {
  const dir = copyFixture("guarded");
  patch(
    dir,
    "event = stripe.webhooks.constructEvent(raw, signature, secret);",
    "event = JSON.parse(raw) as Stripe.Event;",
  );
  expectScan(dir, ["signature"]);
});

test("removing only event-id dedupe flags only that gap", () => {
  const dir = copyFixture("guarded");
  patch(
    dir,
    '  if (seen.has(event.id)) return new Response("duplicate", { status: 200 });\n  seen.add(event.id);\n',
    "",
  );
  expectScan(dir, ["dedupe"]);
});

test("removing only the ordering comparison flags only that gap", () => {
  const dir = copyFixture("guarded");
  patch(dir, "  if (event.created < row.lastEventCreated) return;\n", "");
  expectScan(dir, ["ordering"]);
});

test("hardcoding access on create flags only that gap", () => {
  const dir = copyFixture("guarded");
  patch(
    dir,
    `  const status = subscription.status;
  const active = status === "active" || status === "trialing";
  rows.set(subscription.id, {
    id: subscription.id,
    active,
    lastEventCreated: event.created,
  });`,
    `  rows.set(subscription.id, {
    id: subscription.id,
    active: true,
    lastEventCreated: event.created,
  });`,
  );
  expectScan(dir, ["status_on_create"]);
});

test("an update that calls create when the row is missing flags only that gap", () => {
  const dir = copyFixture("guarded");
  patch(dir, "  if (!row) return;", "  if (!row) {\n    await onCreated(event);\n    return;\n  }");
  expectScan(dir, ["recreate_deleted"]);
});

test("an inlined switch flags the same gaps as the starter shape", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-inline-"));
  write(
    dir,
    handlerRel,
    `const stripe = { webhooks: { constructEvent: (_raw: string, _sig: string, _secret: string) => ({}) } };
const rows = new Map<string, unknown>();

export async function POST(req: { text: () => Promise<string>; headers: { get: (name: string) => string } }): Promise<void> {
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const event = stripe.webhooks.constructEvent(raw, signature, secret) as {
    type: string;
    data: { object: { id: string } };
  };
  const id = event.data.object.id;
  switch (event.type) {
    case "customer.subscription.created":
      await createTeamSubscription({ id, active: true });
      break;
    case "customer.subscription.updated":
      if (!rows.has(id)) await onSubscriptionCreated(event);
      break;
    case "customer.subscription.deleted":
      rows.delete(id);
      break;
    default:
      break;
  }
}

async function createTeamSubscription(input: { id: string; active: boolean }): Promise<void> {
  rows.set(input.id, input);
}

declare function onSubscriptionCreated(event: unknown): Promise<void>;
`,
  );
  expectScan(dir, ["dedupe", "ordering", "status_on_create", "recreate_deleted"]);
});

test("dedupe and ordering in a relative import keep the handler quiet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-import-"));
  write(
    dir,
    "pages/api/remember.ts",
    `const seen = new Set<string>();
export function remember(event: { id: string; created: number }, row: { lastEventCreated: number } | undefined): boolean {
  if (seen.has(event.id)) return true;
  seen.add(event.id);
  if (row && event.created < row.lastEventCreated) return true;
  return false;
}
`,
  );
  write(
    dir,
    handlerRel,
    `import { remember } from "../remember";

const stripe = { webhooks: { constructEvent: (_raw: string, _sig: string, _secret: string) => ({}) } };
const rows = new Map<string, { id: string; active: boolean; lastEventCreated: number }>();

export async function POST(req: { text: () => Promise<string>; headers: { get: (name: string) => string } }): Promise<Response> {
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  stripe.webhooks.constructEvent(raw, signature, secret);
  const event = JSON.parse(raw) as { id: string; created: number; type: string; data: { object: { id: string; status: string } } };
  if (remember(event, rows.get(event.data.object.id))) return new Response("skip");
  switch (event.type) {
    case "customer.subscription.created":
      await onCreated(event);
      break;
    case "customer.subscription.updated":
      await onUpdated(event);
      break;
    default:
      break;
  }
  return new Response("ok");
}

async function onCreated(event: { created: number; data: { object: { id: string; status: string } } }): Promise<void> {
  const status = event.data.object.status;
  const active = status === "active" || status === "trialing";
  rows.set(event.data.object.id, { id: event.data.object.id, active, lastEventCreated: event.created });
}

async function onUpdated(event: { created: number; data: { object: { id: string; status: string } } }): Promise<void> {
  const row = rows.get(event.data.object.id);
  if (!row) return;
  const status = event.data.object.status;
  row.active = status === "active" || status === "trialing";
  row.lastEventCreated = event.created;
}
`,
  );
  expectScan(dir, []);
});

test("node_modules is not scanned", () => {
  const dir = copyFixture("guarded");
  write(
    dir,
    "node_modules/evil/pages/api/webhooks/stripe.ts",
    'export const leak = "NM_ONLY_SECRET";\nexport const kind = "customer.subscription.created";\n',
  );
  const result = expectScan(dir, []);
  assert.doesNotMatch(result.stdout, /NM_ONLY_SECRET|node_modules/);
});

test("a directory symlink back to the scan root finishes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-cycle-"));
  fs.mkdirSync(path.join(dir, "pages/api/webhooks"), { recursive: true });
  fs.copyFileSync(path.join(guarded, handlerRel), path.join(dir, handlerRel));
  fs.symlinkSync(dir, path.join(dir, "pages/loop"));
  const result = spawnSync(process.execPath, [bin, "check-my-webhook", "--dir", dir], {
    cwd: root,
    encoding: "utf8",
    env: childEnv(),
    timeout: 8000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr ?? "");
  assert.match(result.stdout ?? "", /pages\/api\/webhooks\/stripe\.ts/);
  assert.doesNotMatch(result.stdout ?? "", /possible/);
});

test("a symlink that leaves the tree is not read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-outside-"));
  const secret = "symlink-secret-token";
  fs.writeFileSync(
    path.join(outside, "stripe.ts"),
    `export const leak = "${secret}";\nexport const kind = "customer.subscription.created";\n`,
  );
  fs.mkdirSync(path.join(dir, "pages/api/webhooks"), { recursive: true });
  fs.symlinkSync(path.join(outside, "stripe.ts"), path.join(dir, handlerRel));
  const result = run(["check-my-webhook", "--dir", dir], root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /no Stripe webhook handler found/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  assert.equal(fs.readFileSync(path.join(outside, "stripe.ts"), "utf8").includes(secret), true);
});

test("a source file over the size cap is skipped", () => {
  const dir = copyFixture("guarded");
  const body = `export const kind = "customer.subscription.created";\n// ${"x".repeat(300_000)}\n`;
  write(dir, "pages/api/webhooks/huge.ts", body);
  assert.ok(fs.statSync(path.join(dir, "pages/api/webhooks/huge.ts")).size > 256 * 1024);
  expectScan(dir, []);
});

test("the handler source is not executed", () => {
  const dir = copyFixture("starter-kit");
  const file = path.join(dir, handlerRel);
  fs.writeFileSync(file, `throw new Error("executed-webhook");\n${fs.readFileSync(file, "utf8")}`);
  const result = run(["check-my-webhook", "--dir", dir], root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /possible missing event-id dedupe/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /executed-webhook/);
});

test("report lines do not echo a secret stored in the handler", () => {
  const dir = copyFixture("starter-kit");
  patch(dir, 'const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";', 'const secret = "whsec_fixture_sample";');
  const result = run(["check-my-webhook", "--dir", dir], root);
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /whsec_fixture_sample/);
});

test("a sibling that is not a webhook handler is ignored", () => {
  const dir = copyFixture("guarded");
  write(
    dir,
    "access-rules.ts",
    `export function isCanceled(event: { type: string }): boolean {
  return event.type === "customer.subscription.deleted";
}
`,
  );
  expectScan(dir, []);
});

test("handlers are reported in path order", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-order-"));
  const text = fs.readFileSync(path.join(guarded, handlerRel), "utf8");
  write(dir, "b/webhooks/z.ts", text);
  write(dir, "a/webhooks/a.ts", text);
  const result = run(["check-my-webhook", "--dir", dir], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    ["gatefit check-my-webhook: a/webhooks/a.ts", "gatefit check-my-webhook: b/webhooks/z.ts"].join("\n"),
  );
});

test("the working directory is the default scan root", () => {
  const result = run(["check-my-webhook"], guarded);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pages\/api\/webhooks\/stripe\.ts/);
  assert.doesNotMatch(result.stdout, /possible/);
});

test("a single file can be scanned", () => {
  const result = run(["check-my-webhook", "--dir", path.join(guarded, handlerRel)], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "gatefit check-my-webhook: stripe.ts");
});

test("a missing path is an error and is not created", () => {
  const missing = path.join(os.tmpdir(), `gatefit-webhook-missing-${process.pid}-${Date.now()}`);
  fs.rmSync(missing, { recursive: true, force: true });
  const result = run(["check-my-webhook", "--dir", missing], root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /path not found/);
  assert.doesNotMatch(result.stderr, /possible/);
  assert.equal(fs.existsSync(missing), false);
});

test("an empty directory reports that no handler was found", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-webhook-empty-"));
  const result = run(["check-my-webhook", "--dir", dir], root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no Stripe webhook handler found/);
  assert.doesNotMatch(result.stdout, /possible missing/);
});

test("help lists check-my-webhook and an unknown flag is usage", () => {
  const help = run(["--help"], root);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /gatefit check-my-webhook \[--dir <path>\]/);
  const commandHelp = run(["check-my-webhook", "--help"], root);
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /check-my-webhook/);
  const unknown = run(["check-my-webhook", "--bogus"], root);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /check-my-webhook/);
});

test("the scanner module does not write, spawn, or call the network", () => {
  const src = fs.readFileSync(path.join(root, "src/webhook-scan.ts"), "utf8");
  for (const banned of [
    "writeFile",
    "appendFile",
    "mkdir",
    "rmSync",
    "unlink",
    "renameSync",
    "copyFile",
    "chmod",
    "fetch(",
    "http.request",
    "https.request",
    "net.connect",
    "child_process",
    "ensureProLicense",
    "node:http",
    "node:https",
    "node:net",
  ]) {
    assert.equal(src.includes(banned), false, banned);
  }
  const cli = fs.readFileSync(path.join(root, "src/cli.ts"), "utf8");
  const fn = cli.slice(cli.indexOf("function cmdCheckMyWebhook"), cli.indexOf("async function cmdAdapterCheck"));
  assert.ok(fn.includes("scanWebhookTree"));
  assert.doesNotMatch(fn, /ensureProLicense|fetch\(|GATEFIT_LICENSE/);
});

test("docs page and onboarding mention the free read-only command", () => {
  const doc = fs.readFileSync(path.join(root, "docs/check-my-webhook.md"), "utf8");
  const site = fs.readFileSync(path.join(root, "site/src/content/docs/check-my-webhook.md"), "utf8");
  const onboarding = fs.readFileSync(path.join(root, "docs/onboarding.md"), "utf8");
  const siteOnboarding = fs.readFileSync(path.join(root, "site/src/content/docs/onboarding.md"), "utf8");
  const sidebar = fs.readFileSync(path.join(root, "site/astro.config.mjs"), "utf8");
  for (const page of [doc, site]) {
    assert.ok(page.includes(LICENSE));
    assert.match(page, /check-my-webhook/);
    assert.match(page, /does not write/i);
    assert.match(page, /does not use the network/i);
    assert.match(page, /GATEFIT_LICENSE_KEY/);
    assert.match(page, /0\.8\.0/);
    assert.ok(page.includes(FINDING_LINES.dedupe));
    assert.ok(page.includes(FINDING_LINES.ordering));
    assert.doesNotMatch(page, CLAIM);
    assert.doesNotMatch(page, /\$19|coming soon|fixture goldens/i);
  }
  assert.match(site, /^---\ntitle: Check my webhook\n/);
  assert.match(onboarding, /check-my-webhook/);
  assert.match(siteOnboarding, /check-my-webhook/);
  assert.match(sidebar, /slug:\s*'check-my-webhook'/);
  assert.ok(onboarding.includes(LICENSE));
  assert.ok(siteOnboarding.includes(LICENSE));
});

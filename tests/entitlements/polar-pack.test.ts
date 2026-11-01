import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const BUY = /gatefit\.io\/#pricing/;
const VALID_KEY = "GATEFIT-H24-VALID-KEY";
const INVALID_KEY = "GATEFIT-H24-INVALID-KEY";
const NAIVE = "src/adapters/naive.ts";
const HARDENED = "src/adapters/hardened.ts";
const SQLITE = "src/adapters/sqlite.ts";
const POLAR_DIR = "src/packs/polar/goldens";
const S_DIR = "tests/entitlements/goldens";

// Token literals are built at runtime so no secret-shaped string lands in git.
const OAT = ["polar", "oat", "x".repeat(24)].join("_");
const PAT = ["polar", "pat", "y".repeat(24)].join("_");
const CHECKOUT_LINK = `https://buy.polar.sh/${["polar", "cl", "z".repeat(24)].join("_")}`;

type Hit = { method: string; url: string };

function listen(reply: () => { status: number; json: unknown }): Promise<{
  url: string;
  hits: Hit[];
  close: () => Promise<void>;
}> {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      hits.push({ method: req.method ?? "", url: req.url ?? "" });
      const result = reply();
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.json));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}/v1/customer-portal/license-keys/validate`,
        hits,
        close: () =>
          new Promise((done, reject) => {
            server.close((err) => (err ? reject(err) : done()));
          }),
      });
    });
  });
}

function cacheFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-polar-")), "cache.json");
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  cache: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, GATEFIT_LICENSE_CACHE: cache };
  for (const name of ["GATEFIT_LIVE_CLOCK", "GATEFIT_LICENSE_KEY", "GATEFIT_LICENSE_VALIDATE_URL", "GATEFIT_CHAOS_SEED"]) {
    if (!(name in env)) delete childEnv[name];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root, env: childEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr}`;
}

function polarArgs(adapter: string): string[] {
  return ["run", "--suite", "polar", "--adapter", adapter];
}

function granted() {
  return listen(() => ({ status: 200, json: { status: "granted" } }));
}

function refusing() {
  return listen(() => {
    throw new Error("this run must not contact the license endpoint");
  });
}

function licensed(key: string, url: string): NodeJS.ProcessEnv {
  return { GATEFIT_LICENSE_KEY: key, GATEFIT_LICENSE_VALIDATE_URL: url };
}

function goldenFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort()
    .map((name) => path.join(root, dir, name));
}

function goldenId(file: string): string {
  const match = fs.readFileSync(file, "utf8").match(/^id:\s*(\S+)\s*$/m);
  if (!match?.[1]) throw new Error(`golden id missing: ${file}`);
  return match[1];
}

function polarSchema(): string {
  const source = fs.readFileSync(path.join(root, "src/polar-pack.ts"), "utf8");
  const match = source.match(/export const POLAR_SCHEMA = "([^"]+)";/);
  if (!match?.[1]) throw new Error("POLAR_SCHEMA constant missing from src/polar-pack.ts");
  return match[1];
}

function sqliteAvailable(): string | undefined {
  try {
    const require = createRequire(path.join(root, "package.json"));
    const Database = require("better-sqlite3") as new (file: string) => { close(): void };
    new Database(":memory:").close();
    return undefined;
  } catch {
    return "better-sqlite3 native module is not installed; the sqlite Polar lane needs it";
  }
}

function writeAdapter(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-polar-adapter-"));
  const file = path.join(dir, "adapter.ts");
  fs.writeFileSync(file, source);
  return file;
}

test("polar with no key exits non-zero, prints the buy link, and never contacts Polar", async () => {
  const mock = await refusing();
  try {
    const result = await run(polarArgs(HARDENED), { GATEFIT_LICENSE_VALIDATE_URL: mock.url }, cacheFile());
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /GATEFIT_LICENSE_KEY/);
    assert.match(text, BUY);
    assert.equal(mock.hits.length, 0);
    assert.doesNotMatch(text, /PASS polar/);
  } finally {
    await mock.close();
  }
});

test("polar with an invalid key exits non-zero and does not leak the key", async () => {
  const cache = cacheFile();
  const mock = await listen(() => ({ status: 404, json: { error: "ResourceNotFound", detail: "Not found" } }));
  try {
    const result = await run(polarArgs(HARDENED), licensed(INVALID_KEY, mock.url), cache);
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, BUY);
    assert.doesNotMatch(text, /PASS polar/);
    assert.equal(text.includes(INVALID_KEY), false);
    if (fs.existsSync(cache)) assert.equal(fs.readFileSync(cache, "utf8").includes(INVALID_KEY), false);
  } finally {
    await mock.close();
  }
});

test("hardened adapter passes every Polar golden with a valid key", async () => {
  const cache = cacheFile();
  const mock = await granted();
  try {
    const result = await run(polarArgs(HARDENED), licensed(VALID_KEY, mock.url), cache);
    const text = output(result);
    assert.equal(result.status, 0, text);
    const ids = goldenFiles(POLAR_DIR).map(goldenId);
    assert.equal(ids.length, 9);
    for (const id of ids) {
      assert.match(result.stderr, new RegExp(`^gatefit: PASS polar ${id}$`, "m"), id);
    }
    assert.match(result.stderr, /^gatefit: PASS polar$/m);
    assert.doesNotMatch(text, /FAIL polar/);
    assert.equal(text.includes(VALID_KEY), false);
    if (fs.existsSync(cache)) assert.equal(fs.readFileSync(cache, "utf8").includes(VALID_KEY), false);
  } finally {
    await mock.close();
  }
});

test("naive adapter that trusts HTTP 200 fails the Polar pack", async () => {
  const mock = await granted();
  try {
    const result = await run(polarArgs(NAIVE), licensed(VALID_KEY, mock.url), cacheFile());
    const text = output(result);
    assert.notEqual(result.status, 0, text);
    assert.match(text, /^gatefit: FAIL polar polar_order_paid_grants$/m);
    assert.match(text, /^gatefit: FAIL polar polar_checkout_return_before_webhook$/m);
    assert.match(text, /step \d+: locked: expected true, got false/);
    assert.doesNotMatch(text, /^gatefit: PASS polar$/m);
  } finally {
    await mock.close();
  }
});

test("sqlite adapter passes every Polar golden", async (t) => {
  const reason = sqliteAvailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const mock = await granted();
  try {
    const result = await run(polarArgs(SQLITE), licensed(VALID_KEY, mock.url), cacheFile());
    assert.equal(result.status, 0, output(result));
    assert.match(result.stderr, /^gatefit: PASS polar$/m);
  } finally {
    await mock.close();
  }
});

test("running the Polar golden directory as a free suite is still gated", async () => {
  const mock = await refusing();
  try {
    for (const suite of [POLAR_DIR, `${POLAR_DIR}/polar_order_paid_grants.yaml`, path.join(root, POLAR_DIR)]) {
      const result = await run(
        ["run", "--suite", suite, "--adapter", HARDENED],
        { GATEFIT_LICENSE_VALIDATE_URL: mock.url },
        cacheFile(),
      );
      const text = output(result);
      assert.notEqual(result.status, 0, `${suite}: ${text}`);
      assert.match(text, BUY, suite);
      assert.doesNotMatch(text, /PASS polar/, suite);
    }
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("free S1-S9 run with no key and chaos still lists only the S goldens", async () => {
  const silent = await refusing();
  try {
    const free = await run(
      ["run", "--suite", S_DIR, "--adapter", HARDENED],
      { GATEFIT_LICENSE_VALIDATE_URL: silent.url },
      cacheFile(),
    );
    const text = output(free);
    assert.equal(free.status, 0, text);
    assert.doesNotMatch(text, /polar/i);
    assert.equal(silent.hits.length, 0);
  } finally {
    await silent.close();
  }
  const mock = await granted();
  try {
    const chaos = await run(
      ["run", "--suite", "chaos", "--adapter", HARDENED],
      licensed(VALID_KEY, mock.url),
      cacheFile(),
    );
    assert.equal(chaos.status, 0, output(chaos));
    const passed = chaos.stderr.match(/^gatefit: PASS chaos \S+$/gm) ?? [];
    assert.deepEqual(
      passed.map((line) => line.replace("gatefit: PASS chaos ", "")),
      goldenFiles(S_DIR).map(goldenId),
    );
    assert.doesNotMatch(output(chaos), /polar_/);
  } finally {
    await mock.close();
  }
});

test("polar refuses Polar access tokens in env or adapter source without echoing them", async () => {
  const mock = await granted();
  try {
    for (const token of [OAT, PAT]) {
      const fromEnv = await run(
        polarArgs(HARDENED),
        { ...licensed(VALID_KEY, mock.url), POLAR_ACCESS_TOKEN: token },
        cacheFile(),
      );
      const envText = output(fromEnv);
      assert.notEqual(fromEnv.status, 0, envText);
      assert.match(envText, /refuse/i);
      assert.equal(envText.includes(token), false, "token echoed");
      assert.doesNotMatch(envText, /PASS polar/);
    }
    const leaky = writeAdapter(
      `export { createAdapter, default } from ${JSON.stringify(path.join(root, HARDENED))};\nexport const token = ${JSON.stringify(OAT)};\n`,
    );
    const fromSource = await run(polarArgs(leaky), licensed(VALID_KEY, mock.url), cacheFile());
    const sourceText = output(fromSource);
    assert.notEqual(fromSource.status, 0, sourceText);
    assert.match(sourceText, /refuse/i);
    assert.equal(sourceText.includes(OAT), false, "token echoed");
  } finally {
    await mock.close();
  }
});

test("polar refuses sk_live and accepts polar_cl_ checkout links", async () => {
  const mock = await granted();
  try {
    const live = ["sk", "live", "q".repeat(24)].join("_");
    const refused = await run(
      polarArgs(HARDENED),
      { ...licensed(VALID_KEY, mock.url), STRIPE_SECRET_KEY: live },
      cacheFile(),
    );
    assert.notEqual(refused.status, 0);
    assert.equal(output(refused).includes(live), false);
    const link = writeAdapter(
      `export { createAdapter, default } from ${JSON.stringify(path.join(root, HARDENED))};\nexport const checkout = ${JSON.stringify(CHECKOUT_LINK)};\n`,
    );
    const ok = await run(
      polarArgs(link),
      { ...licensed(VALID_KEY, mock.url), PUBLIC_POLAR_CHECKOUT_URL: CHECKOUT_LINK },
      cacheFile(),
    );
    assert.equal(ok.status, 0, output(ok));
    assert.match(ok.stderr, /^gatefit: PASS polar$/m);
  } finally {
    await mock.close();
  }
});

test("every Polar golden cites POLAR_SCHEMA and repeated runs are byte-identical", async () => {
  const schema = polarSchema();
  assert.match(schema, /^v1@\d{4}-\d{2}-\d{2}$/);
  for (const file of goldenFiles(POLAR_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, new RegExp(`^# POLAR_SCHEMA ${schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"), file);
    assert.match(text, /^# HTTP 200 is not access\./m, file);
    assert.match(goldenId(file), /^polar_/, file);
  }
  const mock = await granted();
  try {
    const env = licensed(VALID_KEY, mock.url);
    const cache = cacheFile();
    const first = await run(polarArgs(HARDENED), env, cache);
    const second = await run(polarArgs(HARDENED), env, cache);
    assert.equal(first.status, 0, output(first));
    assert.equal(second.stdout, first.stdout);
    assert.equal(second.stderr, first.stderr);
    assert.match(first.stderr, new RegExp(`gatefit polar: schema ${schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    await mock.close();
  }
});

test("polar refuses GATEFIT_LIVE_CLOCK", async () => {
  const mock = await granted();
  try {
    const result = await run(
      polarArgs(HARDENED),
      { ...licensed(VALID_KEY, mock.url), GATEFIT_LIVE_CLOCK: "1" },
      cacheFile(),
    );
    assert.notEqual(result.status, 0);
    assert.match(output(result), /GATEFIT_LIVE_CLOCK/);
    assert.doesNotMatch(output(result), /PASS polar/);
  } finally {
    await mock.close();
  }
});

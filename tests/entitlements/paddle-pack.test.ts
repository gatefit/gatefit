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
const PADDLE_DIR = "src/packs/paddle/goldens";
const S_DIR = "tests/entitlements/goldens";

// Token literals are built at runtime so no secret-shaped string lands in git.
const LIVE_KEY = ["pdl", "live", "apikey", "x".repeat(24)].join("_");
const SANDBOX_KEY = ["pdl", "sdbx", "apikey", "y".repeat(24)].join("_");
const NOTIFICATION_SECRET = ["pdl", "ntfset", "w".repeat(24)].join("_");
const PADDLE_KEYS = [LIVE_KEY, SANDBOX_KEY, NOTIFICATION_SECRET];
// Paddle client-side tokens are public (Paddle.js); they are not refused.
const CLIENT_TOKEN = ["live", "z".repeat(27)].join("_");
const POLAR_DIR = "src/packs/polar/goldens";

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
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-paddle-")), "cache.json");
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

function paddleArgs(adapter: string): string[] {
  return ["run", "--suite", "paddle", "--adapter", adapter];
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

function paddleSchema(): string {
  const source = fs.readFileSync(path.join(root, "src/paddle-pack.ts"), "utf8");
  const match = source.match(/export const PADDLE_SCHEMA = "([^"]+)";/);
  if (!match?.[1]) throw new Error("PADDLE_SCHEMA constant missing from src/paddle-pack.ts");
  return match[1];
}

function sqliteAvailable(): string | undefined {
  try {
    const require = createRequire(path.join(root, "package.json"));
    const Database = require("better-sqlite3") as new (file: string) => { close(): void };
    new Database(":memory:").close();
    return undefined;
  } catch {
    return "better-sqlite3 native module is not installed; the sqlite Paddle lane needs it";
  }
}

function writeAdapter(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-paddle-adapter-"));
  const file = path.join(dir, "adapter.ts");
  fs.writeFileSync(file, source);
  return file;
}

test("paddle with no key exits non-zero, prints the buy link, and never contacts the license endpoint", async () => {
  const mock = await refusing();
  try {
    const result = await run(paddleArgs(HARDENED), { GATEFIT_LICENSE_VALIDATE_URL: mock.url }, cacheFile());
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /GATEFIT_LICENSE_KEY/);
    assert.match(text, BUY);
    assert.equal(mock.hits.length, 0);
    assert.doesNotMatch(text, /PASS paddle/);
  } finally {
    await mock.close();
  }
});

test("paddle with an invalid key exits non-zero and does not leak the key", async () => {
  const cache = cacheFile();
  const mock = await listen(() => ({ status: 404, json: { error: "ResourceNotFound", detail: "Not found" } }));
  try {
    const result = await run(paddleArgs(HARDENED), licensed(INVALID_KEY, mock.url), cache);
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, BUY);
    assert.doesNotMatch(text, /PASS paddle/);
    assert.equal(text.includes(INVALID_KEY), false);
    if (fs.existsSync(cache)) assert.equal(fs.readFileSync(cache, "utf8").includes(INVALID_KEY), false);
  } finally {
    await mock.close();
  }
});

test("hardened adapter passes every Paddle golden with a valid key", async () => {
  const cache = cacheFile();
  const mock = await granted();
  try {
    const result = await run(paddleArgs(HARDENED), licensed(VALID_KEY, mock.url), cache);
    const text = output(result);
    assert.equal(result.status, 0, text);
    const ids = goldenFiles(PADDLE_DIR).map(goldenId);
    assert.equal(ids.length, 9);
    for (const id of ids) {
      assert.match(result.stderr, new RegExp(`^gatefit: PASS paddle ${id}$`, "m"), id);
    }
    assert.match(result.stderr, /^gatefit: PASS paddle$/m);
    assert.doesNotMatch(text, /FAIL paddle/);
    assert.equal(text.includes(VALID_KEY), false);
    if (fs.existsSync(cache)) assert.equal(fs.readFileSync(cache, "utf8").includes(VALID_KEY), false);
  } finally {
    await mock.close();
  }
});

test("naive adapter that trusts HTTP 200 fails the Paddle pack", async () => {
  const mock = await granted();
  try {
    const result = await run(paddleArgs(NAIVE), licensed(VALID_KEY, mock.url), cacheFile());
    const text = output(result);
    assert.notEqual(result.status, 0, text);
    assert.match(text, /^gatefit: FAIL paddle paddle_transaction_completed_grants$/m);
    assert.match(text, /^gatefit: FAIL paddle paddle_checkout_return_before_webhook$/m);
    assert.match(text, /step \d+: locked: expected true, got false/);
    assert.doesNotMatch(text, /^gatefit: PASS paddle$/m);
  } finally {
    await mock.close();
  }
});

test("sqlite adapter passes every Paddle golden", async (t) => {
  const reason = sqliteAvailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const mock = await granted();
  try {
    const result = await run(paddleArgs(SQLITE), licensed(VALID_KEY, mock.url), cacheFile());
    assert.equal(result.status, 0, output(result));
    assert.match(result.stderr, /^gatefit: PASS paddle$/m);
  } finally {
    await mock.close();
  }
});

test("running the Paddle golden directory as a free suite is still gated", async () => {
  const mock = await refusing();
  try {
    for (const suite of [PADDLE_DIR, `${PADDLE_DIR}/paddle_transaction_completed_grants.yaml`, path.join(root, PADDLE_DIR)]) {
      const result = await run(
        ["run", "--suite", suite, "--adapter", HARDENED],
        { GATEFIT_LICENSE_VALIDATE_URL: mock.url },
        cacheFile(),
      );
      const text = output(result);
      assert.notEqual(result.status, 0, `${suite}: ${text}`);
      assert.match(text, BUY, suite);
      assert.doesNotMatch(text, /PASS paddle/, suite);
    }
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("free S1-S12 run with no key and chaos still lists only the S goldens", async () => {
  const silent = await refusing();
  try {
    const free = await run(
      ["run", "--suite", S_DIR, "--adapter", HARDENED],
      { GATEFIT_LICENSE_VALIDATE_URL: silent.url },
      cacheFile(),
    );
    const text = output(free);
    assert.equal(free.status, 0, text);
    assert.doesNotMatch(text, /paddle/i);
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
    assert.doesNotMatch(output(chaos), /paddle_/);
  } finally {
    await mock.close();
  }
});

test("paddle refuses Paddle API keys and notification secrets in env or adapter source without echoing them", async () => {
  const mock = await granted();
  try {
    for (const token of PADDLE_KEYS) {
      const fromEnv = await run(
        paddleArgs(HARDENED),
        { ...licensed(VALID_KEY, mock.url), PADDLE_API_KEY: token },
        cacheFile(),
      );
      const envText = output(fromEnv);
      assert.notEqual(fromEnv.status, 0, envText);
      assert.match(envText, /refuse/i);
      assert.equal(envText.includes(token), false, "token echoed");
      assert.doesNotMatch(envText, /PASS paddle/);
    }
    const leaky = writeAdapter(
      `export { createAdapter, default } from ${JSON.stringify(path.join(root, HARDENED))};\nexport const token = ${JSON.stringify(LIVE_KEY)};\n`,
    );
    const fromSource = await run(paddleArgs(leaky), licensed(VALID_KEY, mock.url), cacheFile());
    const sourceText = output(fromSource);
    assert.notEqual(fromSource.status, 0, sourceText);
    assert.match(sourceText, /refuse/i);
    assert.equal(sourceText.includes(LIVE_KEY), false, "token echoed");
  } finally {
    await mock.close();
  }
});

test("paddle refuses sk_live and accepts a public Paddle client-side token", async () => {
  const mock = await granted();
  try {
    const live = ["sk", "live", "q".repeat(24)].join("_");
    const refused = await run(
      paddleArgs(HARDENED),
      { ...licensed(VALID_KEY, mock.url), STRIPE_SECRET_KEY: live },
      cacheFile(),
    );
    assert.notEqual(refused.status, 0);
    assert.equal(output(refused).includes(live), false);
    const link = writeAdapter(
      `export { createAdapter, default } from ${JSON.stringify(path.join(root, HARDENED))};\nexport const clientToken = ${JSON.stringify(CLIENT_TOKEN)};\n`,
    );
    const ok = await run(
      paddleArgs(link),
      { ...licensed(VALID_KEY, mock.url), PUBLIC_PADDLE_CLIENT_TOKEN: CLIENT_TOKEN },
      cacheFile(),
    );
    assert.equal(ok.status, 0, output(ok));
    assert.match(ok.stderr, /^gatefit: PASS paddle$/m);
  } finally {
    await mock.close();
  }
});

test("every Paddle golden cites PADDLE_SCHEMA and repeated runs are byte-identical", async () => {
  const schema = paddleSchema();
  assert.match(schema, /^v1\+fixtures\.\d+$/);
  assert.doesNotMatch(schema, /\d{4}-\d{2}-\d{2}/);
  for (const file of goldenFiles(PADDLE_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, new RegExp(`^# PADDLE_SCHEMA ${schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "m"), file);
    assert.match(text, /^# HTTP 200 is not access\./m, file);
    assert.match(goldenId(file), /^paddle_/, file);
  }
  const mock = await granted();
  try {
    const env = licensed(VALID_KEY, mock.url);
    const cache = cacheFile();
    const first = await run(paddleArgs(HARDENED), env, cache);
    const second = await run(paddleArgs(HARDENED), env, cache);
    assert.equal(first.status, 0, output(first));
    assert.equal(second.stdout, first.stdout);
    assert.equal(second.stderr, first.stderr);
    assert.match(first.stderr, new RegExp(`gatefit paddle: schema ${schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    await mock.close();
  }
});

test("paddle refuses GATEFIT_LIVE_CLOCK", async () => {
  const mock = await granted();
  try {
    const result = await run(
      paddleArgs(HARDENED),
      { ...licensed(VALID_KEY, mock.url), GATEFIT_LIVE_CLOCK: "1" },
      cacheFile(),
    );
    assert.notEqual(result.status, 0);
    assert.match(output(result), /GATEFIT_LIVE_CLOCK/);
    assert.doesNotMatch(output(result), /PASS paddle/);
  } finally {
    await mock.close();
  }
});

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function paddlePaths(): string[] {
  return [PADDLE_DIR, path.join(root, PADDLE_DIR), `${PADDLE_DIR}/paddle_transaction_completed_grants.yaml`];
}

test("licensed Paddle golden directory path runs like --suite paddle", async () => {
  const mock = await granted();
  const schema = paddleSchema().replace(ESCAPE, "\\$&");
  try {
    for (const suite of paddlePaths()) {
      const result = await run(["run", "--suite", suite, "--adapter", HARDENED], licensed(VALID_KEY, mock.url), cacheFile());
      const text = output(result);
      assert.equal(result.status, 0, `${suite}: ${text}`);
      assert.match(result.stderr, new RegExp(`^gatefit paddle: schema ${schema}$`, "m"), suite);
      assert.match(result.stderr, /^gatefit: PASS paddle$/m, suite);
      const passed = result.stderr.match(/^gatefit: PASS paddle \S+$/gm) ?? [];
      if (suite.endsWith(".yaml")) {
        assert.deepEqual(passed, ["gatefit: PASS paddle paddle_transaction_completed_grants"], suite);
      } else {
        assert.equal(passed.length, goldenFiles(PADDLE_DIR).length, suite);
      }
      assert.doesNotMatch(result.stderr, /^gatefit: PASS paddle_/m, suite);
    }
  } finally {
    await mock.close();
  }
});

test("licensed Paddle golden directory path refuses Paddle keys and GATEFIT_LIVE_CLOCK", async () => {
  const mock = await granted();
  const leaky = writeAdapter(
    `export { createAdapter, default } from ${JSON.stringify(path.join(root, HARDENED))};\nexport const token = ${JSON.stringify(SANDBOX_KEY)};\n`,
  );
  try {
    for (const suite of paddlePaths()) {
      const cases: { adapter: string; env: NodeJS.ProcessEnv; secret?: string; pattern: RegExp }[] = [
        { adapter: HARDENED, env: { PADDLE_NOTIFICATION_SECRET: NOTIFICATION_SECRET }, secret: NOTIFICATION_SECRET, pattern: /refuse/i },
        { adapter: leaky, env: {}, secret: SANDBOX_KEY, pattern: /refuse/i },
        { adapter: HARDENED, env: { GATEFIT_LIVE_CLOCK: "1" }, pattern: /GATEFIT_LIVE_CLOCK/ },
      ];
      for (const c of cases) {
        const result = await run(
          ["run", "--suite", suite, "--adapter", c.adapter],
          { ...licensed(VALID_KEY, mock.url), ...c.env },
          cacheFile(),
        );
        const text = output(result);
        assert.notEqual(result.status, 0, `${suite}: ${text}`);
        assert.match(text, c.pattern, suite);
        assert.doesNotMatch(text, /PASS/, suite);
        if (c.secret) assert.equal(text.includes(c.secret), false, "token echoed");
      }
    }
  } finally {
    await mock.close();
  }
});

test("a --suite path mixing Paddle and free goldens is refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-mixed-"));
  fs.symlinkSync(path.join(root, PADDLE_DIR, "paddle_transaction_completed_grants.yaml"), path.join(dir, "a.yaml"));
  fs.symlinkSync(path.join(root, S_DIR, "paid_grants_access.yaml"), path.join(dir, "b.yaml"));
  for (const make of [refusing, granted]) {
    const mock = await make();
    try {
      const env = make === granted ? licensed(VALID_KEY, mock.url) : { GATEFIT_LICENSE_VALIDATE_URL: mock.url };
      const result = await run(["run", "--suite", dir, "--adapter", HARDENED], env, cacheFile());
      const text = output(result);
      assert.equal(result.status, 1, text);
      assert.match(text, /mixed pack and free goldens/);
      assert.doesNotMatch(text, /PASS/);
      if (make === refusing) assert.equal(mock.hits.length, 0);
    } finally {
      await mock.close();
    }
  }
});

test("a --suite path mixing Paddle and Polar goldens is refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-mixed-packs-"));
  fs.symlinkSync(path.join(root, PADDLE_DIR, "paddle_transaction_completed_grants.yaml"), path.join(dir, "a.yaml"));
  fs.symlinkSync(path.join(root, POLAR_DIR, "polar_order_paid_grants.yaml"), path.join(dir, "b.yaml"));
  for (const make of [refusing, granted]) {
    const mock = await make();
    try {
      const env = make === granted ? licensed(VALID_KEY, mock.url) : { GATEFIT_LICENSE_VALIDATE_URL: mock.url };
      const result = await run(["run", "--suite", dir, "--adapter", HARDENED], env, cacheFile());
      const text = output(result);
      assert.equal(result.status, 1, text);
      assert.match(text, /mixed pack and free goldens/);
      assert.doesNotMatch(text, /PASS/);
      if (make === refusing) assert.equal(mock.hits.length, 0);
    } finally {
      await mock.close();
    }
  }
});

test("paddle goldens tag every shared subscription name with provider: paddle", () => {
  const shared = /^\s+type: subscription\.(created|updated|canceled)\s*$/;
  for (const file of goldenFiles(PADDLE_DIR)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!shared.test(line)) return;
      const step: string[] = [];
      for (let i = index + 1; i < lines.length && !/^\s+(- event:|expect:)/.test(lines[i]!); i += 1) step.push(lines[i]!);
      assert.ok(step.some((l) => /^\s+provider: paddle\s*$/.test(l)), `${path.basename(file)}:${index + 1} untagged`);
    });
  }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const BUY = "https://gatefit.io/#pricing";
const VALID_KEY = "GATEFIT-H17-VALID-KEY";
const INVALID_KEY = "GATEFIT-H17-INVALID-KEY";
const NAIVE = "src/adapters/naive.ts";
const HARDENED = "src/adapters/hardened.ts";

type Hit = { method: string; url: string; body: unknown };

function listen(reply: (body: unknown) => { status: number; json: unknown }): Promise<{
  url: string;
  hits: Hit[];
  close: () => Promise<void>;
}> {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
      hits.push({ method: req.method ?? "", url: req.url ?? "", body });
      const result = reply(body);
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
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-chaos-")), "cache.json");
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  cache: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, GATEFIT_LICENSE_CACHE: cache };
  if (!("GATEFIT_LIVE_CLOCK" in env)) delete childEnv.GATEFIT_LIVE_CLOCK;
  if (!("GATEFIT_LICENSE_KEY" in env)) delete childEnv.GATEFIT_LICENSE_KEY;
  if (!("GATEFIT_LICENSE_VALIDATE_URL" in env)) delete childEnv.GATEFIT_LICENSE_VALIDATE_URL;
  if (!("GATEFIT_CHAOS_SEED" in env)) delete childEnv.GATEFIT_CHAOS_SEED;
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

function assertNoKey(text: string, key: string): void {
  assert.equal(text.includes(key), false, "raw license key leaked");
}

function chaosArgs(adapter: string, extra: string[] = []): string[] {
  return ["run", "--suite", "chaos", "--adapter", adapter, ...extra];
}

function granted() {
  return listen(() => ({ status: 200, json: { status: "granted" } }));
}

function licensed(key: string, url: string): NodeJS.ProcessEnv {
  return { GATEFIT_LICENSE_KEY: key, GATEFIT_LICENSE_VALIDATE_URL: url };
}

function goldenIds(): string[] {
  const dir = path.join(root, "tests/entitlements/goldens");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort()
    .map((name) => {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const match = text.match(/^id:\s*(\S+)\s*$/m);
      if (!match?.[1]) throw new Error(`golden id missing: ${name}`);
      return match[1];
    });
}

test("chaos with no key exits non-zero and prints the buy link", async () => {
  const cache = cacheFile();
  const mock = await listen(() => {
    throw new Error("missing key contacted the license endpoint");
  });
  try {
    const result = await run(chaosArgs(HARDENED), { GATEFIT_LICENSE_VALIDATE_URL: mock.url }, cache);
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /GATEFIT_LICENSE_KEY/);
    assert.match(text, new RegExp(BUY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(mock.hits.length, 0);
    assert.doesNotMatch(text, /checkout\.session\.completed/);
    assert.doesNotMatch(text, /PASS chaos/);
  } finally {
    await mock.close();
  }
});

test("chaos with an invalid key exits non-zero and does not leak the key", async () => {
  const cache = cacheFile();
  const mock = await listen(() => ({ status: 404, json: { error: "ResourceNotFound", detail: "Not found" } }));
  try {
    const result = await run(chaosArgs(HARDENED), licensed(INVALID_KEY, mock.url), cache);
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /not valid|invalid/i);
    assert.match(text, /gatefit\.io\/#pricing/);
    assert.doesNotMatch(text, /PASS chaos/);
    assertNoKey(text, INVALID_KEY);
    assert.equal(mock.hits.length, 1);
    if (fs.existsSync(cache)) assertNoKey(fs.readFileSync(cache, "utf8"), INVALID_KEY);
  } finally {
    await mock.close();
  }
});

test("naive adapter fails chaos on the checkout-return page", async () => {
  const cache = cacheFile();
  const mock = await granted();
  try {
    const result = await run(chaosArgs(NAIVE), licensed(VALID_KEY, mock.url), cache);
    const text = output(result);
    assert.notEqual(result.status, 0, text);
    assert.match(text, /gatefit chaos: seed 1/);
    assert.match(text, /perturbation checkout_return/);
    assert.match(text, /checkout\.session\.completed/);
    assert.match(text, /repro/);
    assert.match(text, /access: expected/);
    assert.match(text, /"locked":/);
    assert.doesNotMatch(text, /http 200 (means|grants|proves) access/i);
    assert.doesNotMatch(text, /^gatefit: PASS chaos$/m);
    assertNoKey(text, VALID_KEY);
  } finally {
    await mock.close();
  }
});

test("hardened adapter passes chaos for every golden", async () => {
  const cache = cacheFile();
  const mock = await granted();
  try {
    const result = await run(chaosArgs(HARDENED), licensed(VALID_KEY, mock.url), cache);
    const text = output(result);
    assert.equal(result.status, 0, text);
    assert.match(result.stderr, /gatefit chaos: seed 1/);
    for (const id of goldenIds()) {
      assert.match(result.stderr, new RegExp(`^gatefit: PASS chaos ${id}$`, "m"), id);
    }
    assert.match(result.stderr, /^gatefit: PASS chaos$/m);
    assert.doesNotMatch(text, /FAIL chaos/);
    assert.doesNotMatch(text, /http 200 (means|grants|proves) access/i);
    assertNoKey(text, VALID_KEY);
    if (fs.existsSync(cache)) assertNoKey(fs.readFileSync(cache, "utf8"), VALID_KEY);
  } finally {
    await mock.close();
  }
});

test("two hardened chaos runs with the same seed are byte-identical", async () => {
  const cache = cacheFile();
  const mock = await granted();
  try {
    const env = licensed(VALID_KEY, mock.url);
    const first = await run(chaosArgs(HARDENED), env, cache);
    const second = await run(chaosArgs(HARDENED), env, cache);
    assert.equal(first.status, 0, output(first));
    assert.equal(second.status, 0, output(second));
    assert.equal(second.stdout, first.stdout);
    assert.equal(second.stderr, first.stderr);
    assert.match(first.stderr, /gatefit chaos: seed 1/);
  } finally {
    await mock.close();
  }
});

test("chaos --seed matches GATEFIT_CHAOS_SEED and overrides the default", async () => {
  const mock = await granted();
  try {
    const flagged = await run(
      chaosArgs(HARDENED, ["--seed", "abc"]),
      licensed(VALID_KEY, mock.url),
      cacheFile(),
    );
    const fromEnv = await run(
      chaosArgs(HARDENED),
      { ...licensed(VALID_KEY, mock.url), GATEFIT_CHAOS_SEED: "abc" },
      cacheFile(),
    );
    assert.equal(flagged.status, 0, output(flagged));
    assert.equal(fromEnv.status, 0, output(fromEnv));
    assert.equal(fromEnv.stdout, flagged.stdout);
    assert.equal(fromEnv.stderr, flagged.stderr);
    assert.match(flagged.stderr, /gatefit chaos: seed abc/);
    assert.doesNotMatch(flagged.stderr, /gatefit chaos: seed 1/);
  } finally {
    await mock.close();
  }
});

test("free packs still run with no key and do not enter chaos", async () => {
  const cache = cacheFile();
  const mock = await listen(() => {
    throw new Error("free pack contacted the license endpoint");
  });
  try {
    const result = await run(
      ["run", "--suite", "paid_grants_access", "--adapter", HARDENED],
      { GATEFIT_LICENSE_VALIDATE_URL: mock.url },
      cache,
    );
    const text = output(result);
    assert.equal(result.status, 0, text);
    assert.match(text, /PASS paid_grants_access/);
    assert.doesNotMatch(text, /PASS chaos/);
    assert.doesNotMatch(text, /gatefit chaos:/);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

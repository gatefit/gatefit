import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const bin = path.join(root, "bin/gatefit.js");
const BUY = "https://gatefit.io/#pricing";
const ORG_ID = "68556619-45ab-4a88-8ad8-08606c2b820e";
const BENEFIT_ID = "4e8e6528-a979-4060-b675-7686c752a4a2";
const VALIDATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const VALID_KEY = "GATEFIT-H16-VALID-KEY";
const INVALID_KEY = "GATEFIT-H16-INVALID-KEY";
const REVOKED_KEY = "GATEFIT-H16-REVOKED-KEY";
const TTL_MS = 24 * 60 * 60 * 1000;

type Hit = { method: string; url: string; body: unknown };

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

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

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  cache: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, GATEFIT_LICENSE_CACHE: cache };
  delete childEnv.GATEFIT_LIVE_CLOCK;
  if (!("GATEFIT_LICENSE_KEY" in env)) delete childEnv.GATEFIT_LICENSE_KEY;
  if (!("GATEFIT_LICENSE_VALIDATE_URL" in env)) delete childEnv.GATEFIT_LICENSE_VALIDATE_URL;
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

function proArgs(): string[] {
  return ["run", "--suite", "pro-stub", "--adapter", "src/adapters/hardened.ts"];
}

function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr}`;
}

function assertNoKey(text: string, key: string): void {
  assert.equal(text.includes(key), false, "raw license key leaked");
}

const freeSuites = [
  "paid_grants_access",
  "trial_no_card",
  "portal_downgrade_period_end_vs_immediate",
  "entitlements_active_summary",
];

test("free packs run with no key and do not call Polar", async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-")), "cache.json");
  const mock = await listen(() => {
    throw new Error("free pack contacted the license endpoint");
  });
  try {
    for (const suite of freeSuites) {
      const result = await run(
        ["run", "--suite", suite, "--adapter", "src/adapters/hardened.ts"],
        { GATEFIT_LICENSE_VALIDATE_URL: mock.url },
        cache,
      );
      assert.equal(result.status, 0, `${suite}\n${output(result)}`);
      assert.equal(mock.hits.length, 0, suite);
    }
    assert.equal(fs.existsSync(cache), false);
  } finally {
    await mock.close();
  }
});

test("free packs ignore a set key and still do not call Polar", async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-")), "cache.json");
  const mock = await listen(() => {
    throw new Error("free pack contacted the license endpoint");
  });
  try {
    for (const suite of freeSuites) {
      const result = await run(
        ["run", "--suite", suite, "--adapter", "src/adapters/hardened.ts"],
        { GATEFIT_LICENSE_KEY: VALID_KEY, GATEFIT_LICENSE_VALIDATE_URL: mock.url },
        cache,
      );
      assert.equal(result.status, 0, `${suite}\n${output(result)}`);
      assert.equal(mock.hits.length, 0, suite);
      assertNoKey(output(result), VALID_KEY);
    }
    assert.equal(fs.existsSync(cache), false);
  } finally {
    await mock.close();
  }
});

test("pro pack with no key exits non-zero and prints the buy link", async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-")), "cache.json");
  const mock = await listen(() => ({ status: 200, json: { status: "granted" } }));
  try {
    const result = await run(proArgs(), { GATEFIT_LICENSE_VALIDATE_URL: mock.url }, cache);
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /GATEFIT_LICENSE_KEY/);
    assert.match(text, new RegExp(BUY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(mock.hits.length, 0);
    assert.doesNotMatch(text, /PASS pro-stub/);
  } finally {
    await mock.close();
  }
});

test("pro pack with an invalid key exits non-zero and does not leak the key", async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-")), "cache.json");
  const mock = await listen(() => ({ status: 404, json: { error: "ResourceNotFound", detail: "Not found" } }));
  try {
    const result = await run(
      proArgs(),
      { GATEFIT_LICENSE_KEY: INVALID_KEY, GATEFIT_LICENSE_VALIDATE_URL: mock.url },
      cache,
    );
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /not valid|invalid/i);
    assert.match(text, /gatefit\.io\/#pricing/);
    assert.doesNotMatch(text, /revoked/i);
    assertNoKey(text, INVALID_KEY);
    assert.equal(mock.hits.length, 1);
    const body = mock.hits[0]?.body as { key?: string; organization_id?: string; benefit_id?: string };
    assert.equal(body.key, INVALID_KEY);
    assert.equal(body.organization_id, ORG_ID);
    assert.equal(body.benefit_id, BENEFIT_ID);
    assert.equal(mock.hits[0]?.method, "POST");
    if (fs.existsSync(cache)) assertNoKey(fs.readFileSync(cache, "utf8"), INVALID_KEY);
  } finally {
    await mock.close();
  }
});

test("pro pack with a revoked key exits non-zero even when a cache entry exists", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-"));
  const cache = path.join(dir, "cache.json");
  fs.writeFileSync(
    cache,
    JSON.stringify({
      v: 1,
      entries: { [keyHash(REVOKED_KEY)]: { granted: true, cachedAt: Date.now() - TTL_MS - 1000 } },
    }),
  );
  const mock = await listen(() => ({
    status: 200,
    json: { status: "revoked", key: REVOKED_KEY, display_key: "****-KEY" },
  }));
  try {
    const result = await run(
      proArgs(),
      { GATEFIT_LICENSE_KEY: REVOKED_KEY, GATEFIT_LICENSE_VALIDATE_URL: mock.url },
      cache,
    );
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /revoked/i);
    assert.match(text, /gatefit\.io\/#pricing/);
    assertNoKey(text, REVOKED_KEY);
    const stored = fs.existsSync(cache) ? fs.readFileSync(cache, "utf8") : "";
    assertNoKey(stored, REVOKED_KEY);
    assert.equal(stored.includes(keyHash(REVOKED_KEY)), false);
  } finally {
    await mock.close();
  }
});

test("a valid key is cached by hash and a repeat run does not call Polar", async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-")), "cache.json");
  const mock = await listen(() => ({
    status: 200,
    json: { status: "granted", key: VALID_KEY, organization_id: ORG_ID },
  }));
  try {
    const first = await run(
      proArgs(),
      { GATEFIT_LICENSE_KEY: VALID_KEY, GATEFIT_LICENSE_VALIDATE_URL: mock.url },
      cache,
    );
    assert.equal(first.status, 0, output(first));
    assert.match(output(first), /PASS pro-stub/);
    assertNoKey(output(first), VALID_KEY);
    assert.equal(mock.hits.length, 1);
    const stored = fs.readFileSync(cache, "utf8");
    assertNoKey(stored, VALID_KEY);
    assert.match(stored, new RegExp(keyHash(VALID_KEY)));
    const second = await run(
      proArgs(),
      { GATEFIT_LICENSE_KEY: VALID_KEY, GATEFIT_LICENSE_VALIDATE_URL: mock.url },
      cache,
    );
    assert.equal(second.status, 0, output(second));
    assert.match(output(second), /PASS pro-stub/);
    assertNoKey(output(second), VALID_KEY);
    assert.equal(mock.hits.length, 1);
  } finally {
    await mock.close();
  }
});

test("Polar unreachable with a cached valid result warns and runs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-"));
  const cache = path.join(dir, "cache.json");
  fs.writeFileSync(
    cache,
    JSON.stringify({
      v: 1,
      entries: { [keyHash(VALID_KEY)]: { granted: true, cachedAt: Date.now() - TTL_MS - 5000 } },
    }),
  );
  const closed = await listen(() => ({ status: 200, json: { status: "granted" } }));
  await closed.close();
  const result = await run(
    proArgs(),
    { GATEFIT_LICENSE_KEY: VALID_KEY, GATEFIT_LICENSE_VALIDATE_URL: closed.url },
    cache,
  );
  const text = output(result);
  assert.equal(result.status, 0, text);
  assert.match(text, /unreachable/i);
  assert.match(text, /cached/i);
  assert.match(text, /PASS pro-stub/);
  assertNoKey(text, VALID_KEY);
  assertNoKey(fs.readFileSync(cache, "utf8"), VALID_KEY);
});

test("Polar unreachable with no cache warns and still runs", async () => {
  const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-lic-")), "cache.json");
  const closed = await listen(() => ({ status: 200, json: { status: "granted" } }));
  await closed.close();
  const result = await run(
    proArgs(),
    { GATEFIT_LICENSE_KEY: VALID_KEY, GATEFIT_LICENSE_VALIDATE_URL: closed.url },
    cache,
  );
  const text = output(result);
  assert.equal(result.status, 0, text);
  assert.match(text, /unreachable/i);
  assert.match(text, /PASS pro-stub/);
  assertNoKey(text, VALID_KEY);
  if (fs.existsSync(cache)) assertNoKey(fs.readFileSync(cache, "utf8"), VALID_KEY);
});

test("docs name the env var, the public validate endpoint, and offline behavior", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const license = fs.readFileSync(path.join(root, "docs/license.md"), "utf8");
  for (const text of [readme, license]) {
    assert.match(text, /GATEFIT_LICENSE_KEY/);
    assert.match(text, /https:\/\/api\.polar\.sh\/v1\/customer-portal\/license-keys\/validate/);
    assert.match(text, new RegExp(ORG_ID));
    assert.match(text, /unreachable|offline/i);
    assert.match(text, /gatefit\.io\/#pricing/);
    assert.doesNotMatch(text, /\$19|optional updates/i);
    assert.doesNotMatch(text, /coming soon/i);
  }
  assert.match(readme, /S1–S6/);
  assert.match(license, /sha256|hash/i);
  assert.equal(VALIDATE_URL, "https://api.polar.sh/v1/customer-portal/license-keys/validate");
});

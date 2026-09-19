import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadAdapter } from "../../src/access-adapter.ts";
import { loadGolden, runGolden } from "../../src/fixture-driver.ts";

const root = path.join(import.meta.dirname, "../..");
const s1 = path.join(root, "tests/entitlements/goldens/paid_grants_access.yaml");
const s2 = path.join(root, "tests/entitlements/goldens/cancel_revokes_access.yaml");

test("naive adapter fails S1 paid_grants_access", async () => {
  const adapter = await loadAdapter(path.join(root, "src/adapters/naive.ts"));
  const result = await runGolden(adapter, loadGolden(s1));
  assert.equal(result.ok, false);
});

test("hardened adapter passes S1 paid_grants_access", async () => {
  const adapter = await loadAdapter(path.join(root, "src/adapters/hardened.ts"));
  const result = await runGolden(adapter, loadGolden(s1));
  assert.equal(result.ok, true);
});

test("hardened adapter passes S2 cancel_revokes_access", async () => {
  const adapter = await loadAdapter(path.join(root, "src/adapters/hardened.ts"));
  const result = await runGolden(adapter, loadGolden(s2));
  assert.equal(result.ok, true);
});

test("naive grants when Stripe HTTP 200", async () => {
  const adapter = await loadAdapter(path.join(root, "src/adapters/naive.ts"));
  await adapter.reset?.();
  await adapter.apply({
    id: "evt_http",
    type: "charge.succeeded",
    customerId: "cus_http",
    httpStatus: 200,
    plan: "pro",
  });
  const snap = await adapter.snapshot("cus_http");
  assert.equal(snap.locked, false);
  assert.equal(snap.plan, "pro");
});

test("hardened ignores Stripe HTTP 200 without invoice.paid", async () => {
  const adapter = await loadAdapter(path.join(root, "src/adapters/hardened.ts"));
  await adapter.reset?.();
  await adapter.apply({
    id: "evt_http",
    type: "charge.succeeded",
    customerId: "cus_http",
    httpStatus: 200,
    plan: "pro",
  });
  const snap = await adapter.snapshot("cus_http");
  assert.equal(snap.locked, true);
});

const goldensDir = path.join(root, "tests/entitlements/goldens");
const s3s6 = [
  "refund_revokes_access.yaml",
  "trial_to_paid_grants.yaml",
  "past_due_denies_until_recovery.yaml",
  "duplicate_webhook_idempotent.yaml",
];

const h6 = [
  "seat_qty_vs_db_cap.yaml",
  "cancel_at_period_end_keeps_access_until_end.yaml",
  "upgrade_plus_cape_race.yaml",
];

const h7 = [
  "dispute_revokes_or_flags.yaml",
  "unpaid_after_retries_revokes.yaml",
];

for (const name of [...s3s6, ...h6, ...h7]) {
  test(`hardened adapter passes ${name}`, async () => {
    const adapter = await loadAdapter(path.join(root, "src/adapters/hardened.ts"));
    const result = await runGolden(adapter, loadGolden(path.join(goldensDir, name)));
    assert.equal(result.ok, true);
  });

  test(`naive adapter fails ${name}`, async () => {
    const adapter = await loadAdapter(path.join(root, "src/adapters/naive.ts"));
    const result = await runGolden(adapter, loadGolden(path.join(goldensDir, name)));
    assert.equal(result.ok, false);
  });
}

test("loadAdapter returns isolated adapter instances", async () => {
  const naivePath = path.join(root, "src/adapters/naive.ts");
  const a = await loadAdapter(naivePath);
  const b = await loadAdapter(naivePath);
  await a.apply({
    id: "evt_iso",
    type: "charge.succeeded",
    customerId: "cus_iso",
    httpStatus: 200,
    plan: "pro",
  });
  const snap = await b.snapshot("cus_iso");
  assert.equal(snap.locked, true);
});

function withoutSqlitePath<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.GATEFIT_SQLITE_PATH;
  delete process.env.GATEFIT_SQLITE_PATH;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.GATEFIT_SQLITE_PATH;
    else process.env.GATEFIT_SQLITE_PATH = prev;
  });
}

test("sqlite adapter passes all S1–S6 goldens", async () => {
  await withoutSqlitePath(async () => {
    const adapter = await loadAdapter(path.join(root, "src/adapters/sqlite.ts"));
    for (const file of fs.readdirSync(goldensDir).filter((n) => n.endsWith(".yaml"))) {
      const result = await runGolden(adapter, loadGolden(path.join(goldensDir, file)));
      assert.equal(result.ok, true, file);
    }
  });
});

test("sqlite createAdapter instances are isolated", async () => {
  await withoutSqlitePath(async () => {
    const sqlitePath = path.join(root, "src/adapters/sqlite.ts");
    const a = await loadAdapter(sqlitePath);
    const b = await loadAdapter(sqlitePath);
    await a.apply({
      id: "evt_iso_sql",
      type: "invoice.paid",
      customerId: "cus_iso_sql",
      plan: "pro",
    });
    const snap = await b.snapshot("cus_iso_sql");
    assert.equal(snap.locked, true);
  });
});

test("sqlite duplicate event id is a no-op", async () => {
  await withoutSqlitePath(async () => {
    const adapter = await loadAdapter(path.join(root, "src/adapters/sqlite.ts"));
    const event = {
      id: "evt_dup_sql",
      type: "invoice.paid",
      customerId: "cus_dup_sql",
      plan: "pro" as const,
    };
    await adapter.apply(event);
    await adapter.apply(event);
    const snap = await adapter.snapshot("cus_dup_sql");
    assert.equal(snap.locked, false);
    assert.equal(snap.plan, "pro");
  });
});

test("sqlite ignores Stripe HTTP 200 without invoice.paid", async () => {
  await withoutSqlitePath(async () => {
    const adapter = await loadAdapter(path.join(root, "src/adapters/sqlite.ts"));
    await adapter.apply({
      id: "evt_http_sql",
      type: "charge.succeeded",
      customerId: "cus_http_sql",
      httpStatus: 200,
      plan: "pro",
    });
    const snap = await adapter.snapshot("cus_http_sql");
    assert.equal(snap.locked, true);
  });
});

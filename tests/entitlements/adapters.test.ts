import assert from "node:assert/strict";
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

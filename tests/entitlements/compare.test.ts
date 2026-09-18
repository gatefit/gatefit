import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNoLiveStripeSecret,
  compareAccess,
} from "../../src/access-adapter.ts";

test("compareAccess checks only declared expected fields", () => {
  const result = compareAccess(
    { locked: false, plan: "pro", seats: 3, features: ["chat"] },
    { locked: false, plan: "pro" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test("compareAccess fails when a declared field differs", () => {
  const result = compareAccess({ locked: true, plan: "pro" }, { locked: false, plan: "pro" });
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.includes("locked")));
});

test("locked true is deny even when a plan looks paid", () => {
  const result = compareAccess({ locked: true, plan: "pro" }, { locked: true });
  assert.equal(result.ok, true);
});

test("assertNoLiveStripeSecret refuses sk_live", () => {
  assert.throws(() => assertNoLiveStripeSecret("STRIPE_SECRET_KEY=sk_live_example"), /sk_live/);
  assert.throws(() => assertNoLiveStripeSecret("sk_live"), /sk_live/);
});

test("assertNoLiveStripeSecret allows empty and test prefixes", () => {
  assert.doesNotThrow(() => assertNoLiveStripeSecret(""));
  assert.doesNotThrow(() => assertNoLiveStripeSecret("sk_test_123"));
});

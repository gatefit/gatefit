import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STRIPE_API_VERSION,
  assertAdvanceWithinTwoIntervals,
  createStripeClockClient,
  requireLiveClockEnabled,
  requireTestModeSecret,
} from "../../src/stripe-clock.ts";

test("requireLiveClockEnabled demands GATEFIT_LIVE_CLOCK=1", () => {
  assert.throws(() => requireLiveClockEnabled({}), /GATEFIT_LIVE_CLOCK=1/);
  assert.throws(() => requireLiveClockEnabled({ GATEFIT_LIVE_CLOCK: "true" }), /GATEFIT_LIVE_CLOCK=1/);
  assert.doesNotThrow(() => requireLiveClockEnabled({ GATEFIT_LIVE_CLOCK: "1" }));
});

test("requireTestModeSecret refuses sk_live even when GATEFIT_LIVE_CLOCK=1", () => {
  assert.throws(
    () => requireTestModeSecret({ STRIPE_SECRET_KEY: "sk_live_abc", GATEFIT_LIVE_CLOCK: "1" }),
    /sk_live/,
  );
  assert.throws(() => requireTestModeSecret({ STRIPE_API_KEY: "sk_live_abc" }), /sk_live/);
});

test("requireTestModeSecret requires sk_test_ from STRIPE_SECRET_KEY or STRIPE_API_KEY", () => {
  assert.throws(() => requireTestModeSecret({}), /STRIPE_SECRET_KEY|STRIPE_API_KEY/);
  assert.throws(() => requireTestModeSecret({ STRIPE_SECRET_KEY: "rk_test_nope" }), /sk_test_/);
  assert.equal(requireTestModeSecret({ STRIPE_SECRET_KEY: "sk_test_123" }), "sk_test_123");
  assert.equal(requireTestModeSecret({ STRIPE_API_KEY: "sk_test_abc" }), "sk_test_abc");
});

test("assertAdvanceWithinTwoIntervals blocks >2 monthly intervals", () => {
  const from = 1_577_836_800;
  assert.doesNotThrow(() => assertAdvanceWithinTwoIntervals(from, from + 60 * 24 * 60 * 60));
  assert.throws(
    () => assertAdvanceWithinTwoIntervals(from, from + 90 * 24 * 60 * 60),
    /two billing intervals/,
  );
});

test("createStripeClockClient pins Stripe-Version and never sends sk_live", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        id: "clock_1",
        object: "test_helpers.test_clock",
        status: "ready",
        frozen_time: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = createStripeClockClient({
    secret: "sk_test_123",
    fetchImpl,
    baseUrl: "https://api.stripe.com",
  });
  await client.createClock({ frozenTime: 1, name: "gatefit" });
  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get("Stripe-Version"), STRIPE_API_VERSION);
  assert.equal(STRIPE_API_VERSION, "2025-10-29.clover");
  assert.equal(headers.get("Authorization"), "Bearer sk_test_123");
  assert.match(calls[0]?.url ?? "", /\/v1\/test_helpers\/test_clocks$/);
});

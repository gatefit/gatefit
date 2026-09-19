import assert from "node:assert/strict";
import { test } from "node:test";
import { compareAccess } from "../../src/access-adapter.ts";
import { applyBillingEvent, emptyStore } from "../../src/access-rules.ts";
import { advanceUntilReady, withTestClock } from "../../src/clock-driver.ts";
import { billingEventsFromStripe } from "../../src/live-scenarios.ts";
import {
  STRIPE_API_VERSION,
  assertAdvanceWithinTwoIntervals,
  createStripeClockClient,
  requireLiveClockEnabled,
  requireTestModeSecret,
  type StripeClockClient,
  type StripeCustomer,
  type StripeInvoice,
  type StripeSubscription,
  type TestClock,
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

function memoryStripe(): StripeClockClient & {
  deleted: string[];
  created: string[];
  explodingDelete?: boolean;
} {
  const clocks = new Map<string, TestClock>();
  let n = 0;
  const api: StripeClockClient & { deleted: string[]; created: string[]; explodingDelete?: boolean } = {
    deleted: [],
    created: [],
    async createClock(input) {
      n += 1;
      const clock: TestClock = { id: `clock_${n}`, status: "ready", frozen_time: input.frozenTime };
      clocks.set(clock.id, clock);
      api.created.push(clock.id);
      return { ...clock };
    },
    async retrieveClock(id) {
      const clock = clocks.get(id);
      if (!clock) throw new Error(`missing clock ${id}`);
      const snapshot = { ...clock };
      if (clock.status === "advancing") clock.status = "ready";
      return snapshot;
    },
    async advanceClock(id, frozenTime) {
      const clock = clocks.get(id);
      if (!clock) throw new Error(`missing clock ${id}`);
      clock.frozen_time = frozenTime;
      clock.status = "advancing";
      return { ...clock };
    },
    async deleteClock(id) {
      api.deleted.push(id);
      if (api.explodingDelete) return { id, deleted: false };
      clocks.delete(id);
      return { id, deleted: true };
    },
    async createCustomer() {
      return { id: "cus_1" } satisfies StripeCustomer;
    },
    async createSubscription() {
      return { id: "sub_1", status: "active", customer: "cus_1" } satisfies StripeSubscription;
    },
    async retrieveSubscription() {
      return { id: "sub_1", status: "active", customer: "cus_1" };
    },
    async cancelSubscription() {
      return { id: "sub_1", status: "canceled", customer: "cus_1" };
    },
    async listInvoices() {
      return [{ id: "in_1", status: "paid", paid: true, customer: "cus_1" }] satisfies StripeInvoice[];
    },
  };
  return api;
}

test("withTestClock deletes the clock after success", async () => {
  const stripe = memoryStripe();
  const seen = await withTestClock(stripe, { frozenTime: 10, name: "ok" }, async (clock) => clock.id);
  assert.equal(seen, "clock_1");
  assert.deepEqual(stripe.deleted, ["clock_1"]);
});

test("withTestClock deletes the clock after failure (no leak)", async () => {
  const stripe = memoryStripe();
  await assert.rejects(
    () =>
      withTestClock(stripe, { frozenTime: 10, name: "boom" }, async () => {
        throw new Error("scenario boom");
      }),
    /scenario boom/,
  );
  assert.deepEqual(stripe.deleted, ["clock_1"]);
});

test("withTestClock fails closed when delete does not confirm", async () => {
  const stripe = memoryStripe();
  stripe.explodingDelete = true;
  await assert.rejects(
    () => withTestClock(stripe, { frozenTime: 10, name: "leak" }, async () => "ok"),
    /clock leak/,
  );
});

test("advanceUntilReady polls until status is ready and caps two intervals", async () => {
  const stripe = memoryStripe();
  const clock = await stripe.createClock({ frozenTime: 100 });
  const sleeps: number[] = [];
  const ready = await advanceUntilReady(stripe, clock.id, 100 + 14 * 24 * 60 * 60, {
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    timeoutMs: 5_000,
    intervalMs: 1,
  });
  assert.equal(ready.status, "ready");
  assert.ok(sleeps.length >= 1);
  await assert.rejects(
    () => advanceUntilReady(stripe, clock.id, clock.frozen_time + 90 * 24 * 60 * 60),
    /two billing intervals/,
  );
});

test("billingEventsFromStripe maps objects not HTTP 200", () => {
  const events = billingEventsFromStripe({
    customerId: "cus_live",
    plan: "pro",
    subscription: { id: "sub_1", status: "canceled", customer: "cus_live" },
    invoices: [{ id: "in_1", status: "paid", paid: true, customer: "cus_live" }],
    stripeHttpStatus: 200,
  });
  assert.equal(
    events.some((e) => e.stripeHttpStatus === 200 || e.httpStatus === 200),
    false,
  );
  const store = emptyStore();
  for (const event of events) applyBillingEvent(store, event);
  const snap = store.rows.get("cus_live") ?? { locked: true };
  assert.equal(compareAccess(snap, { locked: true }).ok, true);
});

test("trialing maps to locked access even if Stripe returned 200", () => {
  const events = billingEventsFromStripe({
    customerId: "cus_t",
    plan: "pro",
    subscription: { id: "sub_t", status: "trialing", customer: "cus_t" },
    invoices: [],
    stripeHttpStatus: 200,
  });
  const store = emptyStore();
  for (const event of events) applyBillingEvent(store, event);
  assert.equal(store.rows.get("cus_t")?.locked, true);
});

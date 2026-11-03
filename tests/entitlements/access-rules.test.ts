import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { AccessAdapter, AccessSnapshot, BillingEvent } from "../../src/access-adapter.ts";
import { applyBillingEvent, emptyStore, nextSnapshot } from "../../src/access-rules.ts";

const paid = {
  id: "evt_paid",
  type: "invoice.paid",
  customerId: "cus",
  plan: "pro",
};

test("invoice.paid unlocks", () => {
  const store = emptyStore();
  applyBillingEvent(store, paid);
  assert.deepEqual(store.rows.get("cus"), { locked: false, plan: "pro" });
});

test("charge.refunded locks after paid", () => {
  const store = emptyStore();
  applyBillingEvent(store, paid);
  applyBillingEvent(store, {
    id: "evt_refund",
    type: "charge.refunded",
    customerId: "cus",
    refunded: true,
  });
  assert.equal(store.rows.get("cus")?.locked, true);
});

test("trialing stays locked until invoice.paid", () => {
  const store = emptyStore();
  applyBillingEvent(store, {
    id: "evt_trial",
    type: "customer.subscription.updated",
    customerId: "cus",
    status: "trialing",
    plan: "pro",
  });
  assert.equal(store.rows.get("cus")?.locked, true);
  applyBillingEvent(store, { ...paid, id: "evt_convert" });
  assert.equal(store.rows.get("cus")?.locked, false);
});

test("past_due locks until a new invoice.paid", () => {
  const store = emptyStore();
  applyBillingEvent(store, paid);
  applyBillingEvent(store, {
    id: "evt_fail",
    type: "invoice.payment_failed",
    customerId: "cus",
    status: "past_due",
  });
  assert.equal(store.rows.get("cus")?.locked, true);
  applyBillingEvent(store, { ...paid, id: "evt_recover" });
  assert.equal(store.rows.get("cus")?.locked, false);
});

test("duplicate event id is a no-op after cancel", () => {
  const store = emptyStore();
  applyBillingEvent(store, paid);
  applyBillingEvent(store, {
    id: "evt_cancel",
    type: "customer.subscription.deleted",
    customerId: "cus",
    canceled: true,
  });
  applyBillingEvent(store, paid);
  assert.equal(store.rows.get("cus")?.locked, true);
});

test("HTTP 200 does not grant", () => {
  const store = emptyStore();
  applyBillingEvent(store, {
    id: "evt_http",
    type: "charge.succeeded",
    customerId: "cus",
    httpStatus: 200,
    plan: "pro",
  });
  assert.equal(store.rows.get("cus")?.locked, true);
});

const NOW_BEFORE = 1_577_836_800;
const PERIOD_END = 1_577_923_200;

const paidSeats = {
  id: "evt_paid_seats",
  type: "invoice.paid",
  customerId: "cus",
  plan: "pro",
  seats: 10,
  features: ["team"],
};

test("quantity update sets seats to billed qty, not a sum or stale cap", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidSeats);
  applyBillingEvent(store, {
    id: "evt_qty_3",
    type: "customer.subscription.updated",
    customerId: "cus",
    plan: "pro",
    seats: 3,
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, false);
  assert.equal(row?.seats, 3);
  assert.deepEqual(row?.features, ["team"]);
});

test("cancel_at_period_end keeps access while fixture now is before period_end", () => {
  const store = emptyStore();
  applyBillingEvent(store, { ...paidSeats, seats: 1 });
  applyBillingEvent(store, {
    id: "evt_cape",
    type: "customer.subscription.updated",
    customerId: "cus",
    cancel_at_period_end: true,
    period_end: PERIOD_END,
    now: NOW_BEFORE,
    plan: "pro",
    seats: 1,
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, false);
  assert.equal(row?.plan, "pro");
});

test("cancel_at_period_end locks when fixture now reaches period_end", () => {
  const store = emptyStore();
  applyBillingEvent(store, { ...paidSeats, seats: 1 });
  applyBillingEvent(store, {
    id: "evt_cape",
    type: "customer.subscription.updated",
    customerId: "cus",
    cancel_at_period_end: true,
    period_end: PERIOD_END,
    now: NOW_BEFORE,
  });
  applyBillingEvent(store, {
    id: "evt_cape_end",
    type: "customer.subscription.updated",
    customerId: "cus",
    cancel_at_period_end: true,
    period_end: PERIOD_END,
    now: PERIOD_END,
  });
  assert.equal(store.rows.get("cus")?.locked, true);
});

test("upgrade after CAPE sets plan/seats and does not early-revoke or double-grant", () => {
  const store = emptyStore();
  applyBillingEvent(store, {
    id: "evt_starter",
    type: "invoice.paid",
    customerId: "cus",
    plan: "starter",
    seats: 1,
  });
  applyBillingEvent(store, {
    id: "evt_cape",
    type: "customer.subscription.updated",
    customerId: "cus",
    cancel_at_period_end: true,
    period_end: PERIOD_END,
    now: NOW_BEFORE,
  });
  applyBillingEvent(store, {
    id: "evt_upgrade",
    type: "invoice.paid",
    customerId: "cus",
    plan: "pro",
    seats: 5,
    paid: true,
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, false);
  assert.equal(row?.plan, "pro");
  assert.equal(row?.seats, 5);
});

test("HTTP 200 still does not grant seats or unlock", () => {
  const store = emptyStore();
  applyBillingEvent(store, {
    id: "evt_http",
    type: "charge.succeeded",
    customerId: "cus",
    httpStatus: 200,
    plan: "pro",
    seats: 9,
  });
  assert.deepEqual(store.rows.get("cus"), { locked: true });
});

test("nextSnapshot is a pure function of current + event (no Date.now)", () => {
  for (const file of ["access-rules.ts", "polar-rules.ts", "paddle-rules.ts"]) {
    const src = fs.readFileSync(path.join(import.meta.dirname, "../../src", file), "utf8");
    assert.doesNotMatch(src, /Date\.now/, file);
  }
  const before = nextSnapshot(
    { locked: false, plan: "pro", seats: 1 },
    {
      id: "evt",
      type: "customer.subscription.updated",
      customerId: "cus",
      cancel_at_period_end: true,
      period_end: PERIOD_END,
      now: NOW_BEFORE,
    },
  );
  assert.equal(before.locked, false);
});

const paidFeatured = {
  id: "evt_paid_feat",
  type: "invoice.paid",
  customerId: "cus",
  plan: "pro",
  seats: 1,
  features: ["team"],
};

test("charge.dispute.created locks and clears features (assumed revoke+flag policy)", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_dispute",
    type: "charge.dispute.created",
    customerId: "cus",
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, true);
  assert.equal(row?.plan, "pro");
  assert.equal(row?.seats, 1);
  assert.deepEqual(row?.features, []);
});

test("radar.early_fraud_warning.created uses the same dispute policy", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_radar",
    type: "radar.early_fraud_warning.created",
    customerId: "cus",
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, true);
  assert.deepEqual(row?.features, []);
});

test("HTTP 200 on a dispute does not keep access", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_dispute_http",
    type: "charge.dispute.created",
    customerId: "cus",
    httpStatus: 200,
    stripeHttpStatus: 200,
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, true);
  assert.deepEqual(row?.features, []);
});

test("charge.refunded still locks without clearing features", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_refund_keep_feat",
    type: "charge.refunded",
    customerId: "cus",
    refunded: true,
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, true);
  assert.deepEqual(row?.features, ["team"]);
});

test("status unpaid locks even when the event also carries plan/seats", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_unpaid",
    type: "customer.subscription.updated",
    customerId: "cus",
    status: "unpaid",
    plan: "pro",
    seats: 1,
    features: ["team"],
  });
  const row = store.rows.get("cus");
  assert.equal(row?.locked, true);
  assert.equal(row?.plan, "pro");
  assert.equal(row?.seats, 1);
});

test("past_due then unpaid then cancel stays locked (dunning exhaust)", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_fail",
    type: "invoice.payment_failed",
    customerId: "cus",
    status: "past_due",
  });
  applyBillingEvent(store, {
    id: "evt_unpaid_ex",
    type: "customer.subscription.updated",
    customerId: "cus",
    status: "unpaid",
    plan: "pro",
  });
  applyBillingEvent(store, {
    id: "evt_unpaid_cancel",
    type: "customer.subscription.deleted",
    customerId: "cus",
    canceled: true,
  });
  assert.equal(store.rows.get("cus")?.locked, true);
});

test("invoice.marked_uncollectible locks", () => {
  const store = emptyStore();
  applyBillingEvent(store, paidFeatured);
  applyBillingEvent(store, {
    id: "evt_uncollectible",
    type: "invoice.marked_uncollectible",
    customerId: "cus",
  });
  assert.equal(store.rows.get("cus")?.locked, true);
});

// Polar refund scoping. Stripe also sends refund.created and refund.updated, so
// those shared names reach the Polar rules only with provider: "polar".
const REFUND_PAID: BillingEvent = { id: "evt_r_paid", type: "invoice.paid", customerId: "cus_r", plan: "pro" };

const REFUND_CASES: { name: string; events: BillingEvent[]; expect: AccessSnapshot }[] = [
  {
    name: "stripe_refund_updated_succeeded_is_not_polar_refund",
    events: [REFUND_PAID, { id: "evt_r_upd", type: "refund.updated", customerId: "cus_r", status: "succeeded" }],
    expect: { locked: false, plan: "pro" },
  },
  {
    name: "stripe_refund_created_with_refunded_flag_locks",
    events: [
      REFUND_PAID,
      { id: "evt_r_new", type: "refund.created", customerId: "cus_r", status: "pending", refunded: true },
    ],
    expect: { locked: true, plan: "pro" },
  },
  {
    name: "polar_refund_requires_provider_polar",
    events: [
      { id: "wh_r_paid", type: "order.paid", customerId: "cus_r", status: "paid", plan: "pro" },
      { id: "wh_r_pending", type: "refund.created", customerId: "cus_r", status: "pending", provider: "polar" },
      { id: "wh_r_done", type: "refund.updated", customerId: "cus_r", status: "succeeded", provider: "polar", httpStatus: 200 },
    ],
    expect: { locked: true, plan: "pro" },
  },
];

function stripeOnly(events: BillingEvent[]): AccessSnapshot {
  // Same fold with the Stripe rules alone: strip the type so Polar dispatch cannot fire.
  return events.reduce<AccessSnapshot>(
    (row, event) => nextSnapshot(row, { ...event, type: event.type.replace(/^refund\./, "stripe_refund.") }),
    { locked: true },
  );
}

for (const { name, events, expect } of REFUND_CASES) {
  test(name, () => {
    const store = emptyStore();
    for (const event of events) applyBillingEvent(store, event);
    assert.deepEqual(store.rows.get("cus_r"), expect);
    if (!events.some((event) => event.provider === "polar")) {
      assert.deepEqual(store.rows.get("cus_r"), stripeOnly(events));
    }
  });

  test(`${name} (sqlite adapter)`, async (t) => {
    const require = createRequire(import.meta.url);
    try {
      const Database = require("better-sqlite3") as new (file: string) => { close(): void };
      new Database(":memory:").close();
    } catch {
      t.skip("better-sqlite3 native module is not installed");
      return;
    }
    const { createAdapter } = (await import("../../src/adapters/sqlite.ts")) as {
      createAdapter: () => AccessAdapter;
    };
    const adapter = createAdapter();
    for (const event of events) await adapter.apply(event);
    assert.deepEqual(await adapter.snapshot("cus_r"), expect);
  });
}

// Stripe legacy Orders scoping. Stripe also sends order.created and order.updated, so
// those shared names reach the Polar rules only with provider: "polar".
// order.paid and order.refunded are Polar-only names and need no tag.
const ORDER_CASES: { name: string; events: BillingEvent[]; expect: AccessSnapshot }[] = [
  {
    name: "stripe_legacy_order_updated_untagged_stays_on_stripe_rules",
    events: [{ id: "evt_o_upd", type: "order.updated", customerId: "cus_o", status: "paid", plan: "pro" }],
    expect: { locked: true },
  },
  {
    name: "stripe_legacy_order_updated_refunded_untagged_does_not_revoke",
    events: [
      { id: "evt_o_paid", type: "invoice.paid", customerId: "cus_o", plan: "pro" },
      { id: "evt_o_ret", type: "order.updated", customerId: "cus_o", status: "refunded" },
    ],
    expect: { locked: false, plan: "pro" },
  },
  {
    name: "stripe_legacy_order_created_untagged_is_noop",
    events: [{ id: "evt_o_new", type: "order.created", customerId: "cus_o", status: "created", plan: "pro" }],
    expect: { locked: true },
  },
  {
    name: "polar_order_updated_paid_requires_provider_polar",
    events: [
      { id: "wh_o_upd", type: "order.updated", customerId: "cus_o", status: "paid", plan: "pro", provider: "polar" },
    ],
    expect: { locked: false, plan: "pro" },
  },
  {
    name: "polar_order_updated_refunded_requires_provider_polar",
    events: [
      { id: "wh_o_paid", type: "order.paid", customerId: "cus_o", status: "paid", plan: "pro" },
      { id: "wh_o_ref", type: "order.updated", customerId: "cus_o", status: "refunded", provider: "polar" },
    ],
    expect: { locked: true, plan: "pro" },
  },
  {
    name: "polar_order_paid_untagged_still_grants",
    events: [{ id: "wh_o_paid2", type: "order.paid", customerId: "cus_o", status: "paid", plan: "pro" }],
    expect: { locked: false, plan: "pro" },
  },
];

for (const { name, events, expect } of ORDER_CASES) {
  test(name, () => {
    const store = emptyStore();
    for (const event of events) applyBillingEvent(store, event);
    assert.deepEqual(store.rows.get("cus_o") ?? { locked: true }, expect);
  });

  test(`${name} (sqlite adapter)`, async (t) => {
    const require = createRequire(import.meta.url);
    try {
      const Database = require("better-sqlite3") as new (file: string) => { close(): void };
      new Database(":memory:").close();
    } catch {
      t.skip("better-sqlite3 native module is not installed");
      return;
    }
    const { createAdapter } = (await import("../../src/adapters/sqlite.ts")) as {
      createAdapter: () => AccessAdapter;
    };
    const adapter = createAdapter();
    for (const event of events) await adapter.apply(event);
    assert.deepEqual(await adapter.snapshot("cus_o"), expect);
  });
}

// Paddle scoping. Polar also sends subscription.created, .updated and .canceled, so
// those shared names reach the Paddle rules only with provider: "paddle".
const PADDLE_CASES: { name: string; events: BillingEvent[]; expect: AccessSnapshot }[] = [
  {
    name: "polar_subscription_updated_untagged_still_polar",
    events: [
      { id: "wh_s_active", type: "subscription.active", customerId: "cus_pd", status: "active", plan: "pro" },
      { id: "wh_s_paused", type: "subscription.updated", customerId: "cus_pd", status: "paused" },
    ],
    expect: { locked: false, plan: "pro" },
  },
  {
    name: "paddle_subscription_paused_requires_provider_paddle",
    events: [
      { id: "evt_pd_done", type: "transaction.completed", customerId: "cus_pd", status: "completed", plan: "pro" },
      {
        id: "evt_pd_paused",
        type: "subscription.updated",
        customerId: "cus_pd",
        status: "paused",
        provider: "paddle",
        httpStatus: 200,
      },
    ],
    expect: { locked: true, plan: "pro" },
  },
  {
    name: "paddle_subscription_created_active_requires_provider_paddle",
    events: [
      {
        id: "evt_pd_created",
        type: "subscription.created",
        customerId: "cus_pd",
        status: "active",
        provider: "paddle",
        plan: "pro",
        seats: 3,
      },
    ],
    expect: { locked: false, plan: "pro", seats: 3 },
  },
  {
    name: "paddle_chargeback_locks_and_clears_features",
    events: [
      { id: "evt_pd_done", type: "transaction.completed", customerId: "cus_pd", status: "completed", plan: "pro" },
      { id: "evt_pd_summary", type: "entitlements.active_entitlement_summary.updated", customerId: "cus_pd", features: ["export"] },
      {
        id: "evt_pd_cb",
        type: "adjustment.created",
        customerId: "cus_pd",
        action: "chargeback",
        status: "approved",
        httpStatus: 200,
      },
      { id: "evt_pd_cb_rev", type: "adjustment.created", customerId: "cus_pd", action: "chargeback_reverse", status: "approved" },
    ],
    expect: { locked: true, plan: "pro", features: [] },
  },
  {
    name: "stripe_invoice_paid_unaffected_by_paddle_rules",
    events: [
      { id: "evt_pd_inv", type: "invoice.paid", customerId: "cus_pd", plan: "pro" },
      { id: "evt_pd_txn_failed", type: "transaction.payment_failed", customerId: "cus_pd", status: "past_due" },
    ],
    expect: { locked: false, plan: "pro" },
  },
];

for (const { name, events, expect } of PADDLE_CASES) {
  test(name, () => {
    const store = emptyStore();
    for (const event of events) applyBillingEvent(store, event);
    assert.deepEqual(store.rows.get("cus_pd"), expect);
  });

  test(`${name} (sqlite adapter)`, async (t) => {
    const require = createRequire(import.meta.url);
    try {
      const Database = require("better-sqlite3") as new (file: string) => { close(): void };
      new Database(":memory:").close();
    } catch {
      t.skip("better-sqlite3 native module is not installed");
      return;
    }
    const { createAdapter } = (await import("../../src/adapters/sqlite.ts")) as {
      createAdapter: () => AccessAdapter;
    };
    const adapter = createAdapter();
    for (const event of events) await adapter.apply(event);
    assert.deepEqual(await adapter.snapshot("cus_pd"), expect);
  });
}

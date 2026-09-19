import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
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
  const src = fs.readFileSync(path.join(import.meta.dirname, "../../src/access-rules.ts"), "utf8");
  assert.doesNotMatch(src, /Date\.now/);
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

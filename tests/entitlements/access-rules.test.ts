import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBillingEvent, emptyStore } from "../../src/access-rules.ts";

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

import type { AccessSnapshot, BillingEvent } from "./access-adapter.ts";

/**
 * Paddle Billing v1 webhook event names (PADDLE_SCHEMA in src/paddle-pack.ts).
 * Dispatch is on these exact names only. Stripe sends none of them and Polar sends
 * none of them. Names Polar also sends live in PADDLE_SHARED_TYPES instead.
 */
export const PADDLE_EVENT_TYPES = new Set([
  "transaction.created",
  "transaction.ready",
  "transaction.billed",
  "transaction.paid",
  "transaction.updated",
  "transaction.completed",
  "transaction.payment_failed",
  "transaction.past_due",
  "transaction.canceled",
  "subscription.activated",
  "subscription.resumed",
  "subscription.trialing",
  "subscription.past_due",
  "subscription.paused",
  "adjustment.created",
  "adjustment.updated",
]);

/** Paddle names Polar sends too. These reach the Paddle rules only with provider: "paddle". */
export const PADDLE_SHARED_TYPES = new Set(["subscription.created", "subscription.updated", "subscription.canceled"]);

export function isPaddleEvent(event: BillingEvent): boolean {
  if (PADDLE_EVENT_TYPES.has(event.type)) return true;
  return PADDLE_SHARED_TYPES.has(event.type) && event.provider === "paddle";
}

function withPlan(base: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  const next: AccessSnapshot = { ...base };
  if (event.plan !== undefined) next.plan = event.plan;
  if (event.seats !== undefined) next.seats = event.seats;
  return next;
}

function grant(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  return withPlan({ ...current, locked: false }, event);
}

function lock(current: AccessSnapshot): AccessSnapshot {
  return { ...current, locked: true };
}

/** Paddle scheduled_change.action=cancel maps to cancel_at_period_end. */
function periodEnded(event: BillingEvent): boolean {
  return (
    event.cancel_at_period_end === true &&
    typeof event.now === "number" &&
    typeof event.period_end === "number" &&
    event.now >= event.period_end
  );
}

function subscriptionStatus(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  if (periodEnded(event)) return lock(current);
  if (event.status === "active") return grant(current, event);
  if (
    event.status === "trialing" ||
    event.status === "past_due" ||
    event.status === "paused" ||
    event.status === "canceled"
  ) {
    return withPlan(lock(current), event);
  }
  return current;
}

function adjustment(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  if (event.status !== "approved") return current;
  if (event.action === "chargeback") return { ...current, locked: true, features: [] };
  if (event.action === "refund" && event.adjustment_type === "full") return lock(current);
  // Partial refunds, credits and chargeback_reverse leave the row unchanged (no auto-heal).
  return current;
}

/**
 * Pure Paddle fold step. HTTP 200 is never read. Only a completed transaction
 * grants; created, ready, billed and paid transactions leave the row unchanged.
 * transaction.payment_failed is unchanged too: the subscription event decides.
 * Trials stay locked, like the Stripe S2/S7 goldens.
 */
export function nextPaddleSnapshot(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  switch (event.type) {
    case "transaction.completed":
      return grant(current, event);
    case "transaction.updated":
      return event.status === "completed" ? grant(current, event) : current;
    case "subscription.created":
    case "subscription.updated":
      return subscriptionStatus(current, event);
    case "subscription.activated":
    case "subscription.resumed":
      if (periodEnded(event)) return lock(current);
      return grant(current, event);
    case "subscription.trialing":
    case "subscription.past_due":
    case "subscription.paused":
      return withPlan(lock(current), event);
    case "subscription.canceled":
      // Paddle sends canceled at the effective date; a scheduled cancel is not yet one.
      if (periodEnded(event)) return lock(current);
      if (event.cancel_at_period_end === true) return current;
      return lock(current);
    case "adjustment.created":
    case "adjustment.updated":
      return adjustment(current, event);
    default:
      return current;
  }
}

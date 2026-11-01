import type { AccessSnapshot, BillingEvent } from "./access-adapter.ts";

/**
 * Polar public v1 webhook event names (POLAR_SCHEMA in src/polar-pack.ts).
 * Dispatch is on these exact names only, so Stripe goldens never reach these rules.
 */
export const POLAR_EVENT_TYPES = new Set([
  "checkout.created",
  "checkout.updated",
  "order.created",
  "order.paid",
  "order.updated",
  "order.refunded",
  "refund.created",
  "refund.updated",
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "benefit_grant.created",
  "benefit_grant.updated",
  "benefit_grant.revoked",
]);

export function isPolarEvent(event: BillingEvent): boolean {
  return POLAR_EVENT_TYPES.has(event.type);
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

function periodEnded(event: BillingEvent): boolean {
  return (
    event.cancel_at_period_end === true &&
    typeof event.now === "number" &&
    typeof event.period_end === "number" &&
    event.now >= event.period_end
  );
}

function addBenefit(current: AccessSnapshot, benefit: string | undefined): AccessSnapshot {
  if (benefit === undefined) return current;
  const features = current.features ?? [];
  if (features.includes(benefit)) return { ...current, features };
  return { ...current, features: [...features, benefit] };
}

function removeBenefit(current: AccessSnapshot, benefit: string | undefined): AccessSnapshot {
  if (benefit === undefined) return current;
  return { ...current, features: (current.features ?? []).filter((key) => key !== benefit) };
}

function subscriptionStatus(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  if (periodEnded(event)) return lock(current);
  if (event.status === "active") return grant(current, event);
  if (
    event.status === "trialing" ||
    event.status === "incomplete" ||
    event.status === "incomplete_expired" ||
    event.status === "past_due" ||
    event.status === "unpaid" ||
    event.status === "canceled"
  ) {
    return withPlan(lock(current), event);
  }
  return current;
}

/**
 * Pure Polar fold step. HTTP 200 is never read. Checkout events and pending
 * orders or refunds leave the row unchanged. A partially refunded order keeps
 * access (policy). Trials stay locked, like the Stripe S2/S7 goldens.
 */
export function nextPolarSnapshot(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  switch (event.type) {
    case "order.paid":
      return grant(current, event);
    case "order.updated":
      if (event.status === "paid") return grant(current, event);
      if (event.status === "refunded") return lock(current);
      return current;
    case "order.refunded":
      return lock(current);
    case "refund.created":
    case "refund.updated":
      return event.status === "succeeded" ? lock(current) : current;
    case "subscription.created":
    case "subscription.updated":
      return subscriptionStatus(current, event);
    case "subscription.active":
      return grant(current, event);
    case "subscription.canceled":
      if (periodEnded(event)) return lock(current);
      if (event.cancel_at_period_end === true) return current;
      return event.status === "canceled" ? lock(current) : current;
    case "subscription.uncanceled":
      return current;
    case "subscription.revoked":
      return lock(current);
    case "benefit_grant.created":
    case "benefit_grant.updated":
      return addBenefit(current, event.benefit);
    case "benefit_grant.revoked":
      return removeBenefit(current, event.benefit);
    default:
      return current;
  }
}

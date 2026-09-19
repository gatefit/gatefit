import type { AccessSnapshot, BillingEvent } from "./access-adapter.ts";

export type AccessStore = {
  rows: Map<string, AccessSnapshot>;
  seen: Set<string>;
};

export function emptyStore(): AccessStore {
  return { rows: new Map(), seen: new Set() };
}

export function isPaid(event: BillingEvent): boolean {
  return event.type === "invoice.paid" || event.paid === true;
}

export function isImmediateCancel(event: BillingEvent): boolean {
  return (
    event.canceled === true ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.canceled"
  );
}

export function isCanceled(event: BillingEvent): boolean {
  return isImmediateCancel(event);
}

export function isCapePeriodEnded(event: BillingEvent): boolean {
  return (
    event.cancel_at_period_end === true &&
    typeof event.now === "number" &&
    typeof event.period_end === "number" &&
    event.now >= event.period_end
  );
}

export function isRefund(event: BillingEvent): boolean {
  return (
    event.refunded === true ||
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created"
  );
}

export function isPastDue(event: BillingEvent): boolean {
  return event.status === "past_due" || event.type === "invoice.payment_failed";
}

export function isTrialing(event: BillingEvent): boolean {
  return event.status === "trialing";
}

function withEntitlements(base: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  const next: AccessSnapshot = { ...base };
  if (event.plan !== undefined) next.plan = event.plan;
  if (event.seats !== undefined) next.seats = event.seats;
  if (event.features !== undefined) next.features = event.features;
  return next;
}

export function nextSnapshot(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  if (isRefund(event) || isImmediateCancel(event) || isPastDue(event) || isTrialing(event)) {
    return { ...current, locked: true };
  }
  if (isCapePeriodEnded(event)) {
    return { ...current, locked: true };
  }
  if (isPaid(event)) {
    return withEntitlements({ ...current, locked: false }, event);
  }
  if (
    event.type === "customer.subscription.updated" &&
    (event.cancel_at_period_end === true ||
      event.seats !== undefined ||
      event.plan !== undefined ||
      event.features !== undefined)
  ) {
    return withEntitlements(current, event);
  }
  return current;
}

export function applyBillingEvent(store: AccessStore, event: BillingEvent): void {
  if (store.seen.has(event.id)) return;
  store.seen.add(event.id);
  const current = store.rows.get(event.customerId) ?? { locked: true };
  store.rows.set(event.customerId, nextSnapshot(current, event));
}

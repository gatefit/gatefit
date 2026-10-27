import type { AccessSnapshot, BillingEvent } from "./access-adapter.ts";

export type AccessStore = {
  rows: Map<string, AccessSnapshot>;
  seen: Set<string>;
  events: BillingEvent[];
  arrival: number;
};

export function emptyStore(): AccessStore {
  return { rows: new Map(), seen: new Set(), events: [], arrival: 0 };
}

export function isPaid(event: BillingEvent): boolean {
  return event.type === "invoice.paid" || event.paid === true;
}

export function isImmediateCancel(event: BillingEvent): boolean {
  return (
    event.canceled === true ||
    event.status === "canceled" ||
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

export function isDispute(event: BillingEvent): boolean {
  return (
    event.type === "charge.dispute.created" ||
    event.type === "radar.early_fraud_warning.created"
  );
}

export function isRefund(event: BillingEvent): boolean {
  return event.refunded === true || event.type === "charge.refunded";
}

export function isUnpaidExhaust(event: BillingEvent): boolean {
  return event.status === "unpaid" || event.type === "invoice.marked_uncollectible";
}

export function isPastDue(event: BillingEvent): boolean {
  return event.status === "past_due" || event.type === "invoice.payment_failed";
}

export function isTrialing(event: BillingEvent): boolean {
  return event.status === "trialing";
}

export function isPaused(event: BillingEvent): boolean {
  return event.status === "paused" || event.type === "customer.subscription.paused";
}

export function isTrialWillEnd(event: BillingEvent): boolean {
  return event.type === "customer.subscription.trial_will_end";
}

export function isActiveEntitlementSummary(event: BillingEvent): boolean {
  return event.type === "entitlements.active_entitlement_summary.updated";
}

export function isScheduledDowngrade(event: BillingEvent): boolean {
  return event.downgrade_at_period_end === true && event.pending_plan !== undefined;
}

export function isScheduledDowngradeDue(event: BillingEvent): boolean {
  return (
    isScheduledDowngrade(event) &&
    typeof event.now === "number" &&
    typeof event.period_end === "number" &&
    event.now >= event.period_end
  );
}

function withEntitlements(base: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  const next: AccessSnapshot = { ...base };
  if (event.plan !== undefined) next.plan = event.plan;
  if (event.seats !== undefined) next.seats = event.seats;
  if (event.features !== undefined) next.features = event.features;
  return next;
}

export function nextSnapshot(current: AccessSnapshot, event: BillingEvent): AccessSnapshot {
  if (isDispute(event)) {
    return { ...current, locked: true, features: [] };
  }
  // A trial-ending warning neither grants nor revokes, even with HTTP 200
  // or status trialing on the same event.
  if (isTrialWillEnd(event)) {
    return withEntitlements(current, event);
  }
  // Active entitlement summaries replace features. They are not a payment.
  if (isActiveEntitlementSummary(event)) {
    return { ...current, features: event.features ?? [] };
  }
  if (isTrialing(event) || isPaused(event)) {
    return withEntitlements({ ...current, locked: true }, event);
  }
  if (
    isRefund(event) ||
    isImmediateCancel(event) ||
    isPastDue(event) ||
    isUnpaidExhaust(event)
  ) {
    return { ...current, locked: true };
  }
  if (isCapePeriodEnded(event)) {
    return { ...current, locked: true };
  }
  if (isScheduledDowngrade(event) && !isScheduledDowngradeDue(event)) {
    return current;
  }
  if (isScheduledDowngradeDue(event)) {
    const next = withEntitlements({ ...current }, event);
    next.plan = event.pending_plan;
    return next;
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

function foldCustomer(store: AccessStore, customerId: string): void {
  const ordered = store.events.filter((event) => event.customerId === customerId);
  ordered.sort((a, b) => {
    const byCreated = (a.created ?? 0) - (b.created ?? 0);
    if (byCreated !== 0) return byCreated;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  let snapshot: AccessSnapshot = { locked: true };
  for (const event of ordered) snapshot = nextSnapshot(snapshot, event);
  store.rows.set(customerId, snapshot);
}

export function applyBillingEvent(store: AccessStore, event: BillingEvent): void {
  if (store.seen.has(event.id)) return;
  store.seen.add(event.id);
  const stamped: BillingEvent = { ...event };
  if (stamped.created === undefined) stamped.created = store.arrival;
  store.arrival += 1;
  store.events.push(stamped);
  foldCustomer(store, event.customerId);
}

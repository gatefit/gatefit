import type { AccessAdapter, AccessSnapshot, BillingEvent } from "../access-adapter.ts";

const rows = new Map<string, AccessSnapshot>();
const seen = new Set<string>();

function isPaid(event: BillingEvent): boolean {
  return event.type === "invoice.paid" || event.paid === true;
}

function isCanceled(event: BillingEvent): boolean {
  return (
    event.canceled === true ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.canceled"
  );
}

const hardened: AccessAdapter = {
  apply(event: BillingEvent) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    const current = rows.get(event.customerId) ?? { locked: true };
    if (isPaid(event)) {
      rows.set(event.customerId, {
        ...current,
        locked: false,
        plan: event.plan ?? current.plan,
        seats: event.seats ?? current.seats,
        features: event.features ?? current.features,
      });
      return;
    }
    if (isCanceled(event)) {
      rows.set(event.customerId, { ...current, locked: true });
    }
  },
  snapshot(customerId: string) {
    return rows.get(customerId) ?? { locked: true };
  },
  reset() {
    rows.clear();
    seen.clear();
  },
};

export default hardened;

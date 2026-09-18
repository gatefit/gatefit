import type { AccessAdapter, AccessSnapshot, BillingEvent } from "../access-adapter.ts";

const rows = new Map<string, AccessSnapshot>();

function stripeLooksPaid(event: BillingEvent): boolean {
  return event.httpStatus === 200 || event.stripeHttpStatus === 200;
}

const naive: AccessAdapter = {
  apply(event: BillingEvent) {
    // Anti-pattern: treat Stripe HTTP 200 as access proof.
    if (stripeLooksPaid(event)) {
      rows.set(event.customerId, { locked: false, plan: event.plan });
    }
  },
  snapshot(customerId: string) {
    return rows.get(customerId) ?? { locked: true };
  },
  reset() {
    rows.clear();
  },
};

export default naive;

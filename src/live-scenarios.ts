import type { BillingEvent, AccessSnapshot } from "./access-adapter.ts";
import type { StripeInvoice, StripeSubscription } from "./stripe-clock.ts";

export const LIVE_SCENARIO_IDS = [
  "paid_grants_access",
  "cancel_revokes_access",
  "trial_to_paid_grants",
] as const;

export type LiveScenarioId = (typeof LIVE_SCENARIO_IDS)[number];

export type LiveScenarioResult = {
  id: LiveScenarioId;
  ok: boolean;
  mismatches: string[];
  customerId?: string;
};

export function billingEventsFromStripe(input: {
  customerId: string;
  plan: string;
  subscription: StripeSubscription;
  invoices: StripeInvoice[];
  stripeHttpStatus?: number;
}): BillingEvent[] {
  void input.stripeHttpStatus;
  const events: BillingEvent[] = [];
  if (input.subscription.status === "trialing") {
    events.push({
      id: `${input.subscription.id}:trialing`,
      type: "customer.subscription.updated",
      customerId: input.customerId,
      status: "trialing",
      plan: input.plan,
    });
  }
  for (const invoice of input.invoices) {
    if (invoice.paid === true || invoice.status === "paid") {
      events.push({
        id: invoice.id,
        type: "invoice.paid",
        customerId: input.customerId,
        plan: input.plan,
        paid: true,
      });
    }
  }
  if (input.subscription.status === "canceled" || input.subscription.status === "incomplete_expired") {
    events.push({
      id: `${input.subscription.id}:canceled`,
      type: "customer.subscription.deleted",
      customerId: input.customerId,
      canceled: true,
    });
  }
  return events;
}

export function expectedAccess(_id: LiveScenarioId, phase: "trial" | "paid" | "canceled"): AccessSnapshot {
  if (phase === "paid") return { locked: false, plan: "pro" };
  return { locked: true };
}

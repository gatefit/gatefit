import type { AccessAdapter, AccessSnapshot, BillingEvent } from "./access-adapter.ts";
import { compareAccess } from "./access-adapter.ts";
import { advanceUntilReady, withTestClock, type ClockWaitOpts } from "./clock-driver.ts";
import {
  MAX_CUSTOMERS_PER_CLOCK,
  MAX_SUBSCRIPTIONS_PER_CLOCK,
  type StripeClockClient,
  type StripeInvoice,
  type StripeSubscription,
} from "./stripe-clock.ts";

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

export async function runLiveLane(
  adapter: AccessAdapter,
  client: StripeClockClient,
  opts: {
    scenarios?: LiveScenarioId[];
    now?: () => number;
    wait?: ClockWaitOpts;
  } = {},
): Promise<{ ok: boolean; results: LiveScenarioResult[] }> {
  const ids = opts.scenarios ?? [...LIVE_SCENARIO_IDS];
  const results: LiveScenarioResult[] = [];
  for (const id of ids) {
    results.push(await runLiveScenario(adapter, client, id, { now: opts.now, wait: opts.wait }));
  }
  return { ok: results.every((row) => row.ok), results };
}

export async function runLiveScenario(
  adapter: AccessAdapter,
  client: StripeClockClient,
  id: LiveScenarioId,
  opts: { now?: () => number; wait?: ClockWaitOpts } = {},
): Promise<LiveScenarioResult> {
  if (!LIVE_SCENARIO_IDS.includes(id)) {
    throw new Error(`unknown live scenario: ${id}`);
  }
  const frozenTime = opts.now?.() ?? Math.floor(Date.now() / 1000);
  return withTestClock(client, { frozenTime, name: `gatefit-${id}` }, async (clock) => {
    let customers = 0;
    let subscriptions = 0;
    const customer = await client.createCustomer({ testClock: clock.id });
    customers += 1;
    if (customers > MAX_CUSTOMERS_PER_CLOCK) {
      throw new Error("too many customers on this clock");
    }

    if (id === "trial_to_paid_grants") {
      const sub = await client.createSubscription({ customer: customer.id, trialPeriodDays: 14 });
      subscriptions += 1;
      assertSubCap(subscriptions);
      await applyAndCheck(adapter, client, customer.id, sub, expectedAccess(id, "trial"));
      await advanceUntilReady(client, clock.id, frozenTime + 15 * 24 * 60 * 60, opts.wait);
      const after = await client.retrieveSubscription(sub.id);
      return applyAndCheck(adapter, client, customer.id, after, expectedAccess(id, "paid"), id);
    }

    const sub = await client.createSubscription({ customer: customer.id });
    subscriptions += 1;
    assertSubCap(subscriptions);
    if (id === "paid_grants_access") {
      return applyAndCheck(adapter, client, customer.id, sub, expectedAccess(id, "paid"), id);
    }
    await applyAndCheck(adapter, client, customer.id, sub, expectedAccess(id, "paid"));
    const canceled = await client.cancelSubscription(sub.id);
    return applyAndCheck(adapter, client, customer.id, canceled, expectedAccess(id, "canceled"), id);
  });
}

function assertSubCap(subscriptions: number): void {
  if (subscriptions > MAX_SUBSCRIPTIONS_PER_CLOCK) {
    throw new Error("too many subscriptions on this clock");
  }
}

async function applyAndCheck(
  adapter: AccessAdapter,
  client: StripeClockClient,
  customerId: string,
  subscription: StripeSubscription,
  expect: AccessSnapshot,
  id?: LiveScenarioId,
): Promise<LiveScenarioResult> {
  if (adapter.reset) await adapter.reset();
  const invoices = await client.listInvoices(customerId);
  const events = billingEventsFromStripe({ customerId, plan: "pro", subscription, invoices });
  for (const event of events) await adapter.apply(event);
  const actual = await adapter.snapshot(customerId);
  const cmp = compareAccess(actual, expect);
  if (!id) {
    if (!cmp.ok) throw new Error(cmp.mismatches.join("; "));
    return { id: "paid_grants_access", ok: true, mismatches: [], customerId };
  }
  return { id, ok: cmp.ok, mismatches: cmp.mismatches, customerId };
}

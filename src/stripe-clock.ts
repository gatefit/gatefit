import { assertNoLiveStripeSecret } from "./access-adapter.ts";

export const STRIPE_API_VERSION = "2025-10-29.clover";
export const TEST_PAYMENT_METHOD = "pm_card_visa";
export const MONTH_SECONDS = 30 * 24 * 60 * 60;
export const MAX_ADVANCE_INTERVALS = 2;
export const MAX_CUSTOMERS_PER_CLOCK = 3;
export const MAX_SUBSCRIPTIONS_PER_CLOCK = 3;

export type TestClock = {
  id: string;
  status: string;
  frozen_time: number;
};

export type StripeCustomer = { id: string };
export type StripeSubscription = { id: string; status: string; customer: string };
export type StripeInvoice = { id: string; status: string; paid: boolean; customer: string };

export type StripeClockClient = {
  createClock(input: { frozenTime: number; name?: string }): Promise<TestClock>;
  retrieveClock(id: string): Promise<TestClock>;
  advanceClock(id: string, frozenTime: number): Promise<TestClock>;
  deleteClock(id: string): Promise<{ id: string; deleted: boolean }>;
  createCustomer(input: { testClock: string; paymentMethod?: string }): Promise<StripeCustomer>;
  createSubscription(input: { customer: string; trialPeriodDays?: number }): Promise<StripeSubscription>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  cancelSubscription(id: string): Promise<StripeSubscription>;
  listInvoices(customerId: string): Promise<StripeInvoice[]>;
};

export function requireLiveClockEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.GATEFIT_LIVE_CLOCK !== "1") {
    throw new Error("live lane is opt-in: set GATEFIT_LIVE_CLOCK=1");
  }
}

export function requireTestModeSecret(env: NodeJS.ProcessEnv = process.env): string {
  assertNoLiveStripeSecret(JSON.stringify(env));
  const secret = env.STRIPE_SECRET_KEY ?? env.STRIPE_API_KEY ?? "";
  assertNoLiveStripeSecret(secret);
  if (!secret) {
    throw new Error("live lane requires STRIPE_SECRET_KEY or STRIPE_API_KEY (sk_test_ only)");
  }
  if (!secret.startsWith("sk_test_")) {
    throw new Error("refuse non-test Stripe secret: live lane requires sk_test_");
  }
  return secret;
}

export function assertAdvanceWithinTwoIntervals(
  from: number,
  to: number,
  intervalSeconds: number = MONTH_SECONDS,
): void {
  if (to <= from) {
    throw new Error("advance frozen_time must be after current frozen_time");
  }
  if (to > from + MAX_ADVANCE_INTERVALS * intervalSeconds) {
    throw new Error("advance exceeds two billing intervals");
  }
}

export function createStripeClockClient(opts: {
  secret: string;
  fetchImpl?: typeof fetch;
  apiVersion?: string;
  baseUrl?: string;
}): StripeClockClient {
  requireTestModeSecret({ STRIPE_SECRET_KEY: opts.secret });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiVersion = opts.apiVersion ?? STRIPE_API_VERSION;
  const baseUrl = (opts.baseUrl ?? "https://api.stripe.com").replace(/\/$/, "");

  async function request<T>(method: string, path: string, form?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.secret}`,
      "Stripe-Version": apiVersion,
    };
    const init: RequestInit = { method, headers };
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(form).toString();
    }
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) {
      const message = json.error?.message ?? `stripe ${method} ${path} failed`;
      throw new Error(message);
    }
    return json;
  }

  return {
    createClock(input) {
      const form: Record<string, string> = { frozen_time: String(input.frozenTime) };
      if (input.name) form.name = input.name;
      return request<TestClock>("POST", "/v1/test_helpers/test_clocks", form);
    },
    retrieveClock(id) {
      return request<TestClock>("GET", `/v1/test_helpers/test_clocks/${id}`);
    },
    advanceClock(id, frozenTime) {
      return request<TestClock>("POST", `/v1/test_helpers/test_clocks/${id}/advance`, {
        frozen_time: String(frozenTime),
      });
    },
    deleteClock(id) {
      return request<{ id: string; deleted: boolean }>("DELETE", `/v1/test_helpers/test_clocks/${id}`);
    },
    createCustomer(input) {
      const form: Record<string, string> = {
        test_clock: input.testClock,
        payment_method: input.paymentMethod ?? TEST_PAYMENT_METHOD,
        "invoice_settings[default_payment_method]": input.paymentMethod ?? TEST_PAYMENT_METHOD,
      };
      return request<StripeCustomer>("POST", "/v1/customers", form);
    },
    createSubscription(input) {
      const form: Record<string, string> = {
        customer: input.customer,
        "items[0][price_data][currency]": "usd",
        "items[0][price_data][product_data][name]": "gatefit-pro",
        "items[0][price_data][recurring][interval]": "month",
        "items[0][price_data][unit_amount]": "2000",
      };
      if (input.trialPeriodDays !== undefined) {
        form.trial_period_days = String(input.trialPeriodDays);
      }
      return request<StripeSubscription>("POST", "/v1/subscriptions", form);
    },
    retrieveSubscription(id) {
      return request<StripeSubscription>("GET", `/v1/subscriptions/${id}`);
    },
    cancelSubscription(id) {
      return request<StripeSubscription>("DELETE", `/v1/subscriptions/${id}`);
    },
    async listInvoices(customerId) {
      const payload = await request<{ data: StripeInvoice[] }>(
        "GET",
        `/v1/invoices?customer=${encodeURIComponent(customerId)}`,
      );
      return payload.data ?? [];
    },
  };
}

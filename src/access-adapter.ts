import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { resolveUserOrPackage } from "./paths.ts";

export type AccessSnapshot = {
  locked: boolean;
  plan?: string;
  seats?: number;
  features?: string[];
};

export type BillingEvent = {
  id: string;
  type: string;
  customerId: string;
  plan?: string;
  seats?: number;
  features?: string[];
  paid?: boolean;
  canceled?: boolean;
  refunded?: boolean;
  status?: string;
  httpStatus?: number;
  stripeHttpStatus?: number;
  cancel_at_period_end?: boolean;
  /** Portal downgrade held until now >= period_end. Not applied while the flag is set early. */
  downgrade_at_period_end?: boolean;
  /** Plan to apply when a scheduled portal downgrade is due. Ignored until then. */
  pending_plan?: string;
  period_end?: number;
  now?: number;
  /** Polar benefit key for benefit_grant.* events. Set-added or removed from features. */
  benefit?: string;
  /**
   * Event source for type names two providers send. Polar rules handle refund.* only
   * when this is "polar"; untagged ones fold with the Stripe rules. Paddle rules handle
   * subscription.created/.updated/.canceled only when this is "paddle"; untagged ones
   * fold with the Polar rules.
   */
  provider?: "polar" | "paddle";
  /** Paddle adjustment action (refund, chargeback, chargeback_reverse, credit, ...). */
  action?: string;
  /** Paddle adjustment type. Only an approved full refund locks. */
  adjustment_type?: "full" | "partial";
  /** Original timeline position. Chaos folds on this so arrival order is not access. */
  created?: number;
};

export type AccessAdapter = {
  apply(event: BillingEvent): void | Promise<void>;
  snapshot(customerId: string): AccessSnapshot | Promise<AccessSnapshot>;
  reset?: () => void | Promise<void>;
};

export type CompareResult = {
  ok: boolean;
  mismatches: string[];
};

const LIVE_KEY = /\bsk_live(?:_[A-Za-z0-9_]*)?/;

export function assertNoLiveStripeSecret(haystack: string): void {
  if (LIVE_KEY.test(haystack)) {
    throw new Error("refuse sk_live: Gatefit will not load a live Stripe secret");
  }
}

const POLAR_TOKEN = /\bpolar_(?:oat|pat)_[A-Za-z0-9]{16,}/;
const PADDLE_KEY = /\bpdl_(?:live|sdbx|ntfset)_[A-Za-z0-9_]{16,}/;

/**
 * Provider packs refuse live Stripe secrets, Polar organization or personal access
 * tokens, and Paddle API keys or notification secrets. The message never echoes the
 * matched value. polar_cl_ checkout links and Paddle client-side tokens are public
 * and are not refused.
 */
export function assertNoLiveSecret(haystack: string): void {
  assertNoLiveStripeSecret(haystack);
  if (POLAR_TOKEN.test(haystack)) {
    throw new Error("refuse Polar access token: Gatefit will not load a polar_oat_ or polar_pat_ token");
  }
  if (PADDLE_KEY.test(haystack)) {
    throw new Error("refuse Paddle secret: Gatefit will not load a pdl_live_, pdl_sdbx_ or pdl_ntfset_ key");
  }
}

export function compareAccess(actual: AccessSnapshot, expected: AccessSnapshot): CompareResult {
  const mismatches: string[] = [];
  const keys = Object.keys(expected) as (keyof AccessSnapshot)[];
  for (const key of keys) {
    const want = expected[key];
    const got = actual[key];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      mismatches.push(`${String(key)}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export async function loadAdapter(spec: string): Promise<AccessAdapter> {
  const resolved = resolveUserOrPackage(spec);
  const source = fs.readFileSync(resolved, "utf8");
  assertNoLiveStripeSecret(source);
  assertNoLiveStripeSecret(JSON.stringify(process.env));
  const mod = (await import(pathToFileURL(resolved).href)) as {
    createAdapter?: () => AccessAdapter;
    default?: AccessAdapter | (() => AccessAdapter);
    adapter?: AccessAdapter;
  };
  const adapter = instantiateAdapter(mod);
  if (!adapter || typeof adapter.apply !== "function" || typeof adapter.snapshot !== "function") {
    throw new Error(`adapter ${spec} must export createAdapter() or AccessAdapter with apply + snapshot`);
  }
  return adapter;
}

function instantiateAdapter(mod: {
  createAdapter?: () => AccessAdapter;
  default?: AccessAdapter | (() => AccessAdapter);
  adapter?: AccessAdapter;
}): AccessAdapter | undefined {
  if (typeof mod.createAdapter === "function") return mod.createAdapter();
  const candidate = mod.default ?? mod.adapter;
  if (typeof candidate === "function") return candidate();
  return candidate;
}

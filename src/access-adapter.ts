import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

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
  httpStatus?: number;
  stripeHttpStatus?: number;
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

const LIVE_KEY = /\bsk_live_[A-Za-z0-9]+/;

export function assertNoLiveStripeSecret(haystack: string): void {
  if (LIVE_KEY.test(haystack)) {
    throw new Error("refuse sk_live: Gatefit will not load a live Stripe secret");
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
  const resolved = path.resolve(spec);
  const source = fs.readFileSync(resolved, "utf8");
  assertNoLiveStripeSecret(source);
  assertNoLiveStripeSecret(JSON.stringify(process.env));
  const mod = (await import(pathToFileURL(resolved).href)) as {
    default?: AccessAdapter;
    adapter?: AccessAdapter;
  };
  const adapter = mod.default ?? mod.adapter;
  if (!adapter || typeof adapter.apply !== "function" || typeof adapter.snapshot !== "function") {
    throw new Error(`adapter ${spec} must export default AccessAdapter with apply + snapshot`);
  }
  return adapter;
}

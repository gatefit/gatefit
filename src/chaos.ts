import { createHash } from "node:crypto";
import type { AccessSnapshot, BillingEvent } from "./access-adapter.ts";
import { loadAdapter } from "./access-adapter.ts";
import { listGoldens, loadGolden } from "./fixture-driver.ts";
import type { GoldenSuite } from "./fixture-driver.ts";
import { registerProPack } from "./packs.ts";
import { goldenDir, resolveUserOrPackage } from "./paths.ts";

export const CHAOS_DEFAULT_SEED = "1";

const PERTURBATIONS = [
  "duplicate",
  "reorder",
  "stale",
  "late",
  "dropped_replay",
  "checkout_return",
] as const;

type Perturbation = (typeof PERTURBATIONS)[number];

export function resolveChaosSeed(flag: string | undefined, envValue: string | undefined): string {
  const raw = flag !== undefined ? flag : envValue;
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : CHAOS_DEFAULT_SEED;
}

function pickIndex(seed: string, goldenId: string, kind: string, salt: string, n: number): number {
  const digest = createHash("sha256").update(`${seed}\0${goldenId}\0${kind}\0${salt}`).digest();
  return digest.readUInt32BE(0) % n;
}

function cloneEvents(events: BillingEvent[]): BillingEvent[] {
  return events.map((event) => ({ ...event }));
}

function stamp(suite: GoldenSuite): BillingEvent[] {
  return suite.steps.map((step, index) => ({ ...step.event, created: index }));
}

function duplicate(seed: string, goldenId: string, events: BillingEvent[]): BillingEvent[] {
  const next = cloneEvents(events);
  const index = pickIndex(seed, goldenId, "duplicate", "i", next.length);
  next.push({ ...next[index]! });
  return next;
}

function reorder(seed: string, goldenId: string, events: BillingEvent[]): BillingEvent[] {
  const next = cloneEvents(events);
  if (next.length < 2) return next;
  const left = pickIndex(seed, goldenId, "reorder", "a", next.length);
  let right = pickIndex(seed, goldenId, "reorder", "b", next.length);
  if (left === right) right = (right + 1) % next.length;
  const swap = next[left]!;
  next[left] = next[right]!;
  next[right] = swap;
  return next;
}

function moveToEnd(events: BillingEvent[], index: number): BillingEvent[] {
  const next = cloneEvents(events);
  const [picked] = next.splice(index, 1);
  next.push(picked!);
  return next;
}

function stale(seed: string, goldenId: string, events: BillingEvent[]): BillingEvent[] {
  if (events.length < 2) return cloneEvents(events);
  const index = pickIndex(seed, goldenId, "stale", "i", events.length - 1);
  return moveToEnd(events, index);
}

function late(seed: string, goldenId: string, events: BillingEvent[]): BillingEvent[] {
  if (events.length < 2) return cloneEvents(events);
  const index = pickIndex(seed, goldenId, "late", "i", events.length);
  return moveToEnd(events, index);
}

function droppedReplay(seed: string, goldenId: string, events: BillingEvent[]): BillingEvent[] {
  const next = cloneEvents(events);
  const index = pickIndex(seed, goldenId, "dropped_replay", "i", next.length);
  next.splice(index, 1);
  return [...next, ...cloneEvents(events)];
}

function checkoutReturn(suite: GoldenSuite, events: BillingEvent[]): BillingEvent[] {
  const page: BillingEvent = {
    id: `evt_chaos_checkout_${suite.id}`,
    type: "checkout.session.completed",
    customerId: suite.subject,
    httpStatus: 200,
    stripeHttpStatus: 200,
    created: -1,
  };
  return [page, ...cloneEvents(events)];
}

function perturb(kind: Perturbation, seed: string, suite: GoldenSuite, events: BillingEvent[]): BillingEvent[] {
  if (kind === "duplicate") return duplicate(seed, suite.id, events);
  if (kind === "reorder") return reorder(seed, suite.id, events);
  if (kind === "stale") return stale(seed, suite.id, events);
  if (kind === "late") return late(seed, suite.id, events);
  if (kind === "dropped_replay") return droppedReplay(seed, suite.id, events);
  return checkoutReturn(suite, events);
}

function stableSnapshot(snapshot: AccessSnapshot): string {
  const keys = (Object.keys(snapshot) as (keyof AccessSnapshot)[])
    .filter((key) => snapshot[key] !== undefined)
    .sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = snapshot[key];
  return JSON.stringify(ordered);
}

async function replay(
  adapter: { apply: (event: BillingEvent) => void | Promise<void>; snapshot: (id: string) => AccessSnapshot | Promise<AccessSnapshot>; reset?: () => void | Promise<void> },
  subject: string,
  events: BillingEvent[],
): Promise<AccessSnapshot> {
  if (adapter.reset) await adapter.reset();
  for (const event of events) await adapter.apply(event);
  return adapter.snapshot(subject);
}

function fail(seed: string, goldenId: string, kind: Perturbation, events: BillingEvent[], expected: string, actual: string): void {
  console.error(`gatefit: FAIL chaos ${goldenId} perturbation ${kind}`);
  console.error(`seed: ${seed}`);
  console.error("repro:");
  for (const event of events) console.error(JSON.stringify(event));
  console.error(`access: expected ${expected} got ${actual}`);
}

export async function runChaos(adapterPath: string, seed: string): Promise<number> {
  console.error(`gatefit chaos: seed ${seed}`);
  if (process.env.GATEFIT_LIVE_CLOCK) {
    console.error("gatefit chaos: refuses GATEFIT_LIVE_CLOCK; fixture order only");
    return 1;
  }
  const adapter = await loadAdapter(resolveUserOrPackage(adapterPath));
  if (typeof adapter.reset !== "function") {
    console.error("gatefit chaos: adapter.reset is required");
    return 1;
  }
  const files = listGoldens(goldenDir());
  for (const file of files) {
    const suite = loadGolden(file);
    const ordered = stamp(suite);
    const expected = stableSnapshot(await replay(adapter, suite.subject, ordered));
    for (const kind of PERTURBATIONS) {
      const events = perturb(kind, seed, suite, ordered);
      const actual = stableSnapshot(await replay(adapter, suite.subject, events));
      if (actual !== expected) {
        fail(seed, suite.id, kind, events, expected, actual);
        return 1;
      }
    }
    console.error(`gatefit: PASS chaos ${suite.id}`);
  }
  console.error("gatefit: PASS chaos");
  return 0;
}

registerProPack({
  id: "chaos",
  run({ adapterPath, seed }) {
    return runChaos(adapterPath, seed);
  },
});

/**
 * GATEFIT-H30 status checks. Pure: probes take an injected fetch and clock, and the
 * /v1/status body is built from a StatusReader, so the tests run without Cloudflare.
 * D1 SQL lives in d1-store.ts.
 *
 * Nothing from a probe response is stored except a short detail code or a version.
 * A check that cannot run reports unknown, never ok.
 */
export const SERVICES = ["site", "npm", "telemetry", "action", "polar"] as const;
export type ServiceId = (typeof SERVICES)[number];

export const DAYS = 90;
export const SLOW_MS = 3000;
export const PROBE_TIMEOUT_MS = 5000;
/** Latest sample older than this reports unknown, so a dead cron never shows green. */
export const STALE_MS = 15 * 60_000;
/** Polar runs every 30 minutes (see probePolarNow), so it gets a longer window. */
export const POLAR_STALE_MS = 45 * 60_000;
/** Raw rows are kept from the start of the UTC day this many days back. */
export const RAW_KEEP_DAYS = 2;
export const NO_VERSION = "no version";

export const SITE_URL = "https://gatefit.io/";
export const NPM_URL = "https://registry.npmjs.org/gatefit/latest";
/** Public Gatefit Indie License Checkout Link; equals DEFAULT_POLAR_CHECKOUT_URL on the site. */
export const POLAR_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const DAY_MS = 86_400_000;

export function actionUrl(version: string): string {
  return `https://raw.githubusercontent.com/gatefit/gatefit/v${version}/action.yml`;
}

export type Check = { ts: number; service: ServiceId; ok: 0 | 1; latency_ms: number; detail: string };
export type DayAgg = { day: string; service: string; total: number; up: number; slow: number };
export type State = "ok" | "deg" | "down" | "unknown";
export type DayState = "ok" | "deg" | "down" | "none";
export type StatusDay = { day: string; up_pct: number | null; state: DayState };
export type StatusService = { id: ServiceId; state: State; version?: string; days: StatusDay[] };
export type StatusBody = { checked_at: string | null; services: StatusService[] };

export interface StatusReader {
  /** Latest check per service. */
  latest(): Promise<Check[]>;
  /** Rolled-up days on or after sinceDay. */
  days(sinceDay: string): Promise<DayAgg[]>;
  /** Live aggregate of raw rows at or after sinceTs, by UTC day. */
  liveDays(sinceTs: number): Promise<DayAgg[]>;
}

export interface StatusStore extends StatusReader {
  record(rows: Check[]): Promise<void>;
  rollup(now: Date): Promise<void>;
}

export type ProbeDeps = {
  fetch: typeof fetch;
  /** In-process GET /v1/stats?days=1 against D1 (the Worker cannot reliably fetch its own domain). */
  selfCheck: () => Promise<Response>;
  clock?: () => number;
  timeoutMs?: number;
};

type Outcome = { ok: boolean; detail: string };

class Timeout extends Error {}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** The 5-minute cron probes Polar only on the :00 and :30 runs. */
export function probePolarNow(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % 30 === 0;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Timeout());
    }, ms);
  });
  try {
    return await Promise.race([run(ctrl.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function measure(service: ServiceId, deps: ProbeDeps, probe: (signal: AbortSignal) => Promise<Outcome>): Promise<Check> {
  const clock = deps.clock ?? Date.now;
  const start = clock();
  let out: Outcome;
  try {
    out = await withTimeout(deps.timeoutMs ?? PROBE_TIMEOUT_MS, probe);
  } catch (err) {
    out = { ok: false, detail: err instanceof Timeout || (err as Error)?.name === "AbortError" ? "timeout" : "error" };
  }
  const end = clock();
  return { ts: start, service, ok: out.ok ? 1 : 0, latency_ms: Math.max(0, Math.round(end - start)), detail: out.detail.slice(0, 64) };
}

/** Non-200: the body is never read, so release it. */
async function httpFail(res: Response): Promise<Outcome> {
  await res.body?.cancel();
  return { ok: false, detail: `http ${res.status}` };
}

async function probeSite(deps: ProbeDeps, signal: AbortSignal): Promise<Outcome> {
  const res = await deps.fetch(SITE_URL, { signal });
  if (res.status !== 200) return httpFail(res);
  return (await res.text()).includes("Gatefit") ? { ok: true, detail: "" } : { ok: false, detail: "bad body" };
}

async function probeNpm(deps: ProbeDeps, signal: AbortSignal): Promise<Outcome> {
  const res = await deps.fetch(NPM_URL, { signal });
  if (res.status !== 200) return httpFail(res);
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { ok: false, detail: "bad body" };
  }
  const version = body && typeof body === "object" && !Array.isArray(body) ? (body as { version?: unknown }).version : undefined;
  if (typeof version !== "string" || version.length > 32 || !SEMVER.test(version)) return { ok: false, detail: "bad body" };
  return { ok: true, detail: version };
}

async function probeAction(deps: ProbeDeps, version: string, signal: AbortSignal): Promise<Outcome> {
  const res = await deps.fetch(actionUrl(version), { signal });
  if (res.status !== 200) return httpFail(res);
  return /using:\s*["']?composite/.test(await res.text()) ? { ok: true, detail: version } : { ok: false, detail: "bad body" };
}

function polarOk(res: Response): boolean {
  if (res.status >= 200 && res.status < 300) return true;
  if (res.status < 300 || res.status >= 400) return false;
  try {
    const host = new URL(res.headers.get("location") ?? "", POLAR_CHECKOUT_URL).hostname;
    return host === "polar.sh" || host.endsWith(".polar.sh");
  } catch {
    return false;
  }
}

async function probePolar(deps: ProbeDeps, signal: AbortSignal): Promise<Outcome> {
  let res = await deps.fetch(POLAR_CHECKOUT_URL, { method: "HEAD", redirect: "manual", signal });
  await res.body?.cancel();
  if (res.status === 405 || res.status === 501) {
    res = await deps.fetch(POLAR_CHECKOUT_URL, { method: "GET", redirect: "manual", signal });
    await res.body?.cancel();
  }
  return polarOk(res) ? { ok: true, detail: "" } : { ok: false, detail: `http ${res.status}` };
}

async function probeTelemetry(deps: ProbeDeps): Promise<Outcome> {
  const res = await deps.selfCheck();
  if (res.status !== 200) return httpFail(res);
  try {
    const body = JSON.parse(await res.text()) as { counts?: unknown };
    return Array.isArray(body?.counts) ? { ok: true, detail: "" } : { ok: false, detail: "bad body" };
  } catch {
    return { ok: false, detail: "bad body" };
  }
}

/** Runs every probe in parallel (the Action probe waits for the npm version). */
export async function runChecks(deps: ProbeDeps, opts: { polar: boolean }): Promise<Check[]> {
  const npmThenAction = measure("npm", deps, (s) => probeNpm(deps, s)).then(async (npm) => {
    const action: Check = npm.ok
      ? await measure("action", deps, (s) => probeAction(deps, npm.detail, s))
      : { ts: npm.ts, service: "action", ok: 0, latency_ms: 0, detail: NO_VERSION };
    return [npm, action];
  });
  const rows = await Promise.all([
    measure("site", deps, (s) => probeSite(deps, s)),
    measure("telemetry", deps, () => probeTelemetry(deps)),
    ...(opts.polar ? [measure("polar", deps, (s) => probePolar(deps, s))] : []),
    npmThenAction,
  ]);
  return rows.flat();
}

/** One sample: failed is down, ok but slower than SLOW_MS is degraded. */
export function sampleState(c: Check): "ok" | "deg" | "down" {
  if (!c.ok) return "down";
  return c.latency_ms > SLOW_MS ? "deg" : "ok";
}

/** One day: >=99% up is ok (deg if more than 10% of samples were slow), >=95% deg, else down. */
export function dayState(agg: { total: number; up: number; slow: number }): { up_pct: number | null; state: DayState } {
  if (!agg.total) return { up_pct: null, state: "none" };
  const up_pct = Math.round((10_000 * agg.up) / agg.total) / 100;
  if (up_pct >= 99) return { up_pct, state: agg.slow / agg.total > 0.1 ? "deg" : "ok" };
  return { up_pct, state: up_pct >= 95 ? "deg" : "down" };
}

function currentState(c: Check | undefined, now: number): State {
  if (!c) return "unknown";
  const stale = c.service === "polar" ? POLAR_STALE_MS : STALE_MS;
  if (now - c.ts > stale) return "unknown";
  if (c.service === "action" && !c.ok && c.detail === NO_VERSION) return "unknown";
  return sampleState(c);
}

export async function buildStatus(reader: StatusReader, now: Date): Promise<StatusBody> {
  const nowMs = now.getTime();
  const today0 = startOfDay(nowMs);
  const first = today0 - (DAYS - 1) * DAY_MS;
  const [latest, rolled, live] = await Promise.all([
    reader.latest(),
    reader.days(dayOf(first)),
    reader.liveDays(today0 - DAY_MS),
  ]);
  const aggs = new Map<string, DayAgg>();
  for (const r of rolled) aggs.set(`${r.service}|${r.day}`, r);
  for (const r of live) aggs.set(`${r.service}|${r.day}`, r);
  const latestBy = new Map(latest.map((c) => [c.service, c]));
  const services = SERVICES.map((id): StatusService => {
    const c = latestBy.get(id);
    const state = currentState(c, nowMs);
    const days: StatusDay[] = [];
    for (let k = 0; k < DAYS; k++) {
      const day = dayOf(first + k * DAY_MS);
      const agg = aggs.get(`${id}|${day}`);
      days.push({ day, ...dayState(agg ?? { total: 0, up: 0, slow: 0 }) });
    }
    const out: StatusService = { id, state, days };
    if ((id === "npm" || id === "action") && state !== "unknown" && c?.ok && SEMVER.test(c.detail)) {
      out.version = c.detail;
    }
    return out;
  });
  const newest = latest.reduce((m, c) => Math.max(m, c.ts), -Infinity);
  return { checked_at: latest.length ? new Date(newest).toISOString() : null, services };
}

/** Nightly window: roll up finished days still fully in raw, prune raw and old days. */
export function rollupWindow(now: Date): { from: number; to: number; dayCutoff: string } {
  const to = startOfDay(now.getTime());
  return { from: to - RAW_KEEP_DAYS * DAY_MS, to, dayCutoff: dayOf(to - (DAYS - 1) * DAY_MS) };
}

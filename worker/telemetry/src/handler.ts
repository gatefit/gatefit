/**
 * GATEFIT-H25 telemetry collector. Pure request handler: standard Request/Response and
 * crypto.subtle only, so it runs on Workers and under the repo tests. Storage is behind
 * TelemetryStore; the Cloudflare D1 binding lives in index.ts.
 *
 * GATEFIT-H30: GET /v1/status serves probe results from a StatusReader; /v1/status and
 * /v1/stats carry read-only CORS for gatefit.io and a 60-second public cache. The probes
 * and the daily rollup run from the Cron Triggers in index.ts (checks in status.ts), not here.
 *
 * Privacy: every value is allowlisted, the raw install id is hashed to a 16-hex day key
 * and dropped, nothing is logged, and client IPs and user agents are never read.
 */
import { buildStatus, type StatusReader } from "./status.ts";

export const SITE_ORIGIN = "https://gatefit.io";

/** Must equal PAYLOAD_KEYS in src/telemetry.ts (asserted by the tests). */
export const EVENT_KEYS = [
  "v",
  "install_id",
  "version",
  "node",
  "platform",
  "arch",
  "command",
  "outcome",
  "template",
  "pack",
  "suite",
] as const;

export const ALLOWED = {
  command: ["init", "run", "adapter-check", "live"],
  outcome: ["pass", "fail", "error"],
  platform: ["linux", "darwin", "win32", "other"],
  arch: ["x64", "arm64", "other"],
  template: ["", "drizzle", "prisma", "supabase", "generic", "auto"],
  pack: ["", "chaos", "polar", "paddle"],
  suite: [
    "",
    "pack",
    "custom",
    "paid_grants_access",
    "cancel_revokes_access",
    "refund_revokes_access",
    "trial_to_paid_grants",
    "past_due_denies_until_recovery",
    "duplicate_webhook_idempotent",
    "seat_qty_vs_db_cap",
    "cancel_at_period_end_keeps_access_until_end",
    "upgrade_plus_cape_race",
    "dispute_revokes_or_flags",
    "unpaid_after_retries_revokes",
    "trial_no_card",
    "portal_downgrade_period_end_vs_immediate",
    "entitlements_active_summary",
  ],
} as const satisfies Record<string, readonly string[]>;

const EVENT_MAX_BYTES = 1024;
const SITE_MAX_BYTES = 64;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const NODE_MAJOR = /^\d{1,3}$/;

export type CountRow = {
  day: string;
  kind: "cli" | "site";
  command: string;
  version: string;
  node: string;
  platform: string;
  arch: string;
  outcome: string;
  template: string;
  pack: string;
  suite: string;
  event: string;
};

export type Stats = {
  counts: (CountRow & { n: number })[];
  installs: { day: string; distinct: number }[];
};

export interface TelemetryStore {
  increment(row: CountRow): Promise<void>;
  addInstall(day: string, hash: string): Promise<void>;
  stats(sinceDay: string): Promise<Stats>;
}

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function readBounded(req: Request, max: number): Promise<string | null> {
  // An honest oversize content-length is refused without buffering the body.
  // The header can lie, so the byte check after the read still applies.
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) return null;
  return new TextDecoder().decode(bytes);
}

function parseObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function oneOf(list: readonly string[], value: unknown): value is string {
  return typeof value === "string" && list.includes(value);
}

function validEvent(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.length !== EVENT_KEYS.length) return false;
  if (!EVENT_KEYS.every((key) => Object.hasOwn(body, key))) return false;
  if (body.v !== 1) return false;
  if (typeof body.install_id !== "string" || !UUID_V4.test(body.install_id)) return false;
  if (typeof body.version !== "string" || body.version.length > 32 || !SEMVER.test(body.version)) return false;
  if (typeof body.node !== "string" || !NODE_MAJOR.test(body.node)) return false;
  return (Object.keys(ALLOWED) as (keyof typeof ALLOWED)[]).every((key) => oneOf(ALLOWED[key], body[key]));
}

async function installHash(installId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(installId));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handleEvent(req: Request, store: TelemetryStore, now: Date): Promise<Response> {
  const text = await readBounded(req, EVENT_MAX_BYTES);
  if (text === null) return empty(413);
  const body = parseObject(text);
  if (!body || !validEvent(body)) return empty(400);
  const day = dayOf(now);
  const s = body as Record<(typeof EVENT_KEYS)[number], string>;
  await store.increment({
    day,
    kind: "cli",
    command: s.command,
    version: s.version,
    node: s.node,
    platform: s.platform,
    arch: s.arch,
    outcome: s.outcome,
    template: s.template,
    pack: s.pack,
    suite: s.suite,
    event: "",
  });
  await store.addInstall(day, await installHash(s.install_id));
  return empty(204);
}

const SITE_CORS = {
  "access-control-allow-origin": SITE_ORIGIN,
  "access-control-allow-methods": "POST",
  vary: "Origin",
};

async function handleSite(req: Request, store: TelemetryStore, now: Date): Promise<Response> {
  if (req.headers.get("origin") !== SITE_ORIGIN) return empty(403);
  if (req.method === "OPTIONS") return empty(204, SITE_CORS);
  const text = await readBounded(req, SITE_MAX_BYTES);
  if (text === null) return empty(413, SITE_CORS);
  const body = parseObject(text);
  if (!body || Object.keys(body).length !== 1 || body.event !== "buy_click") return empty(400, SITE_CORS);
  await store.increment({
    day: dayOf(now),
    kind: "site",
    command: "",
    version: "",
    node: "",
    platform: "",
    arch: "",
    outcome: "",
    template: "",
    pack: "",
    suite: "",
    event: "buy_click",
  });
  return empty(204, SITE_CORS);
}

// Read-only CORS for the public status page. Static origin, so a cached response is the
// same for every caller.
const READ_CORS = {
  "access-control-allow-origin": SITE_ORIGIN,
  "access-control-allow-methods": "GET",
  vary: "Origin",
};

const READ_HEADERS = {
  ...READ_CORS,
  "content-type": "application/json",
  "cache-control": "public, max-age=60",
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: READ_HEADERS });
}

async function handleStatus(req: Request, status: StatusReader, now: Date): Promise<Response> {
  if (req.method === "OPTIONS") return empty(204, READ_CORS);
  if (req.method === "HEAD") return new Response(null, { status: 200, headers: READ_HEADERS });
  return json(await buildStatus(status, now));
}

async function handleStats(url: URL, store: TelemetryStore, now: Date): Promise<Response> {
  const raw = url.searchParams.get("days");
  let days = DEFAULT_DAYS;
  if (raw !== null) {
    if (!/^\d{1,3}$/.test(raw)) return empty(400);
    days = Number(raw);
    if (days < 1 || days > MAX_DAYS) return empty(400);
  }
  const since = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  return json(await store.stats(since));
}

export async function handleRequest(
  req: Request,
  store: TelemetryStore,
  now: Date = new Date(),
  status?: StatusReader,
): Promise<Response> {
  const url = new URL(req.url);
  switch (url.pathname) {
    case "/v1/event":
      return req.method === "POST" ? handleEvent(req, store, now) : empty(405);
    case "/v1/site":
      return req.method === "POST" || req.method === "OPTIONS" ? handleSite(req, store, now) : empty(405);
    case "/v1/stats":
      return req.method === "GET" ? handleStats(url, store, now) : empty(405);
    case "/v1/status":
      if (!status) return empty(404);
      return ["GET", "HEAD", "OPTIONS"].includes(req.method) ? handleStatus(req, status, now) : empty(405);
    default:
      return empty(404);
  }
}

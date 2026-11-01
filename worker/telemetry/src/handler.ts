// GATEFIT-H25 collector. Pure request handler: standard Request/Response/crypto.subtle
// only, so the repo typecheck and tests can load it without Cloudflare types.
// No logging, no client IP, no user agent. Counts are aggregates; the install id is
// reduced to a 16-hex SHA-256 prefix for the per-day distinct table and then dropped.

export const SITE_ORIGIN = "https://gatefit.io";

/** Must equal PAYLOAD_KEYS in src/telemetry.ts (a test asserts it). */
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

/** Must equal the CLI allowlists in src/telemetry.ts (a test asserts it). */
export const ALLOWED = {
  command: ["init", "run", "adapter-check", "live"],
  outcome: ["pass", "fail", "error"],
  platform: ["linux", "darwin", "win32", "other"],
  arch: ["x64", "arm64", "other"],
  template: ["", "drizzle", "prisma", "supabase", "generic", "auto"],
  pack: ["", "chaos", "polar"],
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

const MAX_EVENT_BYTES = 1024;
const MAX_SITE_BYTES = 64;
const MAX_DAYS = 90;
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

function day(now: Date, minusDays = 0): string {
  return new Date(now.getTime() - minusDays * 86_400_000).toISOString().slice(0, 10);
}

async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).length > max ? null : text;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function validEvent(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.length !== EVENT_KEYS.length || !EVENT_KEYS.every((k) => keys.includes(k))) return false;
  if (body.v !== 1) return false;
  for (const key of EVENT_KEYS) {
    if (key !== "v" && typeof body[key] !== "string") return false;
  }
  if (!UUID_V4.test(body.install_id as string)) return false;
  const version = body.version as string;
  if (version.length > 32 || !SEMVER.test(version)) return false;
  if (!NODE_MAJOR.test(body.node as string)) return false;
  for (const [key, allowed] of Object.entries(ALLOWED)) {
    if (!(allowed as readonly string[]).includes(body[key] as string)) return false;
  }
  return true;
}

async function installHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handleEvent(req: Request, store: TelemetryStore, now: Date): Promise<Response> {
  const text = await readCapped(req, MAX_EVENT_BYTES);
  if (text === null) return empty(413);
  const body = parseObject(text);
  if (!body || !validEvent(body)) return empty(400);
  const today = day(now);
  await store.increment({
    day: today,
    kind: "cli",
    command: body.command as string,
    version: body.version as string,
    node: body.node as string,
    platform: body.platform as string,
    arch: body.arch as string,
    outcome: body.outcome as string,
    template: body.template as string,
    pack: body.pack as string,
    suite: body.suite as string,
    event: "",
  });
  await store.addInstall(today, await installHash(body.install_id as string));
  return empty(204);
}

const SITE_CORS = {
  "access-control-allow-origin": SITE_ORIGIN,
  "access-control-allow-methods": "POST",
  "access-control-allow-headers": "content-type",
  vary: "Origin",
};

async function handleSite(req: Request, store: TelemetryStore, now: Date): Promise<Response> {
  if (req.headers.get("origin") !== SITE_ORIGIN) return empty(403);
  if (req.method === "OPTIONS") return empty(204, SITE_CORS);
  const text = await readCapped(req, MAX_SITE_BYTES);
  if (text === null) return empty(413, SITE_CORS);
  const body = parseObject(text);
  const keys = body ? Object.keys(body) : [];
  if (!body || keys.length !== 1 || body.event !== "buy_click") return empty(400, SITE_CORS);
  await store.increment({
    day: day(now),
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

async function handleStats(url: URL, store: TelemetryStore, now: Date): Promise<Response> {
  const raw = url.searchParams.get("days");
  const days = raw === null ? 30 : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return empty(400);
  const stats = await store.stats(day(now, days - 1));
  const body: Stats = {
    counts: stats.counts.map((r) => ({
      day: r.day,
      kind: r.kind,
      command: r.command,
      version: r.version,
      node: r.node,
      platform: r.platform,
      arch: r.arch,
      outcome: r.outcome,
      template: r.template,
      pack: r.pack,
      suite: r.suite,
      event: r.event,
      n: r.n,
    })),
    installs: stats.installs.map((r) => ({ day: r.day, distinct: r.distinct })),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function handleRequest(req: Request, store: TelemetryStore, now: Date = new Date()): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/v1/event") {
    return req.method === "POST" ? handleEvent(req, store, now) : empty(405, { allow: "POST" });
  }
  if (url.pathname === "/v1/site") {
    return req.method === "POST" || req.method === "OPTIONS"
      ? handleSite(req, store, now)
      : empty(405, { allow: "POST, OPTIONS" });
  }
  if (url.pathname === "/v1/stats") {
    return req.method === "GET" ? handleStats(url, store, now) : empty(405, { allow: "GET" });
  }
  return empty(404);
}

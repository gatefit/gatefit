import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Public Polar customer-portal validate endpoint. No API token. */
export const POLAR_LICENSE_VALIDATE_URL =
  "https://api.polar.sh/v1/customer-portal/license-keys/validate";

/** Gatefit organization id from the public Indie License checkout. */
export const POLAR_ORGANIZATION_ID = "68556619-45ab-4a88-8ad8-08606c2b820e";

/** Indie License benefit id. Scopes validation to that benefit. */
export const POLAR_BENEFIT_ID = "4e8e6528-a979-4060-b675-7686c752a4a2";

export const LICENSE_BUY_URL = "https://gatefit.io/#pricing";

/** Fresh cache entries skip the network. Older entries still count when Polar is down. */
export const LICENSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const KEY_PREFIX = "GATEFIT-";

export type LicenseDecision =
  | { ok: true; warning?: string }
  | { ok: false; message: string };

type CacheEntry = { granted: true; cachedAt: number };
type CacheFile = { v: 1; entries: Record<string, CacheEntry> };

function buy(reason: string): string {
  return `gatefit: ${reason} Buy the Indie License: ${LICENSE_BUY_URL}`;
}

function cachePath(env: NodeJS.ProcessEnv): string {
  return env.GATEFIT_LICENSE_CACHE ?? path.join(os.homedir(), ".gatefit", "license-cache.json");
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function emptyCache(): CacheFile {
  return { v: 1, entries: {} };
}

function readCache(file: string): CacheFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
    if (parsed?.v !== 1 || !parsed.entries || typeof parsed.entries !== "object") return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

function writeCache(file: string, cache: CacheFile): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.license-cache-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function remember(file: string, key: string): void {
  const cache = readCache(file);
  cache.entries[hashKey(key)] = { granted: true, cachedAt: Date.now() };
  writeCache(file, cache);
}

function forget(file: string, key: string): void {
  const cache = readCache(file);
  delete cache.entries[hashKey(key)];
  try {
    writeCache(file, cache);
  } catch {
    /* a failed delete must not print the key */
  }
}

function cachedGrant(file: string, key: string): CacheEntry | undefined {
  const entry = readCache(file).entries[hashKey(key)];
  if (!entry || entry.granted !== true || typeof entry.cachedAt !== "number") return undefined;
  return entry;
}

function validateUrl(env: NodeJS.ProcessEnv): string {
  return env.GATEFIT_LICENSE_VALIDATE_URL || POLAR_LICENSE_VALIDATE_URL;
}

type PolarVerdict = "granted" | "revoked" | "invalid" | "unreachable";

async function askPolar(key: string, env: NodeJS.ProcessEnv): Promise<PolarVerdict> {
  try {
    const response = await fetch(validateUrl(env), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        key,
        organization_id: POLAR_ORGANIZATION_ID,
        benefit_id: POLAR_BENEFIT_ID,
      }),
      signal: AbortSignal.timeout(4000),
    });
    const text = await response.text();
    let payload: { status?: unknown; error?: unknown; detail?: unknown } = {};
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      return response.status >= 500 ? "unreachable" : "invalid";
    }
    const status = typeof payload.status === "string" ? payload.status : "";
    const detail = `${payload.error ?? ""} ${payload.detail ?? ""}`;
    if (response.status >= 500) return "unreachable";
    if (status === "granted" && response.ok) return "granted";
    if (status === "revoked" || /revok/i.test(detail)) return "revoked";
    if (response.status === 404) return "invalid";
    return "invalid";
  } catch {
    return "unreachable";
  }
}

export async function ensureProLicense(env: NodeJS.ProcessEnv = process.env): Promise<LicenseDecision> {
  const key = env.GATEFIT_LICENSE_KEY?.trim() ?? "";
  if (!key) {
    return { ok: false, message: buy("Pro pack requires GATEFIT_LICENSE_KEY.") };
  }
  if (!key.startsWith(KEY_PREFIX)) {
    return { ok: false, message: buy("GATEFIT_LICENSE_KEY is not valid.") };
  }

  const file = cachePath(env);
  const cached = cachedGrant(file, key);
  if (cached && Date.now() - cached.cachedAt < LICENSE_CACHE_TTL_MS) {
    return { ok: true };
  }

  const verdict = await askPolar(key, env);
  if (verdict === "granted") {
    try {
      remember(file, key);
    } catch {
      /* running does not depend on writing the cache */
    }
    return { ok: true };
  }
  if (verdict === "revoked") {
    forget(file, key);
    return { ok: false, message: buy("GATEFIT_LICENSE_KEY is revoked.") };
  }
  if (verdict === "invalid") {
    forget(file, key);
    return { ok: false, message: buy("GATEFIT_LICENSE_KEY is not valid.") };
  }
  if (cached) {
    return { ok: true, warning: "gatefit: Polar license check unreachable; using cached valid result" };
  }
  return { ok: true, warning: "gatefit: Polar license check unreachable; running without a cached license" };
}

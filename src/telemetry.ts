import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPackageVersion } from "./paths.ts";

/**
 * GATEFIT-H25 opt-in CLI telemetry. Off by default: nothing is sent and nothing is
 * written unless GATEFIT_TELEMETRY=1 or `gatefit telemetry on`. Every payload value
 * goes through an allowlist; raw argv, paths, and env values never leave the machine.
 */
export const TELEMETRY_ENDPOINT = "https://t.gatefit.io/v1/event";

export const PAYLOAD_KEYS = [
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

export const COMMANDS = ["init", "run", "adapter-check", "live"] as const;
export const OUTCOMES = ["pass", "fail", "error"] as const;
export const PLATFORMS = ["linux", "darwin", "win32", "other"] as const;
export const ARCHS = ["x64", "arm64", "other"] as const;
export const TEMPLATES = ["drizzle", "prisma", "supabase", "generic", "auto"] as const;
const INIT_TEMPLATE_FLAGS = TEMPLATES.filter((t) => t !== "auto");
export const PACKS = ["chaos", "polar", "paddle"] as const;
/** The bundled free golden ids. Anything else passed to --suite reports as `custom`. */
export const SUITES = [
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
] as const;

export type Command = (typeof COMMANDS)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type Payload = { v: 1 } & Record<Exclude<(typeof PAYLOAD_KEYS)[number], "v">, string>;

const TIMEOUT_MS = 1500;
const RACE_MS = 1600;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

type Env = NodeJS.ProcessEnv;
type Config = { v?: number; enabled?: boolean; install_id?: string };
type Loaded = { kind: "missing" } | { kind: "corrupt" } | { kind: "ok"; cfg: Config };

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

export function configPath(env: Env = process.env): string {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "gatefit", "telemetry.json");
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "gatefit", "telemetry.json");
  return path.join(os.homedir(), ".config", "gatefit", "telemetry.json");
}

function loadConfig(env: Env): Loaded {
  let text: string;
  try {
    text = fs.readFileSync(configPath(env), "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "corrupt" };
  }
  try {
    const cfg = JSON.parse(text) as unknown;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { kind: "corrupt" };
    return { kind: "ok", cfg: cfg as Config };
  } catch {
    return { kind: "corrupt" };
  }
}

function saveConfig(env: Env, cfg: Config): void {
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg)}\n`, { mode: 0o600 });
}

export type State = { enabled: boolean; reason: string };

/** First match wins. DO_NOT_TRACK, GATEFIT_TELEMETRY=0, and `telemetry off` always win. */
export function resolveState(env: Env, loaded: Loaded): State {
  if (truthy(env.DO_NOT_TRACK)) return { enabled: false, reason: "DO_NOT_TRACK is set" };
  const flag = env.GATEFIT_TELEMETRY;
  if (flag === "0" || flag === "false") return { enabled: false, reason: "GATEFIT_TELEMETRY=0" };
  if (loaded.kind === "corrupt") return { enabled: false, reason: "config file is unreadable" };
  const cfg = loaded.kind === "ok" ? loaded.cfg : {};
  if (cfg.enabled === false) return { enabled: false, reason: "`gatefit telemetry off`" };
  if (flag === "1") return { enabled: true, reason: "GATEFIT_TELEMETRY=1" };
  if (truthy(env.CI)) return { enabled: false, reason: "CI is set (only GATEFIT_TELEMETRY=1 opts in on CI)" };
  if (cfg.enabled === true) return { enabled: true, reason: "`gatefit telemetry on`" };
  return { enabled: false, reason: "default (opt-in, off by default)" };
}

/** Production endpoint, or a loopback test collector. Any other override sends nowhere. */
export function endpoint(env: Env): string | null {
  const override = env.GATEFIT_TELEMETRY_URL;
  if (override === undefined) return TELEMETRY_ENDPOINT;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.username || url.password || !url.port) return null;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null;
  return override;
}

function flagValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === `--${name}`) return args[i + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return undefined;
}

function pick<T extends string>(allowed: readonly T[], value: string, fallback: T | ""): T | "" {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function buildPayload(ctx: { installId: string; command: Command; outcome: Outcome; args: string[] }): Payload {
  const version = readPackageVersion();
  let template = "";
  let pack = "";
  let suite = "";
  if (ctx.command === "init") {
    const value = flagValue(ctx.args, "template");
    template = value === undefined ? "auto" : pick(INIT_TEMPLATE_FLAGS, value, "");
  }
  if (ctx.command === "run") {
    const value = flagValue(ctx.args, "suite");
    if (value !== undefined) {
      pack = pick(PACKS, value, "");
      suite = pack ? "pack" : pick(SUITES, value, "custom");
    }
  }
  return {
    v: 1,
    install_id: ctx.installId,
    version: SEMVER.test(version) ? version : "0.0.0",
    node: process.versions.node.split(".")[0]!,
    platform: pick(PLATFORMS, process.platform, "other"),
    arch: pick(ARCHS, process.arch, "other"),
    command: ctx.command,
    outcome: ctx.outcome,
    template,
    pack,
    suite,
  };
}

/** One bounded POST. Never throws, never prints. */
export async function sendBounded(url: string, payload: Payload): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).then(
        (res) => res.body?.cancel().catch(() => {}),
        () => {},
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RACE_MS);
      }),
    ]);
  } catch {
    // Telemetry must never change a run.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Called once after a command finished. Silent; the exit code is decided before this runs. */
export async function maybeSendTelemetry(argv: string[], outcome: Outcome, env: Env = process.env): Promise<void> {
  try {
    const command = argv[0];
    if (!(COMMANDS as readonly string[]).includes(command ?? "")) return;
    const loaded = loadConfig(env);
    if (!resolveState(env, loaded).enabled) return;
    const url = endpoint(env);
    if (!url) return;
    const cfg = loaded.kind === "ok" ? loaded.cfg : {};
    let installId = cfg.install_id;
    if (!installId || !UUID_V4.test(installId)) {
      installId = randomUUID();
      saveConfig(env, { ...cfg, v: 1, install_id: installId });
    }
    await sendBounded(url, buildPayload({ installId, command: command as Command, outcome, args: argv.slice(1) }));
  } catch {
    // Telemetry must never change a run.
  }
}

function telemetryUsage(): string {
  return "Usage: gatefit telemetry on|off|status";
}

/** `gatefit telemetry on|off|status`. Local only: this command never sends anything. */
export function cmdTelemetry(args: string[], env: Env = process.env): number {
  const sub = args[0];
  if (args.length !== 1 || !sub || !["on", "off", "status"].includes(sub)) {
    console.error(telemetryUsage());
    return 1;
  }
  const file = configPath(env);
  const loaded = loadConfig(env);
  if (sub === "on") {
    const prev = loaded.kind === "ok" ? loaded.cfg : {};
    const installId = prev.install_id && UUID_V4.test(prev.install_id) ? prev.install_id : randomUUID();
    saveConfig(env, { v: 1, enabled: true, install_id: installId });
  } else if (sub === "off") {
    saveConfig(env, { v: 1, enabled: false });
  }
  const now = sub === "status" ? loaded : loadConfig(env);
  const state = resolveState(env, now);
  const cfg = now.kind === "ok" ? now.cfg : {};
  const example = buildPayload({
    installId: cfg.install_id && UUID_V4.test(cfg.install_id) ? cfg.install_id : "<random id, created on enable>",
    command: "run",
    outcome: "pass",
    args: ["--suite", SUITES[0]],
  });
  console.log(`gatefit telemetry: ${state.enabled ? "on" : "off"} (${state.reason})`);
  console.log(`config: ${file}`);
  console.log(`endpoint: ${TELEMETRY_ENDPOINT}`);
  console.log("payload sent once per init/run/adapter-check/live when on (example):");
  console.log(JSON.stringify(example, null, 2));
  return 0;
}

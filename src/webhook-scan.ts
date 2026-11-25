import fs from "node:fs";
import path from "node:path";

/**
 * Read-only scan of a Stripe webhook handler.
 * Findings are heuristics: every line says "possible" and names a gap the
 * source does not appear to close. The scan does not run the handler, write
 * to the tree, or use the network.
 */

export const FINDING_LINES = {
  signature:
    "possible missing signature check: this handler does not appear to verify the Stripe signature before it uses the event.",
  dedupe:
    "possible missing event-id dedupe: this handler does not appear to record the Stripe event id before it applies the event.",
  ordering:
    "possible missing ordering guard: this handler does not appear to drop an older event that arrives after a newer one.",
  status_on_create:
    "possible status ignored on create: customer.subscription.created appears to grant access without reading the subscription status.",
  recreate_deleted:
    "possible update recreates a deleted row: customer.subscription.updated appears to insert a row when the stored subscription is missing.",
} as const;

export type FindingKind = keyof typeof FINDING_LINES;

const KIND_ORDER: readonly FindingKind[] = [
  "signature",
  "dedupe",
  "ordering",
  "status_on_create",
  "recreate_deleted",
];

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "out",
  "vendor",
  ".astro",
]);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SOURCE_FILES = 2000;

const STRIPE_EVENT =
  /customer\.subscription\.|invoice\.paid|checkout\.session\.|charge\.refunded|charge\.dispute/;
const STRIPE_ENTRY = /constructEvent|stripe-signature|stripe\.webhooks/;

export type HandlerReport = { file: string; findings: FindingKind[] };

export type ScanReport =
  | { ok: true; handlers: HandlerReport[]; truncated: boolean }
  | { ok: false; reason: "not_found"; path: string };

type Neutral = { code: string; blank: string };

function fillRange(
  code: string[],
  blank: string[],
  source: string,
  from: number,
  to: number,
  keepInCode: boolean,
): void {
  const end = Math.min(to, source.length);
  for (let j = from; j < end; j += 1) {
    const ch = source[j] ?? " ";
    const space = ch === "\n" ? "\n" : " ";
    blank[j] = space;
    code[j] = keepInCode ? ch : space;
  }
}

/** Same-length views: comments removed in both; strings kept in code and blanked in blank. */
function neutralize(source: string): Neutral | undefined {
  const code = Array.from(source);
  const blank = Array.from(source);
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      fillRange(code, blank, source, start, i, false);
      continue;
    }
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      if (i < source.length) i += 2;
      fillRange(code, blank, source, start, i, false);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const start = i;
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      fillRange(code, blank, source, start, i, true);
      continue;
    }
    i += 1;
  }
  const codeText = code.join("");
  const blankText = blank.join("");
  if (codeText.length !== source.length || blankText.length !== source.length) return undefined;
  return { code: codeText, blank: blankText };
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function keywordAt(source: string, index: number, word: string): boolean {
  if (!source.startsWith(word, index)) return false;
  const prev = index > 0 ? (source[index - 1] ?? "") : " ";
  const next = source[index + word.length] ?? " ";
  return !/[A-Za-z0-9_$]/.test(prev) && !/[A-Za-z0-9_$]/.test(next);
}

type FnSpan = { name: string; start: number; end: number };

function extractFunctions(blank: string): FnSpan[] {
  const re =
    /(?:async\s+function\s+|function\s+)([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\(/g;
  const spans: FnSpan[] = [];
  for (const match of blank.matchAll(re)) {
    const name = match[1] ?? match[2];
    if (!name || match.index === undefined) continue;
    const parenOpen = match.index + match[0].length - 1;
    if (blank[parenOpen] !== "(") continue;
    const parenClose = matchingParen(blank, parenOpen);
    if (parenClose < 0) continue;
    let cursor = parenClose + 1;
    while (cursor < blank.length && blank[cursor] !== "{" && blank[cursor] !== ";") cursor += 1;
    if (blank[cursor] !== "{") continue;
    const end = matchingBrace(blank, cursor);
    if (end < 0) continue;
    spans.push({ name, start: cursor + 1, end });
  }
  return spans;
}

function switchCaseSpan(
  code: string,
  blank: string,
  eventName: string,
): { start: number; end: number } | undefined {
  const re = new RegExp(`case\\s+["']${eventName.replace(/[.]/g, "\\.")}["']`);
  const found = re.exec(code);
  if (!found || found.index === undefined) return undefined;
  const colon = code.indexOf(":", found.index + found[0].length);
  if (colon < 0) return undefined;
  let depth = 0;
  let i = colon + 1;
  const start = i;
  while (i < blank.length) {
    const ch = blank[i] ?? "";
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (keywordAt(blank, i, "case") || keywordAt(blank, i, "default"))) {
      break;
    }
    i += 1;
  }
  return { start, end: i };
}

function hasSignature(blank: string): boolean {
  if (/\bconstructEvent\s*\(/.test(blank)) return true;
  if (/\bverifyHeader\s*\(/.test(blank)) return true;
  if (/\bverify(?:Webhook|Stripe)?Signature\s*\(/.test(blank)) return true;
  if (/\btimingSafeEqual\s*\(/.test(blank) && /signature/.test(blank)) return true;
  return false;
}

function hasDedupe(blank: string): boolean {
  if (/\.has\(\s*event\.id\s*\)/.test(blank)) return true;
  if (/\.add\(\s*event\.id\s*\)/.test(blank)) return true;
  if (/\bevent_id\b/.test(blank)) return true;
  if (/\bstripeEventId\b/.test(blank)) return true;
  if (/\bprocessedEvents\b/.test(blank)) return true;
  if (/\bwebhook_events\b/.test(blank)) return true;
  if (/\bseen_events\b/.test(blank)) return true;
  if (/INSERT\s+OR\s+IGNORE/i.test(blank)) return true;
  if (/\bidempoten(?:cy|t)\b/i.test(blank)) return true;
  return false;
}

function hasOrdering(blank: string): boolean {
  if (/event\.created\s*<=?\s*[A-Za-z_]/.test(blank)) return true;
  if (/\.created\s*<\s*[A-Za-z_]/.test(blank)) return true;
  if (/\.created\s*>\s*[A-Za-z_]/.test(blank)) return true;
  if (/[<>]=?\s*event\.created\b/.test(blank)) return true;
  if (/\blastEventCreated\b\s*[<>]/.test(blank)) return true;
  if (/[<>]=?\s*\w*\.?lastEventCreated\b/.test(blank)) return true;
  return false;
}

function readsStatus(blankSlice: string): boolean {
  if (/\.status\b/.test(blankSlice)) return true;
  if (/\bstatus\s*===/.test(blankSlice)) return true;
  if (/\bstatus\s*!==/.test(blankSlice)) return true;
  if (/\bstatus\s*==(?!=)/.test(blankSlice)) return true;
  if (/\b(?:const|let|var)\s+status\b/.test(blankSlice)) return true;
  if (/\{\s*status\b/.test(blankSlice)) return true;
  if (/,\s*status\b/.test(blankSlice)) return true;
  return false;
}

function grantsHardcoded(codeSlice: string): boolean {
  if (/active\s*:\s*true\b/.test(codeSlice)) return true;
  if (/locked\s*:\s*false\b/.test(codeSlice)) return true;
  if (/status\s*:\s*["']active["']/.test(codeSlice)) return true;
  return false;
}

function isCreateName(name: string): boolean {
  return /Created$/.test(name);
}

function isUpdateName(name: string): boolean {
  return /Updated$/.test(name);
}

function statusIgnored(code: string, blank: string): boolean {
  const bodies: { code: string; blank: string }[] = [];
  for (const fn of extractFunctions(blank)) {
    if (!isCreateName(fn.name)) continue;
    bodies.push({ code: code.slice(fn.start, fn.end), blank: blank.slice(fn.start, fn.end) });
  }
  const created = switchCaseSpan(code, blank, "customer.subscription.created");
  if (created) {
    bodies.push({
      code: code.slice(created.start, created.end),
      blank: blank.slice(created.start, created.end),
    });
  }
  return bodies.some((body) => grantsHardcoded(body.code) && !readsStatus(body.blank));
}

function callsCreate(blankSlice: string): boolean {
  if (/\b[A-Za-z_][\w$]*Created\s*\(/.test(blankSlice)) return true;
  if (/\b(?:create|insert|upsert)[A-Za-z0-9_]*\s*\(/.test(blankSlice)) return true;
  return false;
}

function updateRecreates(code: string, blank: string): boolean {
  const slices: string[] = [];
  for (const fn of extractFunctions(blank)) {
    if (!isUpdateName(fn.name)) continue;
    slices.push(blank.slice(fn.start, fn.end));
  }
  const updated = switchCaseSpan(code, blank, "customer.subscription.updated");
  if (updated) slices.push(blank.slice(updated.start, updated.end));
  return slices.some((slice) => callsCreate(slice));
}

function analyze(parts: string[]): FindingKind[] {
  const neutral = parts.map(neutralize).filter((part): part is Neutral => part !== undefined);
  if (neutral.length === 0) return [];
  const code = neutral.map((part) => part.code).join("\n");
  const blank = neutral.map((part) => part.blank).join("\n");
  const findings: FindingKind[] = [];
  if (!hasSignature(blank)) findings.push("signature");
  if (!hasDedupe(blank)) findings.push("dedupe");
  if (!hasOrdering(blank)) findings.push("ordering");
  if (statusIgnored(code, blank)) findings.push("status_on_create");
  if (updateRecreates(code, blank)) findings.push("recreate_deleted");
  return findings;
}

function isHandler(displayPath: string, code: string): boolean {
  const posix = displayPath.split(path.sep).join("/");
  const events = STRIPE_EVENT.test(code);
  const entry = STRIPE_ENTRY.test(code);
  const webhookPath = /webhook/i.test(posix);
  if (!events) return false;
  return entry || webhookPath;
}

function isInside(rootReal: string, targetReal: string): boolean {
  const rel = path.relative(rootReal, targetReal);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function readText(file: string): string | undefined {
  let buf: Buffer;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined;
    buf = fs.readFileSync(file);
  } catch {
    return undefined;
  }
  if (buf.includes(0)) return undefined;
  return buf.toString("utf8");
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base];
  const hasExt = [...SOURCE_EXT].some((ext) => base.endsWith(ext));
  if (!hasExt) {
    for (const ext of SOURCE_EXT) candidates.push(`${base}${ext}`);
    for (const ext of SOURCE_EXT) candidates.push(path.join(base, `index${ext}`));
  }
  for (const candidate of candidates) {
    if (candidate.endsWith(".d.ts")) continue;
    try {
      const st = fs.statSync(candidate);
      if (st.isFile() && st.size <= MAX_FILE_BYTES) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

function relativeImports(filePath: string, rootReal: string, source: string): string[] {
  const neutral = neutralize(source);
  if (!neutral) return [];
  const texts: string[] = [];
  const seen = new Set<string>();
  const re = /(?:from\s+|require\(\s*)["'](\.[^"']+)["']/g;
  for (const match of neutral.code.matchAll(re)) {
    const spec = match[1];
    if (!spec) continue;
    const resolved = resolveImport(filePath, spec);
    if (!resolved) continue;
    let real: string;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      continue;
    }
    if (!isInside(rootReal, real) || seen.has(real)) continue;
    seen.add(real);
    const text = readText(real);
    if (text !== undefined) texts.push(text);
  }
  return texts;
}

type Listed = { read: string; display: string };

function consider(
  readFull: string,
  displayFull: string,
  acc: Listed[],
  truncated: { value: boolean },
  seenFiles: Set<string>,
): void {
  if (acc.length >= MAX_SOURCE_FILES) {
    truncated.value = true;
    return;
  }
  const base = path.basename(displayFull);
  if (base.endsWith(".d.ts")) return;
  if (!SOURCE_EXT.has(path.extname(base))) return;
  let real: string;
  try {
    real = fs.realpathSync(readFull);
  } catch {
    return;
  }
  if (seenFiles.has(real)) return;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return;
  seenFiles.add(real);
  acc.push({ read: real, display: displayFull });
}

function walk(
  dir: string,
  rootReal: string,
  acc: Listed[],
  truncated: { value: boolean },
  seenDirs: Set<string>,
  seenFiles: Set<string>,
): void {
  if (truncated.value) return;
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return;
  }
  if (!isInside(rootReal, realDir) || seenDirs.has(realDir)) return;
  seenDirs.add(realDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(realDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (truncated.value) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(realDir, entry.name);
    if (entry.isSymbolicLink()) {
      let real: string;
      try {
        real = fs.realpathSync(full);
      } catch {
        continue;
      }
      if (!isInside(rootReal, real)) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(real);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(real, rootReal, acc, truncated, seenDirs, seenFiles);
      else if (st.isFile()) consider(real, full, acc, truncated, seenFiles);
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, rootReal, acc, truncated, seenDirs, seenFiles);
      continue;
    }
    if (entry.isFile()) consider(full, full, acc, truncated, seenFiles);
  }
}

function relPosix(root: string, file: string): string {
  const rel = path.relative(root, file);
  const posix = rel.split(path.sep).join("/");
  return posix === "" ? path.basename(file) : posix;
}

export function scanWebhookTree(rootInput: string): ScanReport {
  const resolved = path.resolve(rootInput);
  if (!fs.existsSync(resolved)) return { ok: false, reason: "not_found", path: resolved };
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: "not_found", path: resolved };
  }
  const files: Listed[] = [];
  const truncated = { value: false };
  let displayRoot = resolved;
  if (rootStat.isDirectory()) {
    displayRoot = resolved;
    let rootReal: string;
    try {
      rootReal = fs.realpathSync(resolved);
    } catch {
      return { ok: false, reason: "not_found", path: resolved };
    }
    walk(resolved, rootReal, files, truncated, new Set(), new Set());
  } else if (rootStat.isFile()) {
    displayRoot = path.dirname(resolved);
    consider(resolved, resolved, files, truncated, new Set());
  } else {
    return { ok: false, reason: "not_found", path: resolved };
  }

  files.sort((a, b) => a.display.localeCompare(b.display));
  const handlers: HandlerReport[] = [];
  let rootReal = displayRoot;
  try {
    rootReal = fs.realpathSync(rootStat.isDirectory() ? resolved : displayRoot);
  } catch {
    rootReal = displayRoot;
  }
  for (const file of files) {
    const text = readText(file.read);
    if (text === undefined) continue;
    const rel = relPosix(displayRoot, file.display);
    const neutral = neutralize(text);
    if (!neutral || !isHandler(rel, neutral.code)) continue;
    const imports = relativeImports(file.read, rootReal, text);
    const findings = analyze([text, ...imports]).filter((kind) =>
      (KIND_ORDER as readonly string[]).includes(kind),
    );
    handlers.push({ file: rel, findings });
  }
  return { ok: true, handlers, truncated: truncated.value };
}

export function formatReport(report: Extract<ScanReport, { ok: true }>, displayPath: string): string {
  const lines: string[] = [];
  if (report.handlers.length === 0) {
    lines.push(`gatefit check-my-webhook: no Stripe webhook handler found under ${displayPath}`);
  } else {
    for (const handler of report.handlers) {
      lines.push(`gatefit check-my-webhook: ${handler.file}`);
      for (const kind of handler.findings) lines.push(lineFor(kind));
    }
  }
  if (report.truncated) {
    lines.push(`gatefit check-my-webhook: stopped after ${MAX_SOURCE_FILES} source files`);
  }
  return lines.join("\n");
}

function lineFor(kind: FindingKind): string {
  switch (kind) {
    case "signature":
    case "dedupe":
    case "ordering":
    case "status_on_create":
    case "recreate_deleted":
      return FINDING_LINES[kind];
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

export function scanExitCode(report: ScanReport): number {
  if (!report.ok) return 1;
  if (report.handlers.length === 0) return 1;
  if (report.handlers.some((handler) => handler.findings.length > 0)) return 1;
  return 0;
}

import fs from "node:fs";
import path from "node:path";

/**
 * Pro pack registry. Chaos mode and provider packs register here and run only after
 * the license gate. The stub has no runner and is not a user-facing feature.
 */
export type ProPack = {
  id: string;
  /** `files` is set when a licensed `--suite <path>` points into the pack's golden directory. */
  run?: (ctx: { adapterPath: string; seed: string; files?: string[] }) => Promise<number>;
  /** Golden directory owned by the pack. Free `run --suite <path>` into it is gated too. */
  goldenDir?: string;
};

const proPacks = new Map<string, ProPack>();

export function registerProPack(pack: ProPack): void {
  if (!pack.id || proPacks.has(pack.id)) {
    throw new Error(`pro pack id is missing or already registered: ${pack.id}`);
  }
  proPacks.set(pack.id, pack);
}

export function getProPack(id: string): ProPack | undefined {
  return proPacks.get(id);
}

export function isProPack(id: string): boolean {
  return proPacks.has(id);
}

function realpath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

function packOf(file: string): ProPack | undefined {
  for (const pack of proPacks.values()) {
    if (!pack.goldenDir) continue;
    const rel = path.relative(realpath(pack.goldenDir), realpath(file));
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return pack;
  }
  return undefined;
}

/** The registered pack whose golden directory contains any of these files. */
export function proPackOwning(files: string[]): ProPack | undefined {
  for (const file of files) {
    const pack = packOf(file);
    if (pack) return pack;
  }
  return undefined;
}

/** True when the files are not all owned by one pack, nor all free. */
export function mixesPackAndFree(files: string[]): boolean {
  const owners = new Set(files.map(packOf));
  return owners.size > 1;
}

registerProPack({ id: "pro-stub" });

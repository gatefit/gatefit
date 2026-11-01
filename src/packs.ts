import fs from "node:fs";
import path from "node:path";

/**
 * Pro pack registry. Chaos mode and provider packs register here and run only after
 * the license gate. The stub has no runner and is not a user-facing feature.
 */
export type ProPack = {
  id: string;
  run?: (ctx: { adapterPath: string; seed: string }) => Promise<number>;
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

/** The registered pack whose golden directory contains any of these files. */
export function proPackOwning(files: string[]): ProPack | undefined {
  for (const pack of proPacks.values()) {
    if (!pack.goldenDir) continue;
    const dir = realpath(pack.goldenDir);
    for (const file of files) {
      const rel = path.relative(dir, realpath(file));
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return pack;
    }
  }
  return undefined;
}

registerProPack({ id: "pro-stub" });

/**
 * Pro pack registry. H17 plugs chaos mode in by calling `registerProPack`
 * with a `run` function. The stub has no runner and is not a user-facing feature.
 */
export type ProPack = {
  id: string;
  run?: (ctx: { adapterPath: string }) => Promise<number>;
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

registerProPack({ id: "pro-stub" });

import fs from "node:fs";
import path from "node:path";
import { assertNoLiveSecret, loadAdapter } from "./access-adapter.ts";
import { listGoldens, loadGolden, runGolden } from "./fixture-driver.ts";
import { registerProPack } from "./packs.ts";
import { packageRoot, resolveUserOrPackage } from "./paths.ts";

/**
 * Polar public v1 webhook event names (order.*, subscription.*, benefit_grant.*,
 * refund.*, checkout.*). Polar has no dated API versions, so the pin is v1 plus a
 * fixture revision: fixtures.N goes up whenever a Polar golden changes meaning.
 */
export const POLAR_SCHEMA = "v1+fixtures.1";

export function polarGoldenDir(): string {
  return path.join(packageRoot(), "src/packs/polar/goldens");
}

export async function runPolar(
  adapterPath: string,
  files: string[] = listGoldens(polarGoldenDir()),
): Promise<number> {
  console.error(`gatefit polar: schema ${POLAR_SCHEMA}`);
  if (process.env.GATEFIT_LIVE_CLOCK) {
    console.error("gatefit polar: refuses GATEFIT_LIVE_CLOCK; fixture order only");
    return 1;
  }
  const resolved = resolveUserOrPackage(adapterPath);
  try {
    assertNoLiveSecret(fs.readFileSync(resolved, "utf8"));
    assertNoLiveSecret(JSON.stringify(process.env));
  } catch (err) {
    console.error(`gatefit polar: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const adapter = await loadAdapter(resolved);
  if (typeof adapter.reset !== "function") {
    console.error("gatefit polar: adapter.reset is required");
    return 1;
  }
  let failed = 0;
  for (const file of files) {
    const golden = loadGolden(file);
    const result = await runGolden(adapter, golden);
    if (result.ok) {
      console.error(`gatefit: PASS polar ${golden.id}`);
      continue;
    }
    failed += 1;
    console.error(`gatefit: FAIL polar ${golden.id}`);
    for (const step of result.results.filter((s) => !s.ok)) {
      console.error(`  step ${step.stepIndex}: ${step.mismatches.join("; ")}`);
    }
  }
  console.error(failed === 0 ? "gatefit: PASS polar" : "gatefit: FAIL polar");
  return failed === 0 ? 0 : 1;
}

registerProPack({
  id: "polar",
  goldenDir: polarGoldenDir(),
  run({ adapterPath, files }) {
    return runPolar(adapterPath, files);
  },
});

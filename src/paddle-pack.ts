import fs from "node:fs";
import path from "node:path";
import { assertNoLiveSecret, loadAdapter } from "./access-adapter.ts";
import { listGoldens, loadGolden, runGolden } from "./fixture-driver.ts";
import { registerProPack } from "./packs.ts";
import { packageRoot, resolveUserOrPackage } from "./paths.ts";

/**
 * Paddle Billing v1 webhook event names (transaction.*, subscription.*, adjustment.*).
 * Paddle notifications carry no dated version, so the pin is v1 plus a fixture
 * revision: fixtures.N goes up whenever a Paddle golden changes meaning.
 */
export const PADDLE_SCHEMA = "v1+fixtures.1";

export function paddleGoldenDir(): string {
  return path.join(packageRoot(), "src/packs/paddle/goldens");
}

export async function runPaddle(
  adapterPath: string,
  files: string[] = listGoldens(paddleGoldenDir()),
): Promise<number> {
  console.error(`gatefit paddle: schema ${PADDLE_SCHEMA}`);
  if (process.env.GATEFIT_LIVE_CLOCK) {
    console.error("gatefit paddle: refuses GATEFIT_LIVE_CLOCK; fixture order only");
    return 1;
  }
  const resolved = resolveUserOrPackage(adapterPath);
  try {
    assertNoLiveSecret(fs.readFileSync(resolved, "utf8"));
    assertNoLiveSecret(JSON.stringify(process.env));
  } catch (err) {
    console.error(`gatefit paddle: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const adapter = await loadAdapter(resolved);
  if (typeof adapter.reset !== "function") {
    console.error("gatefit paddle: adapter.reset is required");
    return 1;
  }
  let failed = 0;
  for (const file of files) {
    const golden = loadGolden(file);
    const result = await runGolden(adapter, golden);
    if (result.ok) {
      console.error(`gatefit: PASS paddle ${golden.id}`);
      continue;
    }
    failed += 1;
    console.error(`gatefit: FAIL paddle ${golden.id}`);
    for (const step of result.results.filter((s) => !s.ok)) {
      console.error(`  step ${step.stepIndex}: ${step.mismatches.join("; ")}`);
    }
  }
  console.error(failed === 0 ? "gatefit: PASS paddle" : "gatefit: FAIL paddle");
  return failed === 0 ? 0 : 1;
}

registerProPack({
  id: "paddle",
  goldenDir: paddleGoldenDir(),
  run({ adapterPath, files }) {
    return runPaddle(adapterPath, files);
  },
});

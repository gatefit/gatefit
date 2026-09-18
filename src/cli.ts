import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadAdapter } from "./access-adapter.ts";
import { listGoldens, loadGolden, requireReset, runGolden } from "./fixture-driver.ts";

const GOLDEN_DIR = "tests/entitlements/goldens";
const S1 = path.join(GOLDEN_DIR, "paid_grants_access.yaml");
const NAIVE = "src/adapters/naive.ts";
const HARDENED = "src/adapters/hardened.ts";

function usage(): string {
  return [
    "Usage:",
    "  gatefit run --suite <dir|file|id> --adapter <path>",
    "  gatefit adapter-check",
  ].join("\n");
}

function resolveSuiteFiles(suite: string): string[] {
  if (fs.existsSync(suite)) return listGoldens(suite);
  const byId = path.join(GOLDEN_DIR, `${suite}.yaml`);
  if (fs.existsSync(byId)) return [byId];
  throw new Error(`suite not found: ${suite}`);
}

async function cmdRun(suite: string, adapterPath: string): Promise<number> {
  const adapter = await loadAdapter(adapterPath);
  const files = resolveSuiteFiles(suite);
  requireReset(adapter, files.length);
  let failed = 0;
  for (const file of files) {
    const golden = loadGolden(file);
    const result = await runGolden(adapter, golden);
    if (result.ok) {
      console.error(`gatefit: PASS ${golden.id}`);
    } else {
      failed += 1;
      console.error(`gatefit: FAIL ${golden.id}`);
      for (const step of result.results.filter((s) => !s.ok)) {
        console.error(`  step ${step.stepIndex}: ${step.mismatches.join("; ")}`);
      }
    }
  }
  return failed === 0 ? 0 : 1;
}

async function cmdAdapterCheck(): Promise<number> {
  const suite = loadGolden(S1);
  const naive = await runGolden(await loadAdapter(NAIVE), suite);
  const hardened = await runGolden(await loadAdapter(HARDENED), suite);
  const naiveFailed = !naive.ok;
  const hardenedPassed = hardened.ok;
  if (naiveFailed) console.error("gatefit adapter-check: naive failed S1 (expected)");
  else console.error("gatefit adapter-check: naive unexpectedly passed S1");
  if (hardenedPassed) console.error("gatefit adapter-check: hardened passed S1 (expected)");
  else console.error("gatefit adapter-check: hardened failed S1");
  return naiveFailed && hardenedPassed ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command === "adapter-check") {
    return cmdAdapterCheck();
  }
  if (command === "run") {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        suite: { type: "string" },
        adapter: { type: "string" },
      },
    });
    if (!values.suite || !values.adapter) {
      console.error(usage());
      return 1;
    }
    return cmdRun(values.suite, values.adapter);
  }
  console.error(usage());
  return 1;
}

try {
  const code = await main(process.argv.slice(2));
  process.exit(code);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

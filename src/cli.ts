import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadAdapter } from "./access-adapter.ts";
import { listGoldens, loadGolden, requireReset, runGolden } from "./fixture-driver.ts";
import { goldenDir, packageRoot, readPackageVersion, resolveUserOrPackage, userCwd } from "./paths.ts";

const S1 = () => path.join(goldenDir(), "paid_grants_access.yaml");
const NAIVE = () => path.join(packageRoot(), "src/adapters/naive.ts");
const HARDENED = () => path.join(packageRoot(), "src/adapters/hardened.ts");

function usage(): string {
  return [
    "Usage:",
    "  gatefit run --suite <dir|file|id> --adapter <path>",
    "  gatefit adapter-check",
    "  gatefit --version",
  ].join("\n");
}

function resolveSuiteFiles(suite: string): string[] {
  const candidates = [
    path.resolve(userCwd(), suite),
    path.resolve(packageRoot(), suite),
    path.join(goldenDir(), `${suite}.yaml`),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const files = listGoldens(candidate);
    if (files.length > 0) return files;
  }
  throw new Error(`suite not found: ${suite}`);
}

async function cmdRun(suite: string, adapterPath: string): Promise<number> {
  const adapter = await loadAdapter(resolveUserOrPackage(adapterPath));
  const files = resolveSuiteFiles(suite);
  if (files.length === 0) {
    throw new Error(`suite not found: ${suite}`);
  }
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
  const suite = loadGolden(S1());
  const naive = await runGolden(await loadAdapter(NAIVE()), suite);
  const hardened = await runGolden(await loadAdapter(HARDENED()), suite);
  const naiveFailed = !naive.ok;
  const hardenedPassed = hardened.ok;
  if (naiveFailed) console.error("gatefit adapter-check: naive failed S1 (expected)");
  else console.error("gatefit adapter-check: naive unexpectedly passed S1");
  if (hardenedPassed) console.error("gatefit adapter-check: hardened passed S1 (expected)");
  else console.error("gatefit adapter-check: hardened failed S1");
  return naiveFailed && hardenedPassed ? 0 : 1;
}

function isVersionFlag(arg: string | undefined): boolean {
  return arg === "--version" || arg === "-v";
}

async function main(argv: string[]): Promise<number> {
  if (isVersionFlag(argv[0])) {
    console.log(`gatefit ${readPackageVersion()}`);
    return 0;
  }
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

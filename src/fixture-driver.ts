import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type AccessAdapter,
  type AccessSnapshot,
  type BillingEvent,
  compareAccess,
} from "./access-adapter.ts";

export type GoldenStep = {
  event: BillingEvent;
  expect: AccessSnapshot;
};

export type GoldenSuite = {
  id: string;
  subject: string;
  steps: GoldenStep[];
};

export type StepResult = {
  stepIndex: number;
  ok: boolean;
  expected: AccessSnapshot;
  actual: AccessSnapshot;
  mismatches: string[];
};

export function loadGolden(filePath: string): GoldenSuite {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = parseYaml(raw) as GoldenSuite;
  if (!data?.id || !data.subject || !Array.isArray(data.steps)) {
    throw new Error(`invalid golden: ${filePath}`);
  }
  return data;
}

export function listGoldens(suitePath: string): string[] {
  const resolved = path.resolve(suitePath);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(resolved)
      .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
      .map((name) => path.join(resolved, name))
      .sort();
  }
  return [resolved];
}

export async function runGolden(
  adapter: AccessAdapter,
  suite: GoldenSuite,
): Promise<{
  ok: boolean;
  results: StepResult[];
}> {
  if (process.env.GATEFIT_LIVE_CLOCK) {
    throw new Error("fixture-first driver refuses GATEFIT_LIVE_CLOCK; use YAML step order only");
  }
  if (adapter.reset) await adapter.reset();
  const results: StepResult[] = [];
  for (let i = 0; i < suite.steps.length; i += 1) {
    const step = suite.steps[i]!;
    await adapter.apply(step.event);
    const actual = await adapter.snapshot(step.event.customerId ?? suite.subject);
    const cmp = compareAccess(actual, step.expect);
    results.push({
      stepIndex: i,
      ok: cmp.ok,
      expected: step.expect,
      actual,
      mismatches: cmp.mismatches,
    });
  }
  return { ok: results.every((r) => r.ok), results };
}

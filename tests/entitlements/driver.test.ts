import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AccessAdapter, AccessSnapshot, BillingEvent } from "../../src/access-adapter.ts";
import { loadGolden, requireReset, runGolden } from "../../src/fixture-driver.ts";

function memoryAdapter(): AccessAdapter {
  const rows = new Map<string, AccessSnapshot>();
  return {
    async apply(event: BillingEvent) {
      if (event.type === "invoice.paid") {
        rows.set(event.customerId, { locked: false, plan: event.plan });
      }
    },
    async snapshot(customerId: string) {
      return rows.get(customerId) ?? { locked: true };
    },
    reset() {
      rows.clear();
    },
  };
}

test("loadGolden reads YAML steps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-"));
  const file = path.join(dir, "s1.yaml");
  fs.writeFileSync(
    file,
    [
      "id: paid_grants_access",
      "subject: cus_s1",
      "steps:",
      "  - event:",
      "      id: evt_1",
      "      type: invoice.paid",
      "      customerId: cus_s1",
      "      plan: pro",
      "    expect:",
      "      locked: false",
      "      plan: pro",
      "",
    ].join("\n"),
  );
  const suite = loadGolden(file);
  assert.equal(suite.id, "paid_grants_access");
  assert.equal(suite.steps.length, 1);
  assert.equal(suite.steps[0]?.event.type, "invoice.paid");
});

test("runGolden applies events then compares declared expect fields", async () => {
  const adapter = memoryAdapter();
  const result = await runGolden(adapter, {
    id: "paid_grants_access",
    subject: "cus_s1",
    steps: [
      {
        event: { id: "evt_1", type: "invoice.paid", customerId: "cus_s1", plan: "pro" },
        expect: { locked: false, plan: "pro" },
      },
    ],
  });
  assert.equal(result.ok, true);
});

test("loadGolden rejects empty steps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatefit-"));
  const file = path.join(dir, "empty.yaml");
  fs.writeFileSync(file, "id: empty\nsubject: cus\nsteps: []\n");
  assert.throws(() => loadGolden(file), /steps/);
});

test("requireReset fails directory runs when adapter has no reset", () => {
  const adapter: AccessAdapter = {
    apply() {},
    snapshot() {
      return { locked: true };
    },
  };
  assert.throws(() => requireReset(adapter, 2), /reset/);
  assert.doesNotThrow(() => requireReset(adapter, 1));
  assert.doesNotThrow(() => requireReset({ ...adapter, reset() {} }, 2));
});

test("runGolden refuses GATEFIT_LIVE_CLOCK", async () => {
  const prev = process.env.GATEFIT_LIVE_CLOCK;
  process.env.GATEFIT_LIVE_CLOCK = "1";
  try {
    await assert.rejects(
      () =>
        runGolden(memoryAdapter(), {
          id: "x",
          subject: "cus",
          steps: [],
        }),
      /GATEFIT_LIVE_CLOCK/,
    );
  } finally {
    if (prev === undefined) delete process.env.GATEFIT_LIVE_CLOCK;
    else process.env.GATEFIT_LIVE_CLOCK = prev;
  }
});

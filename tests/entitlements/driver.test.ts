import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AccessAdapter, AccessSnapshot, BillingEvent } from "../../src/access-adapter.ts";
import { loadGolden, requireReset, runGolden } from "../../src/fixture-driver.ts";
import { LIVE_SCENARIO_IDS } from "../../src/live-scenarios.ts";
import { STRIPE_API_VERSION } from "../../src/stripe-clock.ts";

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

test("CAPE golden uses fixture period_end, not wall clock", () => {
  const driverSrc = fs.readFileSync(
    path.join(import.meta.dirname, "../../src/fixture-driver.ts"),
    "utf8",
  );
  assert.doesNotMatch(driverSrc, /Date\.now/);
  const suite = loadGolden(
    path.join(import.meta.dirname, "goldens/cancel_at_period_end_keeps_access_until_end.yaml"),
  );
  assert.equal(suite.steps[1]?.event.period_end, 1_577_923_200);
  assert.equal(suite.steps[1]?.event.now, 1_577_836_800);
  assert.equal(suite.steps[2]?.event.now, 1_577_923_200);
});

test("H7 goldens are fixture-first dispute/unpaid (no wall clock, no HTTP 200 grant)", () => {
  const driverSrc = fs.readFileSync(
    path.join(import.meta.dirname, "../../src/fixture-driver.ts"),
    "utf8",
  );
  assert.doesNotMatch(driverSrc, /Date\.now/);
  const dispute = loadGolden(
    path.join(import.meta.dirname, "goldens/dispute_revokes_or_flags.yaml"),
  );
  assert.equal(dispute.id, "dispute_revokes_or_flags");
  assert.equal(dispute.steps[1]?.event.type, "charge.dispute.created");
  assert.equal(dispute.steps[1]?.expect.locked, true);
  assert.deepEqual(dispute.steps[1]?.expect.features, []);
  assert.equal(dispute.steps[1]?.event.httpStatus, undefined);
  const unpaid = loadGolden(
    path.join(import.meta.dirname, "goldens/unpaid_after_retries_revokes.yaml"),
  );
  assert.equal(unpaid.steps[1]?.event.status, "past_due");
  assert.equal(unpaid.steps[2]?.event.status, "unpaid");
  assert.equal(unpaid.steps[3]?.event.type, "customer.subscription.deleted");
  assert.equal(unpaid.steps[2]?.expect.locked, true);
});

test("S7–S9 goldens pin the Stripe API version and stay fixture-only", () => {
  assert.equal(STRIPE_API_VERSION, "2025-10-29.clover");
  const names = [
    "trial_no_card.yaml",
    "portal_downgrade_period_end_vs_immediate.yaml",
    "entitlements_active_summary.yaml",
  ];
  for (const name of names) {
    const file = path.join(import.meta.dirname, "goldens", name);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, new RegExp(STRIPE_API_VERSION.replace(/\./g, "\\.")));
    assert.doesNotMatch(raw, /sk_live/);
    const suite = loadGolden(file);
    assert.equal(LIVE_SCENARIO_IDS.includes(suite.id as (typeof LIVE_SCENARIO_IDS)[number]), false);
    for (const step of suite.steps) {
      assert.notEqual(step.expect.locked, undefined);
      assert.equal(step.event.stripeHttpStatus, undefined);
    }
  }
  const trial = loadGolden(path.join(import.meta.dirname, "goldens/trial_no_card.yaml"));
  assert.equal(trial.steps[1]?.event.type, "customer.subscription.trial_will_end");
  assert.equal(trial.steps[1]?.event.httpStatus, 200);
  assert.equal(trial.steps[1]?.expect.locked, true);
  assert.equal(trial.steps[2]?.event.type, "invoice.payment_failed");
  assert.equal(trial.steps[3]?.event.status, "paused");
  assert.equal(trial.steps[4]?.event.type, "customer.subscription.deleted");
  assert.equal(trial.steps[6]?.event.type, "customer.subscription.trial_will_end");
  assert.equal(trial.steps[6]?.expect.locked, false);
  const portal = loadGolden(
    path.join(import.meta.dirname, "goldens/portal_downgrade_period_end_vs_immediate.yaml"),
  );
  assert.equal(portal.steps[1]?.event.now, 1_577_836_800);
  assert.equal(portal.steps[1]?.event.period_end, 1_577_923_200);
  assert.equal(portal.steps[1]?.event.pending_plan, "starter");
  assert.equal(portal.steps[1]?.expect.plan, "pro");
  assert.equal(portal.steps[2]?.event.now, 1_577_923_199);
  assert.equal(portal.steps[2]?.expect.plan, "pro");
  assert.equal(portal.steps[3]?.event.now, 1_577_923_200);
  assert.equal(portal.steps[3]?.expect.plan, "starter");
  assert.equal(portal.steps[5]?.event.downgrade_at_period_end, undefined);
  assert.equal(portal.steps[5]?.expect.plan, "starter");
  assert.ok((portal.steps[5]?.event.now ?? 0) < (portal.steps[5]?.event.period_end ?? 0));
  const summary = loadGolden(
    path.join(import.meta.dirname, "goldens/entitlements_active_summary.yaml"),
  );
  assert.equal(summary.steps[0]?.event.type, "entitlements.active_entitlement_summary.updated");
  assert.equal(summary.steps[0]?.event.httpStatus, 200);
  assert.equal(summary.steps[0]?.expect.locked, true);
  assert.deepEqual(summary.steps[0]?.expect.features, ["priority"]);
  assert.deepEqual(summary.steps[2]?.expect.features, ["priority", "exports"]);
  assert.deepEqual(summary.steps[3]?.expect.features, []);
  assert.equal(summary.steps[3]?.expect.locked, false);
});

test("S10–S12 goldens pin the Stripe API version and stay fixture-only", () => {
  const names = [
    "trial_end_pause_resume_waits_for_paid.yaml",
    "smart_retries_unpaid_then_paid_recovers.yaml",
    "pause_collection_void_locks_draft_keeps.yaml",
  ];
  for (const name of names) {
    const file = path.join(import.meta.dirname, "goldens", name);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, new RegExp(STRIPE_API_VERSION.replace(/\./g, "\\.")));
    assert.match(raw, /HTTP 200 is not access/);
    assert.match(raw, /Assumed policy/);
    assert.doesNotMatch(raw, /sk_live/);
    const suite = loadGolden(file);
    assert.equal(LIVE_SCENARIO_IDS.includes(suite.id as (typeof LIVE_SCENARIO_IDS)[number]), false);
    assert.ok(suite.steps.some((step) => step.event.httpStatus === 200 && step.expect.locked === true));
    for (const step of suite.steps) {
      assert.notEqual(step.expect.locked, undefined);
      assert.equal(step.event.stripeHttpStatus, undefined);
      assert.equal(step.event.created, undefined);
    }
  }
  const resume = loadGolden(
    path.join(import.meta.dirname, "goldens/trial_end_pause_resume_waits_for_paid.yaml"),
  );
  assert.equal(resume.steps[0]?.event.status, "trialing");
  assert.equal(resume.steps[1]?.event.type, "customer.subscription.paused");
  assert.equal(resume.steps[1]?.expect.locked, true);
  assert.equal(resume.steps[2]?.event.type, "customer.subscription.resumed");
  assert.equal(resume.steps[2]?.event.status, "active");
  assert.equal(resume.steps[2]?.event.httpStatus, 200);
  assert.equal(resume.steps[2]?.expect.locked, true);
  assert.equal(resume.steps[3]?.event.type, "invoice.payment_failed");
  assert.equal(resume.steps[3]?.expect.locked, true);
  assert.equal(resume.steps[4]?.event.type, "invoice.paid");
  assert.equal(resume.steps[4]?.expect.locked, false);
  assert.equal(resume.steps[5]?.event.id, resume.steps[2]?.event.id);
  assert.equal(resume.steps[5]?.expect.locked, false);
  const retries = loadGolden(
    path.join(import.meta.dirname, "goldens/smart_retries_unpaid_then_paid_recovers.yaml"),
  );
  assert.equal(retries.steps[0]?.event.type, "invoice.paid");
  const failed = retries.steps.slice(1, 4);
  assert.equal(new Set(failed.map((step) => step.event.id)).size, 3);
  for (const step of failed) {
    assert.equal(step.event.type, "invoice.payment_failed");
    assert.equal(step.expect.locked, true);
  }
  assert.equal(failed.filter((step) => step.event.httpStatus === 200).length, 1);
  assert.equal(retries.steps[4]?.event.status, "unpaid");
  assert.equal(retries.steps[4]?.expect.locked, true);
  assert.equal(retries.steps[4]?.expect.plan, "pro");
  assert.equal(retries.steps[5]?.event.type, "invoice.paid");
  assert.equal(retries.steps[5]?.expect.locked, false);
  assert.equal(retries.steps[6]?.event.id, retries.steps[3]?.event.id);
  assert.equal(retries.steps[6]?.expect.locked, false);
  const pause = loadGolden(
    path.join(import.meta.dirname, "goldens/pause_collection_void_locks_draft_keeps.yaml"),
  );
  assert.equal(pause.steps[0]?.event.type, "invoice.paid");
  assert.equal(pause.steps[1]?.event.pause_collection_behavior, "keep_as_draft");
  assert.equal(pause.steps[1]?.expect.locked, false);
  assert.equal(pause.steps[2]?.event.pause_collection_behavior, "mark_uncollectible");
  assert.equal(pause.steps[2]?.expect.locked, false);
  assert.equal(pause.steps[3]?.event.type, "invoice.marked_uncollectible");
  assert.equal(pause.steps[3]?.event.pause_collection_behavior, "mark_uncollectible");
  assert.equal(pause.steps[3]?.expect.locked, false);
  assert.equal(pause.steps[4]?.event.pause_collection_behavior, "void");
  assert.equal(pause.steps[4]?.event.httpStatus, 200);
  assert.equal(pause.steps[4]?.expect.locked, true);
  assert.equal(pause.steps[5]?.event.pause_collection_behavior, null);
  assert.equal(pause.steps[5]?.event.httpStatus, 200);
  assert.equal(pause.steps[5]?.expect.locked, true);
  assert.equal(pause.steps[6]?.event.type, "invoice.paid");
  assert.equal(pause.steps[6]?.expect.locked, false);
  assert.equal(pause.steps[7]?.event.type, "invoice.marked_uncollectible");
  assert.equal(pause.steps[7]?.event.pause_collection_behavior, undefined);
  assert.equal(pause.steps[7]?.expect.locked, true);
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

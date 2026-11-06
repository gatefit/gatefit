import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import {
  CATEGORIES,
  GOLDEN_LABELS,
  OUTCOMES,
  groupStripeGoldens,
  labelWordCount,
} from "../../site/src/lib/goldenLabels.ts";
import { loadStripeGoldens } from "../../site/src/lib/stripeGoldens.ts";

const root = path.join(import.meta.dirname, "../..");
const BANNED = [
  /coming soon/i,
  /fixture goldens/i,
  /names match the goldens/i,
  /docs live at/i,
  /checkout is live/i,
  /\$19/,
  /monthly/i,
  /optional updates/i,
];

test("label word count ignores the arrow and edge punctuation", () => {
  assert.equal(labelWordCount("Refund → access revoked"), 3);
  assert.equal(labelWordCount("Dispute → locked"), 2);
  assert.equal(labelWordCount("Trial ends unpaid → locked"), 4);
  assert.equal(labelWordCount("Upgrade, then locked"), 3);
  assert.equal(labelWordCount("No-card trial locked"), 3);
});

test("every stripe golden has one label, and every label is a golden", () => {
  const goldens = loadStripeGoldens();
  const ids = goldens.map((item) => item.id).sort();
  assert.deepEqual(Object.keys(GOLDEN_LABELS).sort(), ids);
  const groups = groupStripeGoldens(goldens);
  assert.equal(groups.total, goldens.length);
  assert.equal(
    groups.categories.reduce((sum, category) => sum + category.items.length, 0),
    goldens.length,
  );
  const shown = groups.categories.flatMap((category) => category.items.map((item) => item.id)).sort();
  assert.deepEqual(shown, ids);
  assert.deepEqual(
    groups.categories.map((category) => category.id),
    CATEGORIES.map((category) => category.id),
  );
});

test("a new golden cannot ship without a label, and a stale label cannot linger", () => {
  const goldens = loadStripeGoldens();
  assert.throws(
    () => groupStripeGoldens([...goldens, { id: "new_golden_without_label", pack: "S13", n: 13 }]),
    /new_golden_without_label/,
  );
  assert.throws(
    () => groupStripeGoldens(goldens.filter((item) => item.id !== "refund_revokes_access")),
    /refund_revokes_access/,
  );
});

test("labels are 2-4 plain words with an access pill and a known category", () => {
  const categories = new Set(CATEGORIES.map((category) => category.id));
  for (const [id, copy] of Object.entries(GOLDEN_LABELS)) {
    const words = labelWordCount(copy.label);
    assert.ok(words >= 2 && words <= 4, `${id} label ${JSON.stringify(copy.label)} has ${words} words`);
    assert.doesNotMatch(copy.label, /_/, `${id} label is plain language`);
    assert.notEqual(copy.label, id);
    assert.ok(copy.outcome in OUTCOMES, id);
    assert.ok(categories.has(copy.category), id);
    assert.match(OUTCOMES[copy.outcome].pill, /^(Access kept|Access revoked|Locked|Locks at period end)$/);
    if (copy.detail !== undefined) {
      assert.equal(copy.detail.trim(), copy.detail, id);
      assert.ok(copy.detail.length > 0 && copy.detail.length <= 140, `${id} detail length ${copy.detail.length}`);
      assert.doesNotMatch(copy.detail, /\n/, id);
    }
    for (const banned of BANNED) {
      assert.doesNotMatch(copy.label, banned, id);
      if (copy.detail) assert.doesNotMatch(copy.detail, banned, id);
    }
  }
  for (const category of CATEGORIES) {
    assert.ok(category.title.length > 0);
    assert.doesNotMatch(category.title, /_/);
    for (const banned of BANNED) assert.doesNotMatch(category.title, banned);
  }
  assert.deepEqual(
    Object.values(OUTCOMES).map((outcome) => outcome.pill).sort(),
    ["Access kept", "Access revoked", "Locked", "Locks at period end"],
  );
});

type GoldenStep = {
  event?: {
    type?: string;
    cancel_at_period_end?: boolean;
    now?: number;
    period_end?: number;
    plan?: string;
    paid?: boolean;
  };
  expect?: { locked?: unknown; plan?: string };
};

function goldenSteps(id: string): GoldenStep[] {
  const doc = parseYaml(fs.readFileSync(path.join(root, "tests/entitlements/goldens", `${id}.yaml`), "utf8")) as {
    steps?: GoldenStep[];
  };
  assert.ok(doc.steps && doc.steps.length > 0, `${id} steps`);
  return doc.steps;
}

function finalLocked(id: string): boolean {
  const locked = goldenSteps(id).at(-1)?.expect?.locked;
  assert.equal(typeof locked, "boolean", `${id} last expect.locked`);
  return locked as boolean;
}

/** An earlier row stays open after the cancel is scheduled or the upgrade is paid. */
function staysOpenAfterCancelOrUpgrade(steps: GoldenStep[]): boolean {
  const marker = steps.findIndex((step, index) => {
    const event = step.event ?? {};
    const scheduled =
      event.cancel_at_period_end === true &&
      typeof event.now === "number" &&
      typeof event.period_end === "number" &&
      event.now < event.period_end;
    const upgrade =
      event.type === "invoice.paid" &&
      event.paid === true &&
      typeof event.plan === "string" &&
      steps.slice(0, index).some((prev) => typeof prev.expect?.plan === "string" && prev.expect.plan !== event.plan);
    return scheduled || upgrade;
  });
  if (marker < 0 || marker >= steps.length - 1) return false;
  return steps.slice(marker, -1).some((step) => step.expect?.locked === false);
}

test("each pill matches the golden's final locked row", () => {
  assert.equal(GOLDEN_LABELS.duplicate_webhook_idempotent.outcome, "locked");
  assert.equal(GOLDEN_LABELS.duplicate_webhook_idempotent.label, "Duplicate event ignored");
  assert.equal(
    GOLDEN_LABELS.duplicate_webhook_idempotent.detail,
    "The same event applies once. A replay does not undo a cancel.",
  );
  assert.equal(GOLDEN_LABELS.entitlements_active_summary.outcome, "kept");
  assert.equal(GOLDEN_LABELS.pause_collection_keeps_access_all_behaviors.outcome, "locked");
  assert.equal(GOLDEN_LABELS.pause_collection_keeps_access_all_behaviors.label, "Pause keeps access");
  assert.equal(GOLDEN_LABELS.upgrade_plus_cape_race.outcome, "period_end");
  assert.equal(GOLDEN_LABELS.upgrade_plus_cape_race.label, "Upgrade stays open");
  assert.equal(
    GOLDEN_LABELS.upgrade_plus_cape_race.detail,
    "Plan and seats change right away. Locks when the period ends.",
  );
  assert.equal(GOLDEN_LABELS.trial_no_card.outcome, "kept");
  assert.equal(GOLDEN_LABELS.trial_end_pause_resume_waits_for_paid.outcome, "kept");
  assert.equal(GOLDEN_LABELS.cancel_at_period_end_keeps_access_until_end.outcome, "period_end");
  assert.equal(GOLDEN_LABELS.cancel_at_period_end_keeps_access_until_end.label, "Open until period end");
  assert.equal(
    GOLDEN_LABELS.cancel_at_period_end_keeps_access_until_end.detail,
    "Access stays on until the period ends, then locks.",
  );
  assert.doesNotMatch(GOLDEN_LABELS.cancel_at_period_end_keeps_access_until_end.detail ?? "", /\bnow\b/);
  assert.equal(OUTCOMES.period_end.pill, "Locks at period end");
  assert.notEqual(OUTCOMES.period_end.icon, OUTCOMES.locked.icon);
  for (const [id, copy] of Object.entries(GOLDEN_LABELS)) {
    const locked = finalLocked(id);
    if (copy.outcome === "period_end") {
      assert.equal(locked, true, `${id} period_end must end locked`);
      assert.ok(staysOpenAfterCancelOrUpgrade(goldenSteps(id)), `${id} must stay open after cancel or upgrade`);
      continue;
    }
    const closed = copy.outcome === "locked" || copy.outcome === "revoked";
    assert.equal(closed, locked, `${id} pill ${copy.outcome} but final locked is ${locked}`);
  }
});

test("the landing section renders the label map and does not hardcode the count", () => {
  const index = fs.readFileSync(path.join(root, "site/src/pages/index.astro"), "utf8");
  const section = index.slice(index.indexOf('id="goldens"'), index.indexOf('id="pricing"'));
  assert.ok(section.length > 0, "goldens section");
  assert.match(section, /See every golden/);
  assert.match(section, /href="\/goldens\/"/);
  assert.match(section, /\{groups\.total\} Stripe transitions, checked for free/);
  assert.match(section, /item\.label/);
  assert.match(section, /item\.pill/);
  assert.match(section, /item\.detail/);
  assert.match(section, /goldenId\(item\.id\)/);
  assert.doesNotMatch(section, /\b17\b/);
  assert.doesNotMatch(section, /sets\.free\.map/);
  assert.doesNotMatch(section, /sets\.phase2\.map/);
  assert.match(index, /groupStripeGoldens\(goldens\)/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
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
    assert.match(OUTCOMES[copy.outcome].pill, /^(Access kept|Access revoked|Locked|No change)$/);
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
    ["Access kept", "Access revoked", "Locked", "No change"],
  );
});

test("stamps that would mislead use the final access state or no change", () => {
  assert.equal(GOLDEN_LABELS.duplicate_webhook_idempotent.outcome, "unchanged");
  assert.equal(GOLDEN_LABELS.duplicate_webhook_idempotent.label, "Duplicate event ignored");
  assert.equal(OUTCOMES.unchanged.pill, "No change");
  assert.equal(GOLDEN_LABELS.entitlements_active_summary.outcome, "unchanged");
  assert.equal(GOLDEN_LABELS.upgrade_plus_cape_race.outcome, "locked");
  assert.equal(GOLDEN_LABELS.upgrade_plus_cape_race.label, "Upgrade, then period end");
  assert.equal(GOLDEN_LABELS.trial_no_card.outcome, "kept");
  assert.equal(GOLDEN_LABELS.trial_end_pause_resume_waits_for_paid.outcome, "kept");
  assert.equal(GOLDEN_LABELS.cancel_at_period_end_keeps_access_until_end.outcome, "locked");
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

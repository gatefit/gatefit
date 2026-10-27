# Goldens

Fixture-first access checks. Each file is one customer and a list of `event` / `expect` steps. The runner is `src/fixture-driver.ts`. Time is the fixture `now` and `period_end` (unix seconds), not the wall clock. `GATEFIT_LIVE_CLOCK` is refused.

The Stripe API version is the pin in `src/stripe-clock.ts`: `2025-10-29.clover`. These files do not call Stripe. `sk_live` is refused. An event `httpStatus` of 200 is not access; the `expect` block is the access row.

S1–S6, the Phase 2 packs, and S7–S9 are free. They do not read `GATEFIT_LICENSE_KEY` and do not call Polar. The $49 Indie License unlocks Pro packs. Chaos mode is live. Provider packs are not in this release.

| Id | Pack | Access row |
| --- | --- | --- |
| `paid_grants_access` | S1 | `invoice.paid` unlocks. |
| `cancel_revokes_access` | S2 | Immediate cancel locks. |
| `refund_revokes_access` | S3 | Refund locks. |
| `trial_to_paid_grants` | S4 | `trialing` stays locked until `invoice.paid`. |
| `past_due_denies_until_recovery` | S5 | `past_due` locks until a later `invoice.paid`. |
| `duplicate_webhook_idempotent` | S6 | The same event id does not apply twice. |
| `seat_qty_vs_db_cap` | H6 | Seat quantity replaces the stored cap. |
| `cancel_at_period_end_keeps_access_until_end` | H6 | Cancel-at-period-end stays unlocked until `now >= period_end`. |
| `upgrade_plus_cape_race` | H6 | An upgrade during cancel-at-period-end changes plan and seats, then period end locks. |
| `dispute_revokes_or_flags` | H7 | `charge.dispute.created` locks and clears features. |
| `unpaid_after_retries_revokes` | H7 | `past_due`, then `unpaid`, then cancel, stays locked. |
| `trial_no_card` | S7 | No-card trial. `customer.subscription.trial_will_end` does not grant and does not revoke. A failed first charge, `paused`, and cancel stay locked. A later `invoice.paid` grants; a repeated `trial_will_end` does not revoke it. |
| `portal_downgrade_period_end_vs_immediate` | S8 | Customer Portal downgrade. `downgrade_at_period_end` keeps the current plan until `now >= period_end`, including one second early. The period-end event applies `pending_plan`. An immediate downgrade applies on that event while `now` is still before `period_end`. |
| `entitlements_active_summary` | S9 | `entitlements.active_entitlement_summary.updated` sets `features` to the active entitlement lookup keys, including an empty summary. It does not lock or unlock. |

S7–S9 are not live Test Clock ids. H6 and H7 are not either. The live lane ports only `paid_grants_access`, `cancel_revokes_access`, and `trial_to_paid_grants`.

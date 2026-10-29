---
title: Goldens
description: Fixture access checks shipped with Gatefit. S7–S9 are free.
---

Gatefit compares the access row after each billing event. Stripe HTTP 200 is not access. The Stripe API version pin is `2025-10-29.clover` (`src/stripe-clock.ts`). These checks are fixtures. They do not call Stripe, and `sk_live` is refused.

S1–S6, seats and cancel-at-period-end, dispute and unpaid, and S7–S9 are free. They do not read a license key and do not call Polar. The $49 Indie License unlocks Pro packs. Chaos mode is live. Provider packs are not in this release. 0.5.2 is the first release that ships S7–S9. This change does not publish `0.5.2`.

## S1–S6

| Id | What the row must do |
| --- | --- |
| `paid_grants_access` | `invoice.paid` unlocks. |
| `cancel_revokes_access` | Immediate cancel locks. |
| `refund_revokes_access` | Refund locks. |
| `trial_to_paid_grants` | `trialing` stays locked until `invoice.paid`. |
| `past_due_denies_until_recovery` | `past_due` locks until a later `invoice.paid`. |
| `duplicate_webhook_idempotent` | The same event id does not apply twice. |

## Phase 2 fixtures

| Id | What the row must do |
| --- | --- |
| `seat_qty_vs_db_cap` | Seat quantity replaces the stored cap. |
| `cancel_at_period_end_keeps_access_until_end` | Cancel-at-period-end stays unlocked until fixture `now` reaches `period_end`. |
| `upgrade_plus_cape_race` | An upgrade during cancel-at-period-end changes plan and seats. Period end then locks. |
| `dispute_revokes_or_flags` | `charge.dispute.created` locks and clears features. |
| `unpaid_after_retries_revokes` | `past_due`, then `unpaid`, then cancel, stays locked. |

These are not live Test Clock ids.

## S7 — trial with no card

`trial_no_card`. A subscription starts `trialing` with a plan and no charge. The row stays locked and records the plan.

`customer.subscription.trial_will_end` does not grant. It also does not revoke a later real payment. HTTP 200 on that warning is not access.

A failed first charge (`invoice.payment_failed`) stays locked. `paused` stays locked. Cancel (`customer.subscription.deleted`) stays locked. Only a later `invoice.paid` unlocks, and a repeated `trial_will_end` leaves that grant in place.

## S8 — Customer Portal downgrade

`portal_downgrade_period_end_vs_immediate`. Time is fixture `now` and `period_end`.

A downgrade scheduled with `downgrade_at_period_end` keeps the current plan, seats, and features until `now >= period_end`. One second before `period_end` is still the old plan. The event at `period_end` applies `pending_plan`.

An immediate downgrade has no `downgrade_at_period_end` flag. The plan changes on that event even when `now` is still before `period_end`.

## S9 — active entitlements

`entitlements_active_summary`. `entitlements.active_entitlement_summary.updated` sets `features` to the active entitlement lookup keys on that event. An empty summary clears `features`. The summary does not lock or unlock, including when the event carries HTTP 200 before any `invoice.paid`.

## Run

```bash
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/hardened.ts
```

The naive adapter fails these checks. It treats HTTP 200 as access and does not apply the later row.

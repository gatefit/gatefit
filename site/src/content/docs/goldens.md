---
title: Goldens
description: Stripe access checks shipped with Gatefit. S1–S12 (17 goldens) are free.
---

Gatefit compares the access row after each billing event. Stripe HTTP 200 is not access. The Stripe API version pin is `2025-10-29.clover` (`src/stripe-clock.ts`). They do not call Stripe, and `sk_live` is refused.

The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. S1–S6, seats and cancel-at-period-end, dispute and unpaid, and S7–S12 do not read a license key and do not call Polar. Chaos mode is live. The Polar provider pack is new in 0.6.0. The Paddle provider pack is new in 0.7.0. 0.5.2 is the first release that ships S7–S9. 0.8.0 is the first release that ships S10–S12. npm `gatefit@0.8.0` is released and tag `v0.8.0` is cut.

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

## S10 — trial ends, pause, resume

`trial_end_pause_resume_waits_for_paid`. A trial ends with no payment method and the subscription pauses ([trials](https://docs.stripe.com/billing/subscriptions/trials)). `customer.subscription.paused` stays locked.

When resuming creates a resumption invoice, the subscription stays `paused` until that invoice is paid or marked uncollectible ([resume](https://docs.stripe.com/api/subscriptions/resume)). So a failed resumption charge (`invoice.payment_failed`) arrives with status `paused` and stays locked. `invoice.paid` unlocks. `customer.subscription.resumed` with status `active` and HTTP 200 follows and stays unlocked, and a replayed resume event leaves that grant in place.

Stripe's trials page says to grant access on `customer.subscription.resumed`. Gatefit's reference rules do not grant on `resumed` alone; that only matters for a resume that creates no invoice, and it is an assumed policy, not a Stripe rule.

## S11 — Smart Retries, unpaid, then paid

`smart_retries_unpaid_then_paid_recovers`. After `invoice.paid`, three failed retries each lock, including one with HTTP 200 ([Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)). Status `unpaid` stays locked and keeps plan and seats, because the subscription stays in place ([subscriptions](https://docs.stripe.com/billing/subscriptions/overview)). Paying the latest invoice unlocks. A replayed retry failure does not lock it again.

## S12 — collection pause

`pause_collection_keeps_access_all_behaviors`. The event field `pause_collection_behavior` is a flat copy of the subscription's `pause_collection.behavior` ([pause payment collection](https://docs.stripe.com/billing/subscriptions/pause-payment)). Stripe invoices have no such field, so on invoice events the adapter copies it from the parent subscription.

While payment collection is paused the subscription stays active and the customer keeps access. `keep_as_draft`, `mark_uncollectible` and `void` only change how the paused period's invoices are handled (`void` voids them), so none of them changes access. `invoice.marked_uncollectible` during a `mark_uncollectible` pause does not revoke; Stripe sends no webhooks for those invoices, so that step is defensive. After a failed payment locks the row, setting a `void` pause or clearing the pause (`null`, HTTP 200) does not grant; a later `invoice.paid` does. `invoice.marked_uncollectible` without a pause still locks.

S10–S12 are not live Test Clock ids.

## Run

```bash
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter src/adapters/hardened.ts
```

The naive adapter fails these checks. It treats HTTP 200 as access and does not apply the later row.

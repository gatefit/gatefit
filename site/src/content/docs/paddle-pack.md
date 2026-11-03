---
title: Paddle pack
description: A paid provider pack that checks your access table against ugly Paddle Billing webhook sequences.
---

The Paddle provider pack arrives in the next release. Until then, run it from a checkout of this repo (`node bin/gatefit.js run --suite paddle ...`).

The only price is the $49 one-time Gatefit Indie License (Polar). It unlocks only chaos mode and the provider packs. S1–S9 and Phase 2 stay free. Paddle is a provider your app bills through; it is not how you buy Gatefit.

HTTP 200 is not access. The pack asserts what your access table says after each Paddle webhook, never that Paddle or your checkout page answered 200.

## Run it

```bash
export GATEFIT_LICENSE_KEY=GATEFIT-...
node bin/gatefit.js run --suite paddle --adapter ./gatefit/adapter.ts
```

Once a release includes the pack, the same command is `gatefit run --suite paddle --adapter <path>`.

The pack uses the same license gate as chaos mode and the Polar pack. A missing, invalid, or revoked key exits non-zero and points at https://gatefit.io/#pricing. Pointing `--suite` at the pack's golden directory, or a file in it, goes through the same gate and, once licensed, runs exactly like `--suite paddle`. A `--suite` path that mixes Paddle goldens with free or Polar goldens is refused. Free suites never read the key and never call the license endpoint.

The adapter needs `reset()`. The pack refuses `GATEFIT_LIVE_CLOCK`. `--seed` is accepted and ignored.

## Schema

The pack pins `PADDLE_SCHEMA = v1+fixtures.1`. Events follow Paddle Billing v1 webhook event names: `transaction.*`, `subscription.*`, `adjustment.*`. The pin is `v1` plus a fixture revision; `fixtures.N` goes up whenever a Paddle golden changes meaning. Events stay minimal: `type`, `status`, `plan`, `seats`, `action`, `adjustment_type`, `cancel_at_period_end`, `period_end`, `now`, and `created`. The event `id` is Paddle's notification `event_id`. A Paddle `scheduled_change` with action `cancel` maps to `cancel_at_period_end`.

Polar sends `subscription.created`, `subscription.updated` and `subscription.canceled` too, so the pack's steps with those names carry `provider: paddle`. Your adapter must tell providers apart by their source (the endpoint or signature that received them), not by type name; an untagged `subscription.updated` folds with the Polar rules.

## What each event must do

| Paddle event | Expected access row |
|---|---|
| `transaction.created`, `.ready`, `.billed`, `.paid`, or `.updated` not completed (even HTTP 200) | unchanged |
| `transaction.completed`, or `transaction.updated` with status `completed` | unlocked; plan and seats applied |
| `transaction.payment_failed`, `transaction.canceled` | unchanged |
| `subscription.created` / `subscription.updated` with `provider: paddle` and status `active` | unlocked; plan and seats applied |
| the same with status `trialing`, `past_due`, `paused`, or `canceled` | locked |
| `subscription.activated`, `subscription.resumed` | unlocked |
| `subscription.trialing`, `subscription.past_due`, `subscription.paused` | locked |
| `subscription.canceled` with `provider: paddle` | locked |
| any `subscription.*` with `cancel_at_period_end` | unlocked until `now >= period_end`, then locked |
| `adjustment.*` with action `refund`, status `approved`, `adjustment_type` `full` | locked |
| the same with `partial`, or status `pending_approval` / `rejected` | unchanged |
| `adjustment.*` with action `chargeback`, status `approved` | locked; features cleared |
| `adjustment.*` with action `credit` or `chargeback_reverse` | unchanged |

Replaying an `event_id` changes nothing. An event whose `created` is older than one already applied must not reopen a canceled row.

## The nine transitions

| Id | Transition |
|---|---|
| `paddle_transaction_completed_grants` | created and paid transactions with HTTP 200 stay locked; `transaction.completed` opens |
| `paddle_duplicate_transaction_completed_idempotent` | the same `transaction.completed` twice, a full refund locks, a replay stays locked |
| `paddle_out_of_order_canceled_before_activated` | `subscription.canceled` arrives before an older `subscription.activated` |
| `paddle_late_stale_update_after_cancel` | a stale `subscription.updated` (active) lands after the cancel |
| `paddle_refund_adjustment_after_grant_revokes` | partial, pending and rejected refunds keep access; an approved full refund locks |
| `paddle_paused_denies_until_resumed` | `subscription.paused` locks; `subscription.resumed` reopens |
| `paddle_checkout_return_before_webhook` | the success return (`transaction.paid`, HTTP 200) stays locked until `transaction.completed` |
| `paddle_cancel_keeps_access_until_period_end` | scheduled cancel, schedule removed, scheduled again, period end, canceled |
| `paddle_past_due_denies_until_recovery` | `past_due` locks; a failed payment changes nothing; `subscription.updated` active reopens |

## Policy choices

- Only `transaction.completed` grants. Paddle fulfils on completed; a paid transaction is not yet fulfilled.
- `transaction.payment_failed` leaves the row unchanged. The subscription event (`subscription.past_due`) decides.
- An approved partial refund keeps access. Only an approved full refund locks. Change your adapter if your product revokes on any refund; the pack then fails on that step, which is the point.
- A `chargeback_reverse` does not re-grant. Access comes back only with a later `transaction.completed` or `subscription.activated`.
- Paddle trials stay locked, like the free Stripe trial goldens.

## Secrets

The pack never needs a Paddle API key. It refuses to run when the adapter source or the environment contains a Paddle API key or notification secret (`pdl_live_`, `pdl_sdbx_`, `pdl_ntfset_`), a Polar access token (`polar_oat_`, `polar_pat_`), or a live Stripe secret (`sk_live`). If your CI already exports your app's own Paddle key, run the pack in a job without it. The error never prints the value. Public Paddle client-side tokens are not secrets and are allowed.

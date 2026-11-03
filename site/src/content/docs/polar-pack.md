---
title: Polar pack
description: A paid provider pack that checks your access table against ugly Polar webhook sequences.
---

The Polar provider pack ships in 0.6.0. It is not in 0.5.2. Until 0.6.0 is published, run it from a checkout of this repo (`node bin/gatefit.js run --suite polar ...`).

The only price is the $49 one-time Gatefit Indie License (Polar). It unlocks only chaos mode and the provider packs. S1–S9 and Phase 2 stay free.

HTTP 200 is not access. The pack asserts what your access table says after each Polar webhook, never that Polar or your checkout page answered 200.

## Run it

```bash
export GATEFIT_LICENSE_KEY=GATEFIT-...
npx gatefit run --suite polar --adapter ./gatefit/adapter.ts
```

The pack uses the same license gate as chaos mode. A missing, invalid, or revoked key exits non-zero and points at https://gatefit.io/#pricing. Pointing `--suite` at the pack's golden directory, or a file in it, goes through the same gate and, once licensed, runs exactly like `--suite polar`. A `--suite` path that mixes Polar and free goldens is refused. Free suites never read the key and never call Polar.

The adapter needs `reset()`. The pack refuses `GATEFIT_LIVE_CLOCK`. `--seed` is accepted and ignored.

## Schema

The pack pins `POLAR_SCHEMA = v1+fixtures.1`. Events follow Polar's public v1 webhook event names: `order.*`, `subscription.*`, `benefit_grant.*`, `refund.*`, `checkout.*`. Polar has no dated API versions, so the pin is `v1` plus a fixture revision. `fixtures.N` goes up whenever a Polar golden changes meaning. Events stay minimal: `type`, `status`, `plan`, `seats`, `cancel_at_period_end`, `period_end`, `now`, `created`, and `benefit`. The event `id` is the Standard Webhooks `webhook-id`. Polar events carry no Stripe shortcut flags, so your adapter has to read the Polar type itself. Stripe sends `refund.created` and `refund.updated` too, and its legacy Orders API sends `order.created` and `order.updated`. These four names reach the Polar rules only with `provider: polar`; untagged, they fold with the Stripe rules. The pack's `refund.*` steps carry the tag. Its two untagged `order.*` steps (a pending `order.created`, a partially refunded `order.updated`) expect an unchanged row under either rule set. `order.paid` and `order.refunded` are Polar-only names and need no tag. Your adapter must tell Polar events apart by their source (the endpoint or signature that received them), not by type name.

## What each event must do

| Polar event | Expected access row |
|---|---|
| `checkout.created`, `checkout.updated` (any status, even HTTP 200) | unchanged |
| `order.created` with `provider: polar` (pending) | unchanged |
| `order.paid`, or `order.updated` with `provider: polar` and status `paid` | unlocked; plan and seats applied |
| `order.refunded`, or `order.updated` with `provider: polar` and status `refunded` | locked |
| `order.updated` with status `partially_refunded` (tagged or not) | unchanged |
| `refund.created` / `refund.updated` with `provider: polar` and status `succeeded` | locked; `pending` leaves it unchanged |
| `subscription.created` with status `incomplete` or `trialing` | locked |
| `subscription.created`, `subscription.active`, or `subscription.updated` with status `active` | unlocked; plan and seats applied |
| `subscription.updated` with status `past_due` or `unpaid` | locked |
| `subscription.canceled` with `cancel_at_period_end` | unlocked until `now >= period_end`, then locked |
| `subscription.uncanceled` | unchanged |
| `subscription.revoked` | locked |
| `benefit_grant.created` / `.updated` | `benefit` added to features once; lock unchanged |
| `benefit_grant.revoked` | `benefit` removed from features; lock unchanged |

Replaying a `webhook-id` changes nothing. An event whose `created` is older than one already applied must not reopen a revoked row.

## The nine transitions

| Id | Transition |
|---|---|
| `polar_order_paid_grants` | checkout and pending order with HTTP 200 stay locked; `order.paid` opens |
| `polar_duplicate_order_paid_idempotent` | the same `order.paid` twice, then `order.refunded` locks |
| `polar_out_of_order_revoked_before_active` | `subscription.revoked` arrives before an older `subscription.active` |
| `polar_late_stale_update_after_revoke` | a stale `subscription.updated` (active) lands after the revoke |
| `polar_refund_after_grant_revokes` | partial refund keeps access; a succeeded refund locks |
| `polar_benefit_revoked_removes_feature` | grant, repeat grant, then revoke the benefit |
| `polar_checkout_return_before_webhook` | the success page returns before `order.paid` |
| `polar_cancel_keeps_access_until_period_end` | cancel, uncancel, cancel again, period end, revoke |
| `polar_past_due_denies_until_recovery` | `past_due` locks; `subscription.active` reopens |

## Policy choices

- A partially refunded order keeps access. Only a full refund or a succeeded refund event locks. Change your adapter if your product revokes on any refund; the pack then fails on that step, which is the point.
- Polar trials stay locked, like the free Stripe trial goldens. Benefits granted during a trial still show up in features.
- `customer.state_changed` is not covered.

## Secrets

The pack never needs a Polar API token. It refuses to run when the adapter source or the environment contains a Polar organization or personal access token (`polar_oat_`, `polar_pat_`) or a live Stripe secret (`sk_live`). If your CI already exports your app's own Polar token, run the pack in a job without it. The error never prints the value. Public `polar_cl_` checkout links are not secrets and are allowed.

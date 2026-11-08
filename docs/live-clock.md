# Live Stripe Test Clock lane

Opt-in. **Not** the merge path. The default CI suite is S1–S12 (17 goldens), run from YAML fixtures (`gatefit run`).

Ported scenarios: `paid_grants_access`, `cancel_revokes_access`, `trial_to_paid_grants`.
Not on clocks: `refund_revokes_access` (ACH/dispute poor), `past_due_denies_until_recovery`, `duplicate_webhook_idempotent`.

H6 seats / CAPE / upgrade-race run only from YAML fixtures, not as default `gatefit live` ids. `cancel_at_period_end_keeps_access_until_end` and `upgrade_plus_cape_race` set `period_end` + `now` on events; `seat_qty_vs_db_cap` uses neither. The mapper may attach `cancel_at_period_end` / quantity when those Stripe object fields are present.

H7 dispute / unpaid-exhaust run only from YAML fixtures, not as default `gatefit live` ids. Stripe Test Clocks plus `charge.dispute.created` flake (auto-cancel delay); do not port them to the live lane for merge.

S7–S12 (`trial_no_card`, `portal_downgrade_period_end_vs_immediate`, `entitlements_active_summary`, `trial_end_pause_resume_waits_for_paid`, `smart_retries_unpaid_then_paid_recovers`, `pause_collection_keeps_access_all_behaviors`) run only from YAML fixtures, not as default `gatefit live` ids. Only `portal_downgrade_period_end_vs_immediate` sets `period_end` + `now` on events. The API version pin for fixtures and the live client is `2025-10-29.clover` in `src/stripe-clock.ts`.

## Local

```bash
export GATEFIT_LIVE_CLOCK=1
export STRIPE_SECRET_KEY=sk_test_...   # test mode only; sk_live is refused
node bin/gatefit.js live --adapter src/adapters/hardened.ts
# optional: --scenario paid_grants_access
```

`./ci-local.sh` is fixture-first. Do not export `GATEFIT_LIVE_CLOCK` for the named gate. The script unsets the flag so S1–S12 (17 goldens) stay YAML-driven.

## CI

Workflow: `.github/workflows/live-clock.yml`

- Nightly cron + `workflow_dispatch`
- Pull requests **only** when labeled `live-clock` **and** the head repo is `gatefit/gatefit` (fork PRs skip; no secrets)
- Ordinary pushes, including pushes to `main`, do not start this workflow
- Default `.github/workflows/ci.yml` does **not** run this lane
- Repo secret name: `STRIPE_SECRET_KEY` (test-mode). If that secret is absent, the opt-in job prints `live-clock skipped: STRIPE_SECRET_KEY not configured` and exits 0. It does not call Stripe.

## Landmines

- Never treat Stripe HTTP 200 as access proof — Gatefit asserts the AccessAdapter snapshot.
- While a subscription is `trialing`, a paid $0 invoice does **not** grant access.
- Clocks are created, advanced (≤2 billing intervals per step), polled until `ready`, and **deleted in `finally`**. A leftover clock is a flake.
- ≤3 customers and ≤3 subscriptions per clock. This lane uses 1+1 per scenario.
- Cards only (`pm_card_visa`). API version is pinned in `src/stripe-clock.ts`.

# Live Stripe Test Clock lane

Opt-in. **Not** the merge path. Fixture S1–S6 (`gatefit run`) stay default CI.

Ported scenarios: `paid_grants_access`, `cancel_revokes_access`, `trial_to_paid_grants`.
Not on clocks: `refund_revokes_access` (ACH/dispute poor), `past_due_denies_until_recovery`, `duplicate_webhook_idempotent`.

H6 seats / CAPE / upgrade-race are **fixture goldens** (`period_end` + `now` on YAML events). They are not default `gatefit live` ids. The mapper may attach `cancel_at_period_end` / quantity when those Stripe object fields are present.

## Local

```bash
export GATEFIT_LIVE_CLOCK=1
export STRIPE_SECRET_KEY=sk_test_...   # test mode only; sk_live is refused
node bin/gatefit.js live --adapter src/adapters/hardened.ts
# optional: --scenario paid_grants_access
```

`./ci-local.sh` is fixture-first. Do not export `GATEFIT_LIVE_CLOCK` for the named gate. The script unsets the flag so S1–S6 stay YAML-driven.

## CI

Workflow: `.github/workflows/live-clock.yml`

- Nightly cron + `workflow_dispatch`
- Pull requests **only** when labeled `live-clock` **and** the head repo is `edipert/gatefit` (fork PRs skip; no secrets)
- Default `.github/workflows/ci.yml` does **not** run this lane
- Repo secret name: `STRIPE_SECRET_KEY` (test-mode). If the secret is missing, the job no-ops instead of failing closed on billing-less forks/orgs.

## Landmines

- Never treat Stripe HTTP 200 as access proof — Gatefit asserts the AccessAdapter snapshot.
- While a subscription is `trialing`, a paid $0 invoice does **not** grant access.
- Clocks are created, advanced (≤2 billing intervals per step), polled until `ready`, and **deleted in `finally`**. A leftover clock is a flake.
- ≤3 customers and ≤3 subscriptions per clock. This lane uses 1+1 per scenario.
- Cards only (`pm_card_visa`). API version is pinned in `src/stripe-clock.ts`.

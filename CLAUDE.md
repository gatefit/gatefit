# Gatefit conventions

Stripe Entitlement Edge Pack: CI that asserts the **access DB** survives ugly billing transitions.

This file is coding/product policy. Session/merge/Project ops live in `.cursor/HARNESS.md`.

## Product shape

- Gatefit is a **CI pack**, not a billing UI and not OtoPilot mobile/panel/web.
- The unit of truth is the access/entitlement store after a transition, not “Stripe said OK.”
- Ugly transitions include (non-exhaustive): replayed webhooks, out-of-order events, duplicate `invoice.paid`, subscription canceled then re-paid, customer deleted, pause/resume, quantity collapse, trial→paid, refund/dispute, entitlement revoked while a session is live.
- Live Stripe Test Clocks are opt-in (`GATEFIT_LIVE_CLOCK=1` + `sk_test_` only). They are not default CI and not required for `./ci-local.sh`. `sk_live` is refused. Never assert Stripe HTTP 200 as access.

## Code

- Prefer small, testable adapters over a framework soup. One module should map a billing event → expected access rows; another should apply/assert them.
- Tests name the transition (`replayed_invoice_paid_does_not_double_grant`), not the framework.
- Assertions read the access DB (or a fake that matches its contract). Do not assert HTTP 200 from Stripe as proof of access.
- Tests must not silently “heal” access in fixtures to make the case pass. If the transition should deny, the row must be denied.
- Idempotency is required: replaying the same Stripe event id must not corrupt access.
- No secrets in repo, logs, or fixtures. Live Test Clocks are opt-in H5 (`docs/live-clock.md`); fixture S1–S6 stay the merge path.
- Do not copy OtoPilot KMP, detekt, iOS, panel, or web paths into this repo.

## Verify

Named gate: `./ci-local.sh`. It asserts harness integrity, then runs entitlement unit tests, `gatefit adapter-check`, hardened and SQLite S1–S6 goldens (`paid_grants_access`, `cancel_revokes_access`, `refund_revokes_access`, `trial_to_paid_grants`, `past_due_denies_until_recovery`, `duplicate_webhook_idempotent`), naive-must-fail, Action sanity (`bin/gatefit.js`), and packaging (`npx`/bin/`npm pack` tarball smoke). Do not invent a second gate.

# Paddle provider pack (GATEFIT-H28)

The Paddle provider pack ships in 0.7.0 as `gatefit run --suite paddle` (`npx gatefit@0.8.0` or the installed package), under the same $49 one-time Gatefit Indie License:

```bash
npx gatefit@0.8.0 run --suite paddle --adapter ./gatefit/adapter.ts
```

The only price is the $49 one-time Gatefit Indie License (Polar). It unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. Paddle is a provider your app bills through; it is not how you buy Gatefit.

- Goldens: `src/packs/paddle/goldens` (D1–D9, ids `paddle_*`), pinned by `PADDLE_SCHEMA = v1+fixtures.1` in `src/paddle-pack.ts`.
- Rules: `src/paddle-rules.ts`. Paddle runs before Polar in `nextSnapshot`. `subscription.created`, `.updated` and `.canceled` reach the Paddle rules only with `provider: paddle`; untagged ones fold with the Polar rules.
- Policy: only `transaction.completed` grants; `transaction.payment_failed` is unchanged; only an approved full refund adjustment locks; an approved chargeback locks and clears features; `chargeback_reverse` and credits do not re-grant.
- Secrets: the pack refuses `pdl_live_`, `pdl_sdbx_` and `pdl_ntfset_` keys in the adapter source or environment, plus Polar tokens and `sk_live`, without printing the value.
- Telemetry: an opted-in run reports `pack: paddle`. The live collector Worker at `t.gatefit.io` accepts `paddle` and every Stripe suite id, S1–S12 (17 goldens), including S10–S12. A failed or timed-out probe is down. A probe slower than 3 seconds is degraded. A sample older than 15 minutes is unknown (45 minutes for Polar). A sample more than 5 minutes ahead (`FUTURE_SKEW_MS`) is unknown, never ok, and is left out of `checked_at`. The status page shows those Worker states when `checked_at` is within 15 minutes in the past and 5 minutes in the future; otherwise every tile is unknown. A failed page fetch is unknown, not a down probe. Deployed 2026-11-08 from main `70faa3e` (version `ffb08bff`). A failed ping never affects the CLI.
- E2E: `tests/entitlements/paddle-pack.test.ts`. HTTP 200 is not access.

Site page: `site/src/content/docs/paddle-pack.md`.

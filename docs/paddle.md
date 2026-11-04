# Paddle provider pack (GATEFIT-H28)

The Paddle provider pack ships in 0.7.0 as `gatefit run --suite paddle` (`npx gatefit@0.7.0` or the installed package), under the same $49 one-time Gatefit Indie License:

```bash
npx gatefit@0.7.0 run --suite paddle --adapter ./gatefit/adapter.ts
```

The only price is the $49 one-time Gatefit Indie License (Polar). It unlocks only chaos mode and the provider packs. S1–S9 and Phase 2 stay free. Paddle is a provider your app bills through; it is not how you buy Gatefit.

- Goldens: `src/packs/paddle/goldens` (D1–D9, ids `paddle_*`), pinned by `PADDLE_SCHEMA = v1+fixtures.1` in `src/paddle-pack.ts`.
- Rules: `src/paddle-rules.ts`. Paddle runs before Polar in `nextSnapshot`. `subscription.created`, `.updated` and `.canceled` reach the Paddle rules only with `provider: paddle`; untagged ones fold with the Polar rules.
- Policy: only `transaction.completed` grants; `transaction.payment_failed` is unchanged; only an approved full refund adjustment locks; an approved chargeback locks and clears features; `chargeback_reverse` and credits do not re-grant.
- Secrets: the pack refuses `pdl_live_`, `pdl_sdbx_` and `pdl_ntfset_` keys in the adapter source or environment, plus Polar tokens and `sk_live`, without printing the value.
- Telemetry: an opted-in run reports `pack: paddle`. The live collector Worker at `t.gatefit.io` accepts `paddle`; a failed ping never affects the CLI.
- E2E: `tests/entitlements/paddle-pack.test.ts`. HTTP 200 is not access.

Site page: `site/src/content/docs/paddle-pack.md`.

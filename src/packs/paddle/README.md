# Paddle provider pack (paid)

D1–D9 Paddle goldens for `gatefit run --suite paddle --adapter <path>`. Gated by the $49 Gatefit Indie License, like chaos mode and the Polar pack. Running this directory (or one file in it) as a `--suite` path is gated too; licensed, it runs exactly like `--suite paddle`. A path mixing these files with free goldens or Polar goldens is refused.

Events use Paddle Billing v1 webhook event names (`PADDLE_SCHEMA = v1+fixtures.1` in `src/paddle-pack.ts`; `fixtures.N` goes up whenever a golden changes meaning). Polar also sends `subscription.created`, `subscription.updated` and `subscription.canceled`, so those steps carry `provider: paddle`. Each golden header names the transition and cites the schema. HTTP 200 is not access.

These files are not in `tests/entitlements/goldens`, so free runs and chaos never replay them. E2E: `tests/entitlements/paddle-pack.test.ts`. Docs: `site/src/content/docs/paddle-pack.md`.

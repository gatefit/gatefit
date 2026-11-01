# Polar provider pack (paid)

P1–P9 Polar goldens for `gatefit run --suite polar --adapter <path>`. Gated by the $49 Gatefit Indie License, like chaos mode. Running this directory as a `--suite` path is gated too.

Events use Polar public v1 webhook event names (`POLAR_SCHEMA` in `src/polar-pack.ts`). Each golden header names the transition and cites the schema. HTTP 200 is not access.

These files are not in `tests/entitlements/goldens`, so free runs and chaos never replay them. E2E: `tests/entitlements/polar-pack.test.ts`. Docs: `site/src/content/docs/polar-pack.md`.

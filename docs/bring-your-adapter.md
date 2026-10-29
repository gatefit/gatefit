# Bring your AccessAdapter

Gatefit checks **your access DB**, not Stripe HTTP 200.

## 1. Implement the contract

Export `createAdapter()` (or `default`) with:

- `apply(event)` — ingest one billing event
- `snapshot(customerId)` — return `{ locked, plan?, seats?, features? }`
- `reset()` — required when running more than one golden

`locked: true` means deny even if Stripe looks paid. Compare is declared-fields-only.

See `src/adapters/sqlite.ts` (reference) and `src/adapters/naive.ts` (anti-pattern: HTTP 200 as access).

## 2. Run locally (fixture-first)

```bash
npx gatefit run --suite tests/entitlements/goldens --adapter /abs/path/to/your-adapter.ts
```

From a Gatefit clone before registry publish:

```bash
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter /abs/path/to/your-adapter.ts
```

From this clone, exit 0 means the goldens in the tree passed, including free S7–S9. 0.5.2 is the first release that ships them. This change does not publish that tag. Do not set `GATEFIT_LIVE_CLOCK`. Do not use `sk_live`.

Live clocks: see [docs/live-clock.md](live-clock.md) (`gatefit live`).

## 3. GitHub Action

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.5.2
  with:
    adapter: path/to/your-adapter.ts
```

The Action wraps `gatefit run`. Adapter path is in *your* repo (example: `path/to/your-adapter.ts`). `uses: gatefit/gatefit@v0.5.2` runs this repo’s goldens, including free S7–S9. This change does not publish that tag. In this repo, dogfood `src/adapters/sqlite.ts`. Nested path `gatefit/gatefit/.github/actions/gatefit@v0.5.2` still works.

## 4. Sanity

Naive adapters that treat Stripe HTTP 200 as proof fail `paid_grants_access` on purpose. Hardened/sqlite pass.

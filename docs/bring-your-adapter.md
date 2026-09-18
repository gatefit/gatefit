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

From a Gatefit checkout (npm publish is H4):

```bash
npx tsx src/cli.ts run --suite tests/entitlements/goldens --adapter /abs/path/to/your-adapter.ts
```

Exit 0 = all S1–S6 goldens passed. Do not set `GATEFIT_LIVE_CLOCK`. Do not use `sk_live`.

## 3. GitHub Action

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@main
  with:
    adapter: src/access-adapter.ts
```

The Action wraps `gatefit run`. Adapter path is in *your* repo; goldens default to Gatefit’s S1–S6 pack.

## 4. Sanity

Naive adapters that treat Stripe HTTP 200 as proof fail `paid_grants_access` on purpose. Hardened/sqlite pass.

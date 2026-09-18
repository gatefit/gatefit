# gatefit

Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

Fixture-first S1–S6 goldens, a `gatefit` CLI, and a SQLite reference adapter. Not a billing UI.

```bash
npx tsx src/cli.ts run --suite tests/entitlements/goldens --adapter src/adapters/sqlite.ts
npx tsx src/cli.ts adapter-check   # naive fails S1; hardened passes S1
bash ./ci-local.sh
```

Bring your own AccessAdapter in ≤30 minutes: [docs/bring-your-adapter.md](docs/bring-your-adapter.md).

GitHub Action (wraps `gatefit run`):

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@main
  with:
    adapter: src/adapters/sqlite.ts
```

Do not set `GATEFIT_LIVE_CLOCK`. Do not use `sk_live`. Never treat Stripe HTTP 200 as proof of access.

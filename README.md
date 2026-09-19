# gatefit

Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

Fixture-first S1–S6 goldens, an `npx gatefit` CLI, and a GitHub Action. Node 22+. Not a billing UI.

Docs site: [https://edipert.github.io/gatefit/](https://edipert.github.io/gatefit/) (Astro + Starlight). Polar is the merchant of record for the optional indie license.

## Install / run

After npm publish:

```bash
npx gatefit --version
npx gatefit adapter-check
npx gatefit run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

Until the package is on the registry (no npm token in CI), same CLI from a clone or GitHub:

```bash
npm install
node bin/gatefit.js adapter-check
npx --yes github:edipert/gatefit adapter-check
```

Named verify gate (fixture-first; do not set `GATEFIT_LIVE_CLOCK`):

```bash
bash ./ci-local.sh
```

Bring your own AccessAdapter in ≤30 minutes: [docs/bring-your-adapter.md](docs/bring-your-adapter.md).

## GitHub Action

Marketplace-ready Action lives at the repo root (`action.yml`). Pin a version tag after release:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: edipert/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path from H3 still works:

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

The Action wraps `gatefit run`. Adapter path is in *your* repo; goldens default to Gatefit’s S1–S6 pack. See [docs/publish.md](docs/publish.md) for tagging / npm publish (manual; CI may lack secrets).

Do not set `GATEFIT_LIVE_CLOCK` for the named gate. Do not use `sk_live`. Never treat Stripe HTTP 200 as proof of access.

Opt-in live Test Clocks (not default CI): [docs/live-clock.md](docs/live-clock.md).

## Soft launch (indie pricing)

This is a CI pack, not an ads funnel.

- **Indie license:** $29–$49 once
- **Optional updates:** ~$19/month
- **Checkout:** Polar Buy CTA on the [docs site](https://edipert.github.io/gatefit/) (`PUBLIC_POLAR_CHECKOUT_URL`; placeholder until the Polar product exists — [docs/polar.md](docs/polar.md))

Fixture goldens, `npx gatefit`, and the GitHub Action stay free either way.

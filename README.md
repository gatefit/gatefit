# gatefit

Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

Fixture-first S1–S6 goldens, an `npx gatefit` CLI, and a GitHub Action. Node 22+. Not a billing UI.

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

Do not set `GATEFIT_LIVE_CLOCK`. Do not use `sk_live`. Never treat Stripe HTTP 200 as proof of access.

## Soft launch (indie pricing)

This is a CI pack, not an ads funnel.

- **Indie license:** $29–$49 once
- **Optional updates:** ~$19/month

No checkout in this repo yet. If the pack saves you a bad access-DB incident, open a GitHub issue on [edipert/gatefit](https://github.com/edipert/gatefit) and say you want a license. Fixture goldens stay free to run either way.

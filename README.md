# gatefit

Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

Fixture-first S1–S6 goldens, an `npx gatefit` CLI, and a GitHub Action. Node 22+. Not a billing UI.

## Distribution

The CLI and GitHub Action in this repository stay free. Docs site and npm are not live yet. Polar checkout is.

- **Docs site:** coming soon. Intended URL `https://edipert.github.io/gatefit/` (404 while this repo is private). GitHub Pages needs a public repository or a paid plan. `scripts/deploy-site.sh` publishes the static `site/dist` build to any static host without GitHub Actions.
- **npm:** coming soon. `gatefit@0.4.0` packs locally. CI runs `npm publish --dry-run` only. The registry package is not published.
- **Polar checkout:** live. Gatefit Indie License is **$49** one-time at `https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`. A plain `site` build and `scripts/deploy-site.sh` use that committed link. `PUBLIC_POLAR_CHECKOUT_URL` may override it. Any other value fails closed.

Optional updates **~$19/month**. Fixture goldens, the CLI, and the Action stay free either way. See [docs/polar.md](docs/polar.md).

## Install / run

Until npm is live, run from a clone:

```bash
npm install
node bin/gatefit.js --version
node bin/gatefit.js adapter-check
node bin/gatefit.js run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

After npm publish (coming soon):

```bash
npx gatefit --version
npx gatefit adapter-check
npx gatefit run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

Named verify gate (fixture-first; do not set `GATEFIT_LIVE_CLOCK`):

```bash
bash ./ci-local.sh
```

Bring your own AccessAdapter in ≤30 minutes: [docs/bring-your-adapter.md](docs/bring-your-adapter.md).

## GitHub Action

Marketplace-ready Action lives at the repo root (`action.yml`). Tag `v0.4.0` is not cut yet. After a human tags the release commit:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: edipert/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path still works:

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

The Action wraps `gatefit run`. Adapter path is in *your* repo; goldens default to Gatefit’s S1–S6 pack. See [docs/publish.md](docs/publish.md) and the release draft [docs/release-v0.4.0.md](docs/release-v0.4.0.md).

Do not set `GATEFIT_LIVE_CLOCK` for the named gate. Do not use `sk_live`. Never treat Stripe HTTP 200 as proof of access.

Opt-in live Test Clocks (not default CI): [docs/live-clock.md](docs/live-clock.md).

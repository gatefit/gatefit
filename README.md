# gatefit

Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

Fixture-first S1–S6 goldens, an `npx gatefit` CLI, and a GitHub Action. Node 22+. Not a billing UI.

## Distribution

The CLI and GitHub Action in this repository stay free. The docs site is live. npm is live: `npx gatefit` ([gatefit](https://www.npmjs.com/package/gatefit)). Polar checkout is.

- **Docs site:** live at https://gatefit.io. Cloudflare Pages project `gatefit`, hostname `gatefit-bdu.pages.dev`. From `site/`: `npm run build`, then `npx wrangler@4 pages deploy dist --project-name gatefit`. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment. GitHub Pages needs a public repository or a paid plan and is not the live host. `scripts/deploy-site.sh` can copy `site/dist` locally or deploy that Cloudflare target.
- **npm:** live. `npx gatefit` is `gatefit@0.4.0` at https://www.npmjs.com/package/gatefit. CI runs `npm publish --dry-run` only.
- **Polar checkout:** live. Gatefit Indie License is **$49** one-time at `https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`. A plain `site` build and `scripts/deploy-site.sh` use that committed link. `PUBLIC_POLAR_CHECKOUT_URL` may override it. Any other value fails closed.

## Install / run

```bash
npx gatefit --version
npx gatefit adapter-check
npx gatefit run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

`gatefit@0.4.0`: https://www.npmjs.com/package/gatefit

From a clone:

```bash
npm install
node bin/gatefit.js --version
node bin/gatefit.js adapter-check
node bin/gatefit.js run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
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
- uses: gatefit/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path still works:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

The Action wraps `gatefit run`. Adapter path is in *your* repo; goldens default to Gatefit’s S1–S6 pack. See [docs/publish.md](docs/publish.md) and the release draft [docs/release-v0.4.0.md](docs/release-v0.4.0.md).

Do not set `GATEFIT_LIVE_CLOCK` for the named gate. Do not use `sk_live`. Never treat Stripe HTTP 200 as proof of access.

Opt-in live Test Clocks (not default CI): [docs/live-clock.md](docs/live-clock.md).

## License

S1–S6, seats/races, dispute/unpaid, and live Test Clocks stay free. Those packs do not read `GATEFIT_LICENSE_KEY` and do not call Polar.

The $49 Gatefit Indie License unlocks Pro packs. Chaos mode is coming and is not in this release. Provider packs are not in this release. A missing, invalid, or revoked key exits non-zero and points at https://gatefit.io/#pricing.

```bash
export GATEFIT_LICENSE_KEY='GATEFIT-…'
```

Validation is `POST https://api.polar.sh/v1/customer-portal/license-keys/validate` with the key and organization id `68556619-45ab-4a88-8ad8-08606c2b820e`. No Polar API token. A valid result is cached for 24 hours by sha256, never as the raw key. If Polar is unreachable, a cached valid result is reused with a warning. With no cache, the command warns and still runs. Details: [docs/license.md](docs/license.md).

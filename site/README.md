# Gatefit docs site

Astro + Starlight app for [gatefit/gatefit](https://github.com/gatefit/gatefit). Not part of the published `gatefit@0.5.1` npm package.

```bash
npm ci
npm run build
```

Docs: https://gatefit.io. Cloudflare Pages project `gatefit`, hostname `gatefit-bdu.pages.dev`.

Deploy from this directory:

```bash
npx wrangler@4 pages deploy dist --project-name gatefit
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment. Do not commit them.

GitHub Pages needs a public repository or a paid plan and is not the live host. `.github/workflows/pages.yml` builds this site on pushes to `main` and does not deploy.

GHA-free copy of `site/dist`, or the Cloudflare target:

```bash
GATEFIT_DEPLOY_TARGET=local GATEFIT_DEPLOY_DEST=/tmp/gatefit-site \
  bash ../scripts/deploy-site.sh
```

See `scripts/deploy-site.sh` for `local`, `rsync`, `s3`, and `cloudflare`.

A plain `npm run build` uses the committed Gatefit Indie License link (`https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`, **$49** one-time). `scripts/deploy-site.sh` publishes that build. Empty `PUBLIC_POLAR_CHECKOUT_URL` keeps the committed link; any other non-Checkout-Link value fails closed. See [docs/polar.md](../docs/polar.md).

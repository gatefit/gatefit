# Gatefit docs site

Astro + Starlight app for [edipert/gatefit](https://github.com/edipert/gatefit). Not part of the published `gatefit@0.4.0` npm package.

```bash
npm ci
npm run build
```

**Docs site:** coming soon. Intended URL `https://edipert.github.io/gatefit/`. GitHub Pages needs a public repository or a paid plan (`.github/workflows/pages.yml` does not serve a private free repo).

GHA-free deploy of `site/dist`:

```bash
GATEFIT_DEPLOY_TARGET=local GATEFIT_DEPLOY_DEST=/tmp/gatefit-site \
  bash ../scripts/deploy-site.sh
```

See `scripts/deploy-site.sh` for `local`, `rsync`, and `s3` inputs.

**Polar checkout:** coming soon. `PUBLIC_POLAR_CHECKOUT_URL` stays a placeholder (`https://polar.sh/`) until a real checkout link exists. See [docs/polar.md](../docs/polar.md).

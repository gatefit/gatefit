# Gatefit v0.4.0

Draft GitHub Release notes for tag `v0.4.0`. Do not create the tag or the Release from CI. The tag must match `package.json` version `0.4.0`.

## Summary

Gatefit is a CI pack that asserts an access database survives ugly billing transitions. The CLI and the composite GitHub Action stay free.

The docs site is live at https://gatefit.io. npm is live: `npx gatefit` (https://www.npmjs.com/package/gatefit), `gatefit@0.4.0`. Polar checkout is live (Gatefit Indie License, $49 one-time). This release does not deploy the docs site.

## Install

```bash
npx gatefit --version
npx gatefit adapter-check
```

Package: https://www.npmjs.com/package/gatefit (`gatefit@0.4.0`).

`npm publish --dry-run` is what CI runs. It does not write the registry.

## GitHub Action

After a human tags this release commit (not done here):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Docs site

Live at https://gatefit.io. From `site/`: `npm run build`, then `npx wrangler@4 pages deploy dist --project-name gatefit`. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the environment. The Pages project is `gatefit`. The hostname is `gatefit-bdu.pages.dev`. GitHub Pages needs a public repository or a paid plan and is not the live host.

## Not included

- Making the repository public.
- A docs site deploy from this release. Polar checkout is the committed Checkout Link in [docs/polar.md](polar.md). npm is live: `npx gatefit` (https://www.npmjs.com/package/gatefit).

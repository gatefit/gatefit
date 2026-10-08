# Gatefit v0.4.0

Draft GitHub Release notes for tag `v0.4.0`. Do not create the tag or the Release from CI. The tag must match `package.json` version `0.4.0`.

## Summary

Gatefit is a CI pack that asserts an access database survives ugly billing transitions. The CLI and the composite GitHub Action stay free.

Docs site, npm, and Polar checkout are **coming soon**. Nothing in this draft is a live publish.

## Install

Until npm is live, clone the repo:

```bash
npm install
node bin/gatefit.js adapter-check
```

`npm publish --dry-run` is what CI runs. It does not write the registry.

## GitHub Action

After a human tags this release commit (not done here):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: edipert/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `edipert/gatefit/action.yml@…`.

## Docs site

Coming soon. Intended URL: `https://edipert.github.io/gatefit/`. GitHub Pages needs a public repository or a paid plan. `scripts/deploy-site.sh` copies `site/dist` to any static host.

## Not included

- Making the repository public.
- A real npm publish.
- A working Polar checkout. There is no checkout link yet.

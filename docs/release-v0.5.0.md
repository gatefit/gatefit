# Gatefit v0.5.0

## Summary

Gatefit 0.5.0 adds the chaos mode Pro pack, records the Pro license gate, and publishes to npm with GitHub OIDC. There is no npm token. Repository: https://github.com/gatefit/gatefit.

The docs site is live at https://gatefit.io. npm is live: `npx gatefit` (https://www.npmjs.com/package/gatefit). The registry keeps the last published tarball until this tag is pushed. Polar checkout is live (Gatefit Indie License, $49 one-time). This release does not deploy the docs site.

## Chaos mode

Chaos mode is a Pro pack. `gatefit run --suite chaos` replays every golden under seeded perturbations and compares the access row to the in-order replay. It requires `GATEFIT_LICENSE_KEY`. Free packs do not call the license gate.

## License gate

License gate (`GATEFIT_LICENSE_KEY`), first shipped in 0.4.0. A missing, invalid, or revoked key exits non-zero for Pro packs and points at https://gatefit.io/#pricing. Free packs do not read the key.

## npm trusted publishing

Pushing the annotated tag `v0.5.0` runs `.github/workflows/publish.yml`. The publish job uses the GitHub environment `npm` and `npm publish --access public`. Provenance is automatic. The workflow does not read a registry token. `workflow_dispatch` runs the unit tests and tarball checks and does not publish.

One-time setup on npmjs.com, package `gatefit`, Package settings:

- Trusted Publisher, GitHub Actions
- Organization or user: `gatefit`
- Repository: `gatefit`
- Workflow filename: `publish.yml`
- Environment name: `npm`
- Allow `npm publish`

Publishing access: Require two-factor authentication and disallow tokens.

## Install

```bash
npx gatefit --version
npx gatefit adapter-check
```

Package: https://www.npmjs.com/package/gatefit.

`./ci-local.sh` runs `npm publish --dry-run`. It does not write the registry and it does not create this tag.

## GitHub Action

Callers, once a human pushes the annotated tag:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.5.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.5.0
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Not included

- Provider packs are not in this release.
- There is no $19 monthly plan. The Indie License stays $49 one-time.
- A docs site deploy from this release.

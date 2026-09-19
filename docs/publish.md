# Publish checklist (GATEFIT-H4)

CI does **not** publish. There is no npm token in this repo. Do not paste tokens here.

## npm

1. `bash ./ci-local.sh` green on the release commit.
2. Confirm `package.json` `name` is `gatefit`, `version` is the tag you will cut (today `0.4.0`), `private` is not `true`.
3. `npm pack` — tarball must contain `bin/gatefit.js`, `src/cli.ts`, `tests/entitlements/goldens/*.yaml`, `action.yml`, `LICENSE`.
4. Smoke: `npm install --ignore-scripts ./gatefit-0.4.0.tgz` in a temp dir, then `npx gatefit adapter-check` (exit 0) and `npx gatefit --version`.
5. When an npm login exists on a trusted machine: `npm publish --access public`.
6. If the name is taken later, stop and use `@edipert/gatefit` — do not force a hijack.

## GitHub Action

Root `action.yml` is marketplace-ready (name, description, branding, composite `runs`). Listing on marketplace is optional.

1. After merge to `main`, tag `v0.4.0` on that SHA.
2. Callers: `uses: edipert/gatefit@v0.4.0`.
3. Nested shim: `uses: edipert/gatefit/.github/actions/gatefit@v0.4.0`.
4. Submit to marketplace only from a human GitHub session (not this CI).

## Out of scope here

Live Stripe Test Clocks, seats/races, paid ads, Stripe Checkout.

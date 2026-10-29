# Gatefit v0.5.2

## Summary

Gatefit 0.5.2 is the first release that ships the free S7–S9 fixture goldens. Repository: https://github.com/gatefit/gatefit.

- `trial_no_card` — a trial with no card. `customer.subscription.trial_will_end` does not grant and does not revoke. A failed first charge, pause, and cancel stay locked. A later `invoice.paid` grants.
- `portal_downgrade_period_end_vs_immediate` — a Customer Portal downgrade scheduled at period end keeps the current plan until fixture `now` reaches `period_end`. An immediate downgrade changes the plan on that event.
- `entitlements_active_summary` — `entitlements.active_entitlement_summary.updated` sets `features` to the active entitlement lookup keys, including an empty summary. The summary does not lock or unlock.

S1–S6, the Phase 2 fixtures, and S7–S9 stay free. They do not read `GATEFIT_LICENSE_KEY` and do not call Polar. HTTP 200 is not access. The Stripe API version pin stays `2025-10-29.clover`.

If the SQLite adapter cannot load `better-sqlite3`, stderr says the native module is missing, that npm 9 still runs node-gyp and drops this optional package when that compile fails, and that npm 10 and newer unpack the shipped prebuild. The fix is to upgrade npm to 10 or newer and reinstall, reinstall with `npm install --ignore-scripts`, or install a C++ compiler and reinstall. The command exits non-zero. `--version`, `--help`, and `adapter-check` do not need the module.

`./ci-local.sh` reads `npm pack --json` on npm 9 through 12. npm 12 returns an object keyed by package name.

v0.5.1 is already released (`npx gatefit`, https://www.npmjs.com/package/gatefit). This change does not publish `0.5.2` and does not create the tag. The docs site is live at https://gatefit.io. Polar checkout is live (Gatefit Indie License, $49 one-time). That license unlocks chaos mode and the provider packs. Chaos mode is live. Provider packs are not in this release. This release does not deploy the docs site.

## npm

Pushing the annotated tag `v0.5.2` runs `.github/workflows/publish.yml`. The publish job uses the GitHub environment `npm` and `npm publish --access public`. Provenance is automatic. The workflow does not read a registry token. `workflow_dispatch` runs the unit tests and tarball checks and does not publish.

`./ci-local.sh` runs `npm publish --dry-run`. It does not write the registry and it does not create this tag.

## GitHub Action

Callers, once a human pushes the annotated tag:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.5.2
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.5.2
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Not included

- No change to the license gate or chaos mode.
- Provider packs are not in this release.
- There is no $19 monthly plan. The Indie License stays $49 one-time.
- A docs site deploy from this release.
- Publishing `0.5.2`. The tag is not cut here.

# Gatefit v0.5.1

## Summary

Gatefit 0.5.1 fixes install of `npx gatefit` on machines without make or a C++ compiler. `better-sqlite3` is an optional dependency and is loaded only by the SQLite adapter. `--version`, `--help`, and `adapter-check` run without it. Repository: https://github.com/gatefit/gatefit.

v0.5.0 is already released. This patch does not change the license gate, chaos mode, or the docs site. The docs site is live at https://gatefit.io. npm is live: `npx gatefit` (https://www.npmjs.com/package/gatefit). Polar checkout is live (Gatefit Indie License, $49 one-time). This release does not deploy the docs site.

## SQLite is optional

`better-sqlite3` publishes no prebuilt binary. Install compiles it. A failed compile no longer fails the Gatefit install.

```bash
npx gatefit --version
npx gatefit --help
npx gatefit adapter-check
```

A command that uses the SQLite adapter, and cannot load `better-sqlite3`, writes this to stderr and exits non-zero:

- what is missing: the `better-sqlite3` native module
- why: it is optional and must be compiled with make and a C++ compiler
- how to fix: install Xcode Command Line Tools (macOS) or `build-essential` (Linux), then `npm rebuild better-sqlite3`

## npm

Pushing the annotated tag `v0.5.1` runs `.github/workflows/publish.yml`. The publish job uses the GitHub environment `npm` and `npm publish --access public`. Provenance is automatic. The workflow does not read a registry token. `workflow_dispatch` runs the unit tests and tarball checks and does not publish.

`./ci-local.sh` runs `npm publish --dry-run`. It does not write the registry and it does not create this tag.

## GitHub Action

Callers, once a human pushes the annotated tag:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: gatefit/gatefit@v0.5.1
  with:
    adapter: src/your-access-adapter.ts
```

Nested path:

```yaml
- uses: gatefit/gatefit/.github/actions/gatefit@v0.5.1
  with:
    adapter: src/your-access-adapter.ts
```

Both paths wrap `gatefit run` via `scripts/action-run.sh`. Do not use `gatefit/gatefit/action.yml@…`.

## Not included

- No change to the license gate or chaos mode.
- Provider packs are not in this release.
- There is no $19 monthly plan. The Indie License stays $49 one-time.
- A docs site deploy from this release.

# Gatefit v0.5.1

## Summary

Gatefit 0.5.1 makes `better-sqlite3` optional and loads it only when the SQLite adapter opens a database. `--version`, `--help`, and `adapter-check` run when that module is missing. A SQLite command that cannot load it writes the reason to stderr and exits non-zero. Repository: https://github.com/gatefit/gatefit.

`better-sqlite3@13.0.3` ships prebuilds for linux, darwin, and win32 (x64 and arm64). It does not compile during `npm install`. v0.5.0 already depended on `^13.0.3`. This patch does not change that. It keeps a missing or failed native module from taking down the commands that do not use SQLite.

v0.5.0 is already released. This patch does not change the license gate, chaos mode, or the docs site. The docs site is live at https://gatefit.io. npm is live: `npx gatefit` (https://www.npmjs.com/package/gatefit). Polar checkout is live (Gatefit Indie License, $49 one-time). This release does not deploy the docs site.

## If the SQLite adapter cannot load

```bash
npx gatefit --version
npx gatefit --help
npx gatefit adapter-check
```

A command that uses the SQLite adapter, and cannot load `better-sqlite3`, writes this to stderr and exits non-zero:

- what is missing: the `better-sqlite3` native module
- why: it is optional. Supported platforms use the prebuild shipped in the package. `npm install` does not run make or g++
- how to fix: reinstall so the prebuild is unpacked (`npm install better-sqlite3`, or reinstall gatefit). `npm rebuild better-sqlite3` does not compile it. On a platform without a prebuild, install Xcode Command Line Tools (macOS) or `build-essential` (Linux), then in the `better-sqlite3` directory run `npm run build-release`

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

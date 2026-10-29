---
title: Quickstart
description: Bring an AccessAdapter and run the access checks with npx gatefit.
---

Gatefit checks **your access DB**, not Stripe HTTP 200. Node 22+.

## 1. Adapter

Export `createAdapter()` (or `default`) with:

- `apply(event)`: ingest one billing event
- `snapshot(customerId)`: return `{ locked, plan?, seats?, features? }`
- `reset()`: required when running more than one check

`locked: true` means deny even if Stripe looks paid. Compare is declared-fields-only.

Reference: [`src/adapters/sqlite.ts`](https://github.com/gatefit/gatefit/blob/main/src/adapters/sqlite.ts) in the repo. Anti-pattern: [`src/adapters/naive.ts`](https://github.com/gatefit/gatefit/blob/main/src/adapters/naive.ts) (HTTP 200 as access).

Longer contract: [bring-your-adapter.md](https://github.com/gatefit/gatefit/blob/main/docs/bring-your-adapter.md).

## 2. Run

```bash
npx gatefit --version
npx gatefit adapter-check
npx gatefit run --suite paid_grants_access --adapter ./src/your-access-adapter.ts
```

From a checkout of this repo:

```bash
npm install
node bin/gatefit.js adapter-check
node bin/gatefit.js run --suite tests/entitlements/goldens --adapter ./src/your-access-adapter.ts
```

Exit 0 means the checks passed against that adapter. [Goldens](/goldens/) lists the checks in this repository, including free S7–S9. Those three are not in the published tarball `gatefit@0.5.1`.

## 3. Named gate

In the Gatefit repo:

```bash
bash ./ci-local.sh
```

Do not set `GATEFIT_LIVE_CLOCK` for this gate. Do not use `sk_live`. Live Test Clocks are opt-in and documented in the repo.

## 4. GitHub Action

See [GitHub Action](/action/).

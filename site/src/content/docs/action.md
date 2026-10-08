---
title: GitHub Action
description: Run Gatefit goldens from a composite Action. The Action stays free.
---

The marketplace-ready Action lives at the Gatefit repo root (`action.yml`). It wraps `gatefit run`. The Action is **free**; do not treat Marketplace listing as a paid product. The `v0.4.0` tag is coming soon. The paths below are what callers use once that tag exists.

## Use it

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: edipert/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

Nested path from earlier Highs still works:

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

`adapter` is a path in **your** repo. Goldens default to Gatefit’s bundled pack (S1–S6 plus later fixture goldens).

## Rules

- Do not set `GATEFIT_LIVE_CLOCK` on the named verify workflow.
- Do not use `sk_live`.
- Never treat Stripe HTTP 200 as proof of access.

Publish / tag checklist: [docs/publish.md](https://github.com/edipert/gatefit/blob/main/docs/publish.md) in the repo.

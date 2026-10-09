---
title: GitHub Action
description: Run the Gatefit access checks from a composite Action. The Action stays free.
---

The Action is at the Gatefit repo root (`action.yml`). It wraps `gatefit run`. The Action is free.

## Use it

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
- uses: edipert/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

The nested path also works:

```yaml
- uses: edipert/gatefit/.github/actions/gatefit@v0.4.0
  with:
    adapter: src/your-access-adapter.ts
```

`adapter` is a path in **your** repo. The bundled access checks are the default suite.

## Rules

- Do not set `GATEFIT_LIVE_CLOCK` on the named verify workflow.
- Do not use `sk_live`.
- Never treat Stripe HTTP 200 as proof of access.

Publish / tag checklist: [docs/publish.md](https://github.com/edipert/gatefit/blob/main/docs/publish.md) in the repo.

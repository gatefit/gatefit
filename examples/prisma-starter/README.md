# Prisma starter example

A minimal Prisma app shaped like the boxyhq/saas-starter-kit `Subscription` model: `id`, `customerId`, `priceId`, `active`, `startDate`, `endDate`, `cancelAt`, plus a Stripe webhook handler at `pages/api/webhooks/stripe.ts`.

This directory lives only in the gatefit repository. It is not a fork, and it does not push to any other repository.

The access check uses `gatefit run --schema` from a checkout of this repository. npm `gatefit@0.8.0` is the current published package. `--schema` and `check-my-webhook` are not in that package. This example does not name a version for those commands. Run them with `node bin/gatefit.js` from the checkout.

The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. This example is on that free path. It does not read `GATEFIT_LICENSE_KEY`.

## What it runs

Sqlite file `prisma/dev.db`, created by Prisma from `prisma/schema.prisma`. No Postgres, no Stripe network call, and no secret. `reset` deletes every row in `Subscription`. Use this file only as a disposable database.

`gatefit.schema.json` maps the Prisma columns onto the free suite. Dedupe, seats, and features are not columns on this model. Gatefit prints those findings and still exits 0 when the rows match.

The webhook handler is shaped like the starter kit. `lib/stripe.ts` checks the `Stripe-Signature` header locally (HMAC, no Stripe SDK, no network). The handler does not record the event id, compare event order, read subscription status on create, or refuse to insert when an update finds no row. `check-my-webhook` is read-only. It prints those four gaps as `possible` findings and exits 1. That exit is the expected demo. The example CI does not invoke the handler and does not set `STRIPE_WEBHOOK_SECRET`. Do not deploy this handler as the access check. The free suite reads the sqlite table. The scan only lists gaps it can see in the source.

## Run

From this directory, after `npm ci` at the repository root (so `bin/gatefit.js` can load `tsx` and `better-sqlite3`):

```bash
npm ci
export CHECKPOINT_DISABLE=1
npx prisma db push --skip-generate
node ../../bin/gatefit.js run --suite tests/entitlements/goldens --schema gatefit.schema.json
node ../../bin/gatefit.js check-my-webhook --dir .
```

`npm ci` is the only network step. Prisma telemetry is off in `ci.sh` (`CHECKPOINT_DISABLE=1`). Do not point the mapping at a database you need to keep.

GitHub Actions runs the same script: [`.github/workflows/prisma-starter.yml`](../../.github/workflows/prisma-starter.yml). Locally, without GitHub:

```bash
bash ci.sh
```

Onboarding: [docs/onboarding.md](../../docs/onboarding.md). Mapping rules: [docs/bring-your-own-schema.md](../../docs/bring-your-own-schema.md). Webhook scan: [docs/check-my-webhook.md](../../docs/check-my-webhook.md).

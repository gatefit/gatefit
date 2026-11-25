# Check my webhook

`gatefit check-my-webhook` reads a Stripe webhook handler and prints possible missing safeguards in plain words. It is free. It does not read `GATEFIT_LICENSE_KEY` and it does not call Polar. The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free.

npm `gatefit@0.8.0` is the current published package. This command ships in the next release. Run it from a checkout of this repository.

The command is read-only. It does not write to the repository. It does not use the network. It does not run the handler.

## Run

```bash
node bin/gatefit.js check-my-webhook
node bin/gatefit.js check-my-webhook --dir /path/to/app
```

With no `--dir`, the scan uses the working directory. Exit 0 means a handler was found and nothing was flagged. Exit 1 means a possible gap was reported, or no Stripe webhook handler was found. A missing path exits 1 and does not create it.

## What a line means

Each finding starts with `possible`. The scan is a heuristic. It does not prove a defect, and a quiet run does not prove the handler is safe.

It looks for five gaps:

- No signature check. The handler appears to use a Stripe event without verifying the signature.
- No event-id dedupe. The handler appears to apply an event without recording the event id, so a replay could be applied again.
- No ordering guard. The handler appears to apply an older event that arrives after a newer one.
- A status ignored on create. `customer.subscription.created` appears to grant access without reading the subscription status.
- An update that recreates a deleted row. `customer.subscription.updated` appears to insert a row when the stored subscription is missing.

A comment or a string that mentions a safeguard does not count. A handler shaped like the boxyhq/saas-starter-kit webhook (signature check, no event-id record, no ordering comparison, create grants without reading status, update inserts when the row is missing) prints:

```text
gatefit check-my-webhook: pages/api/webhooks/stripe.ts
possible missing event-id dedupe: this handler does not appear to record the Stripe event id before it applies the event.
possible missing ordering guard: this handler does not appear to drop an older event that arrives after a newer one.
possible status ignored on create: customer.subscription.created appears to grant access without reading the subscription status.
possible update recreates a deleted row: customer.subscription.updated appears to insert a row when the stored subscription is missing.
```

A handler that shows a signature check, event-id dedupe, an ordering comparison, a status read on create, and an update that returns when the row is missing prints only the file line.

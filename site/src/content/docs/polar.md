---
title: Polar checkout
description: Wire the Gatefit Polar Buy CTA after the product exists.
---

The landing page has **one** Polar Buy CTA (`Get indie license`). Polar is the merchant of record.

A live `buy.polar.sh` checkout link is not required to ship the site. The High allows a placeholder until the Polar product exists.

## Placeholder

Default href is `https://polar.sh/` via `PUBLIC_POLAR_CHECKOUT_URL`.

When the product exists:

1. Create a Polar product at **$29–$49** once (optional ~$19/month updates as a second price if you want it — still **one** Buy CTA).
2. Create a Checkout Link in Polar.
3. Set `PUBLIC_POLAR_CHECKOUT_URL` to that `https://buy.polar.sh/polar_cl_…` URL (GitHub Actions variable on this repo, or `site/.env` locally).
4. If you want the overlay embed, add `edipert.github.io` to Polar Settings → Preferences → Embedding.

Do not commit Polar access tokens. Do not add Gumroad, Framer checkout, or DIY Stripe Tax.

Repo notes: [docs/polar.md](https://github.com/edipert/gatefit/blob/main/docs/polar.md).

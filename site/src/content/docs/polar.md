---
title: Polar checkout
description: Create the Gatefit Polar product and wire the Buy CTA Checkout Link.
---

Polar checkout is coming soon. The landing page has **one** Polar Buy CTA. Polar is the merchant of record. npm and the GitHub Action stay free. There is no working checkout link yet.

Checkout **fails closed**. Until `PUBLIC_POLAR_CHECKOUT_URL` is a real Polar Checkout Link, the CTA is not a buy href. Do not invent a `polar_cl_` id. A product path is not a Checkout Link.

## Product ($49 one-time)

1. Create a Polar product **Gatefit indie license** at **$49 USD** once (optional ~$19/month updates as a second price if you want it — still **one** Buy CTA).
2. Create a Checkout Link in Polar (not a Checkout Session, and not the product page).
3. Set `PUBLIC_POLAR_CHECKOUT_URL` to that `https://buy.polar.sh/polar_cl_…` URL (GitHub Actions variable on this repo, or `site/.env` locally).
4. If you want the overlay embed, add `edipert.github.io` to Polar Settings → Preferences → Embedding.

Unset / `https://polar.sh/` / a product path / any other host is not a checkout URL. The site still builds; the CTA stays pending.

Do not commit Polar access tokens. Do not add Gumroad, Framer checkout, or DIY Stripe Tax.

Repo notes: [docs/polar.md](https://github.com/edipert/gatefit/blob/main/docs/polar.md).

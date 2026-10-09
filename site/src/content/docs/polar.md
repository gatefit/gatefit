---
title: Polar checkout
description: Gatefit Indie License Checkout Link, $49 one-time.
---

import PolarRedirect from '../../components/PolarRedirect.astro';

<PolarRedirect />

Polar checkout is live. The landing page has the Buy CTA for the Gatefit Indie License at **$49** one-time. Polar is the merchant of record. npm and the GitHub Action stay free.

The committed Checkout Link is `https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`. A plain site build uses it. `scripts/deploy-site.sh` publishes that build. Leave `PUBLIC_POLAR_CHECKOUT_URL` empty to keep this link. Set it only to replace the link with another Checkout Link.

Checkout **fails closed** when that variable is anything other than `https://buy.polar.sh/polar_cl_…`. A product path, polar.sh home, or another host stays pending.

The docs site is live at [https://gatefit.io](https://gatefit.io). npm is coming soon.

Do not commit Polar access tokens. Do not add Gumroad, Framer checkout, or DIY Stripe Tax.

Repo notes: [docs/polar.md](https://github.com/edipert/gatefit/blob/main/docs/polar.md).

# Polar Buy CTA (GATEFIT-H9)

Polar is the merchant of record for the optional indie license. npm `gatefit` and the GitHub Action stay free.

The Starlight landing CTA reads `PUBLIC_POLAR_CHECKOUT_URL`. Checkout **fails closed**: the Buy CTA is a live Polar link only when that env is a Checkout Link (`https://buy.polar.sh/polar_cl_…`). Unset, empty, `https://polar.sh/`, a product path, or any other value is not checkout. Polar checkout is coming soon; there is no working checkout link.

Do not invent a `polar_cl_` id. Edip creates the Polar product and pastes the live URL.

## Product setup ($49 one-time)

1. In Polar, create product **Gatefit indie license**.
2. Price: **$49 USD one-time** (soft-launch default). Optional ~$19/month updates as a *second* Polar price if you want it — still **one** Buy CTA on the site.
3. Create a **Checkout Link** (dashboard → Checkout Links). Copy the `https://buy.polar.sh/polar_cl_…` URL — never a short-lived Checkout Session URL.
4. Set repo Actions variable `PUBLIC_POLAR_CHECKOUT_URL` to that link (Pages workflow forwards it as a public Astro env). Locally: `site/.env` from `site/.env.example`.
5. Optional overlay: allow `edipert.github.io` under Polar Settings → Preferences → Embedding.

No Polar API tokens belong in this repo, in logs, or in fixtures. No Gumroad, Framer checkout, Next, or DIY Stripe Tax.

Docs site: coming soon (`https://edipert.github.io/gatefit/`). GitHub Pages needs a public repository or a paid plan. Polar checkout is coming soon; there is no working checkout link.

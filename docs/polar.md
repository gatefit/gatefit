# Polar Buy CTA (GATEFIT-H8)

Polar is the merchant of record for the optional indie license. npm `gatefit` and the GitHub Action stay free.

The Starlight landing CTA reads `PUBLIC_POLAR_CHECKOUT_URL`.

## Placeholder (allowed)

Until Edip creates the Polar product, the CTA href is `https://polar.sh/`. That is intentional. Do not invent a fake `polar_cl_` id.

## After the product exists

1. In Polar, create the Gatefit product ($29–$49 once; optional ~$19/month updates).
2. Create a **Checkout Link** (dashboard → Checkout Links). Copy the `https://buy.polar.sh/polar_cl_…` URL — never a short-lived Checkout Session URL.
3. Set repo Actions variable `PUBLIC_POLAR_CHECKOUT_URL` to that link (Pages workflow forwards it as a public Astro env). Locally: `site/.env` from `site/.env.example`.
4. Optional overlay: allow `edipert.github.io` under Polar Settings → Preferences → Embedding.

No Polar API tokens belong in this repo, in logs, or in fixtures.

Docs site: coming soon (`https://edipert.github.io/gatefit/`). GitHub Pages needs a public repository or a paid plan. Polar checkout is coming soon; there is no working checkout link.

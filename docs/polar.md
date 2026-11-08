# Polar Buy CTA (GATEFIT-H9)

Polar is the merchant of record for the Gatefit Indie License. npm `gatefit` and the GitHub Action stay free.

The Polar Checkout Link sells the license: **$49** one-time, benefit “Gatefit License Key”. The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free.

Committed Checkout Link (public, not a secret):

`https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`

A plain `site` build bakes that link into the Buy CTA. `scripts/deploy-site.sh` publishes that built `site/dist`. An empty `PUBLIC_POLAR_CHECKOUT_URL` uses the committed link. A set value overrides it.

Checkout **fails closed** for any value that is not `https://buy.polar.sh/polar_cl_…`. Product paths, `https://polar.sh/`, and other hosts stay closed and do not fall back to the committed link.

Docs: https://gatefit.io (Cloudflare Pages project `gatefit`, hostname `gatefit-bdu.pages.dev`). GitHub Pages needs a public repository or a paid plan and is not the live host. npm is live: `npx gatefit` is `gatefit@0.8.0` (https://www.npmjs.com/package/gatefit). Tag `v0.8.0` is cut.

No Polar API tokens belong in this repo, in logs, or in fixtures. No Gumroad, Framer checkout, Next, or DIY Stripe Tax.

License checks use the public validate endpoint only. See [license.md](license.md).

# Polar Buy CTA (GATEFIT-H9)

Polar is the merchant of record for the Gatefit Indie License. npm `gatefit` and the GitHub Action stay free.

Polar checkout is live: **$49** one-time, benefit “Gatefit License Key”.

Committed Checkout Link (public, not a secret):

`https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0`

A plain `site` build bakes that link into the Buy CTA. `scripts/deploy-site.sh` publishes that built `site/dist`. An empty `PUBLIC_POLAR_CHECKOUT_URL` uses the committed link. A set value overrides it.

Checkout **fails closed** for any value that is not `https://buy.polar.sh/polar_cl_…`. Product paths, `https://polar.sh/`, and other hosts stay pending and do not fall back to the committed link.

Docs site: live at https://gatefit.io (Cloudflare Pages project `gatefit`, hostname `gatefit-bdu.pages.dev`). GitHub Pages needs a public repository or a paid plan and is not the live host. npm is coming soon.

No Polar API tokens belong in this repo, in logs, or in fixtures. No Gumroad, Framer checkout, Next, or DIY Stripe Tax.

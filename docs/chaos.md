# Chaos mode

Chaos mode is a Pro pack. It requires `GATEFIT_LICENSE_KEY`. A missing, invalid, or revoked key exits non-zero and prints https://gatefit.io/#pricing. Free packs do not enter this suite.

```bash
gatefit run --suite chaos --adapter src/adapters/hardened.ts --seed 1
```

The seed defaults to `1`. Pass `--seed <value>` or set `GATEFIT_CHAOS_SEED`. The flag wins. An empty value uses the default. The same seed prints the same bytes. The first line is `gatefit chaos: seed <value>`.

For every golden, chaos replays the events in file order, then again under these perturbations:

- duplicated deliveries
- reordered events
- stale events (an older event arriving after a newer one)
- late events
- dropped-then-replayed events
- the checkout-return page loading before the webhook

Each perturbed replay must leave the same access row as the in-order replay. The check reads the adapter snapshot. HTTP 200 is not access. A mismatch prints the seed and that perturbation's events, then exits non-zero.

`GATEFIT_LIVE_CLOCK` is refused. Chaos does not call Stripe.

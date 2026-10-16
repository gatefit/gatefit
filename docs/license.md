# License key (GATEFIT-H16)

S1–S6, seats/races, dispute/unpaid, and live Test Clocks stay free. Free packs do not read `GATEFIT_LICENSE_KEY` and do not contact Polar.

The $49 Gatefit Indie License unlocks Pro packs. Chaos mode is live and is the first Pro pack. Provider packs are not in this release. The buy page is https://gatefit.io/#pricing. See [chaos.md](chaos.md).

## Environment

```bash
export GATEFIT_LICENSE_KEY='GATEFIT-…'
```

Polar keys use the `GATEFIT-` prefix. The CLI reads that variable only when the requested suite is a registered Pro pack.

## Validate

No Polar API token. The CLI posts the key to the public customer-portal endpoint:

`POST https://api.polar.sh/v1/customer-portal/license-keys/validate`

Body fields:

- `key` — the `GATEFIT_LICENSE_KEY` value
- `organization_id` — `68556619-45ab-4a88-8ad8-08606c2b820e`
- `benefit_id` — `4e8e6528-a979-4060-b675-7686c752a4a2` (Indie License benefit)

A `granted` status is valid. `404` is not valid. A `revoked` status exits non-zero. Both failures print https://gatefit.io/#pricing. The raw key is not printed.

## Offline

Valid results are cached for 24 hours at `~/.gatefit/license-cache.json` (override with `GATEFIT_LICENSE_CACHE`). The file stores the sha256 of the key, not the key.

A fresh cache entry skips the network. If Polar is unreachable and a cached valid result exists, the CLI warns and runs. On the first run, with no cache, it warns and still runs. Licensing is not a security boundary. A reachable revoked or invalid response is not ignored in favor of the cache.

CI sets `GATEFIT_LICENSE_VALIDATE_URL` to a local mock. The default URL above is the only production endpoint.

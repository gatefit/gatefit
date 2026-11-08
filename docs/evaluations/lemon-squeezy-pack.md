# Lemon Squeezy pack evaluation (GATEFIT-H39)

Evaluation only, sources read 8 November 2026. This document does not add a pack, YAML files, a site page, or a license-copy change.

**Recommendation: defer.** Effort **M**. The webhook surface can be expressed as a fixture pack on the same contract as Polar and Paddle, and the event names do not collide with Stripe. Defer because Stripe now ships Merchant of Record as Managed Payments, a Billing and Checkout product the free Stripe suite already speaks, while the Lemon Squeezy v1 API is an acquired product with no published sunset and no test clock. Build later if a licensee needs license-key sequences and `api.lemonsqueezy.com` is still the supported contract. Skip if Lemon Squeezy retires those webhooks in favor of Stripe Billing events.

## Pack contract this is measured against

Gatefit asserts the access row after a transition. HTTP 200 is not access. Provider packs register with `registerProPack` in `src/packs.ts` and run only after the license gate. Polar (`src/polar-pack.ts`, `src/polar-rules.ts`) and Paddle (`src/paddle-pack.ts`, `src/paddle-rules.ts`) each:

- replay YAML under `src/packs/<provider>/goldens`
- refuse `GATEFIT_LIVE_CLOCK`
- require `adapter.reset()`
- refuse provider secrets found in the adapter source or the environment, without printing the value
- pin a schema string `v1+fixtures.N` because the provider has no dated API version
- dispatch on exact webhook names inside `nextSnapshot` (`src/access-rules.ts`) before the Stripe fold
- treat a repeated event `id` as a no-op (`applyBillingEvent` in `src/access-rules.ts`)
- fold a customer on `created`, so a later arrival with an older `created` cannot reopen a row
- keep shared type names (`subscription.updated`, `order.created`, `refund.created`) off the wrong rules unless `provider` is set

The free suite is S1–S12 (17 goldens), listed in `tests/entitlements/goldens/README.md`. Phase 2 in that table is H6 (seats, cancel-at-period-end, upgrade during cancel) and H7 (dispute, unpaid after retries). Live clocks port only three Stripe ids and are opt-in (`docs/live-clock.md`). Polar and Paddle are paid packs on the $49 one-time Gatefit Indie License (`docs/license.md`).

The $49 one-time Gatefit Indie License unlocks only chaos mode and the Polar and Paddle packs. The core, Phase 2, and S1–S12 (17 goldens) stay free. A Lemon Squeezy pack, if built, would be another paid pack on that same license. This evaluation does not change that sentence.

## 1. Lifecycle and entitlement events

Canonical event list: [Event types](https://docs.lemonsqueezy.com/help/webhooks/event-types). Request shape: [Webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests). Subscription statuses: [The Subscription Object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object) and [Subscriptions](https://docs.lemonsqueezy.com/help/products/subscriptions). Recovery: [Recovery and dunning](https://docs.lemonsqueezy.com/help/online-store/recovery-dunning).

Wire names use underscores (`subscription_cancelled`, status `cancelled`). Stripe, Polar, and Paddle use dotted names and the American spelling `canceled`. Keeping the underscore spelling is what keeps these events out of `isPastDue`, `isPaused`, and `isTrialing`. Translating them to dotted names would select the wrong rules.

### Orders

An order is a one-off purchase and the parent of any subscription and license key ([The Order Object](https://docs.lemonsqueezy.com/api/orders/the-order-object)).

| Event | Body | Entitlement reading |
| --- | --- | --- |
| `order_created` | Order | Documented as a successfully placed order. The sample status is `paid`. Status enum also lists `pending`, `failed`, `paid`, `refunded`, `partial_refund`, `fraudulent`. |
| `order_refunded` | Order | Full or partial refund. `refunded: true` means fully refunded. `refunded_amount` is cents. There is no `order_updated` event. |

A one-off `paid` order is the grant, in the same role as Polar `order.paid`. A full refund (`status: refunded` or `refunded: true`) locks. A `partial_refund` keeps access, which matches the Polar and Paddle partial-refund policy. `pending` and `failed` are not described as the `order_created` case. `fraudulent` should lock if a payload ever arrives with it. Whether `order_created` is sent for those three statuses is not stated.

There is no separate dispute event. Chargebacks are a Merchant of Record concern: Lemon Squeezy may refund to avoid a chargeback and deduct a dispute fee from the payout ([Refunds and chargebacks](https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks)). The merchant-visible webhook is `order_refunded` or `subscription_payment_refunded`, which does not say the refund was a dispute.

### Subscriptions

Status enum: `on_trial`, `active`, `paused`, `past_due`, `unpaid`, `cancelled`, `expired`.

Documented sequences ([Event types](https://docs.lemonsqueezy.com/help/webhooks/event-types)):

- First purchase: `order_created`, `subscription_created`, `subscription_payment_success`, and `license_key_created` when licenses are enabled.
- Renewal: `subscription_payment_success`, then `subscription_updated`.
- Card updated, or any other field change: `subscription_updated`. The event-type page calls this the catch-all and says the granular events are optional once `subscription_updated` is subscribed.
- Customer or store cancels: `subscription_cancelled` and `subscription_updated`. Status becomes `cancelled`. The subscription stays valid until `ends_at` (a grace period). `subscription_resumed` can fire during that window.
- Grace period ends, or dunning finishes: `subscription_expired` and `subscription_updated`. The subscription page says customers should no longer have access at `expired`.
- Renewal charge fails: `subscription_payment_failed` and `subscription_updated`, once per attempt. Four attempts over two weeks. Status stays `past_due` during the attempts. A later success sends `subscription_payment_success`, `subscription_payment_recovered`, and `subscription_updated`.
- Pause and resume of collection: `subscription_paused`, `subscription_unpaused`.

`subscription_payment_success`, `subscription_payment_failed`, `subscription_payment_recovered`, and `subscription_payment_refunded` carry a [subscription invoice](https://docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object), not the subscription. Invoice `billing_reason` is `initial`, `renewal`, or `updated`. Invoice status is `pending`, `paid`, `void`, `refunded`, or `partial_refund`. `subscription_payment_recovered` is always paired with `subscription_payment_success`.

`subscription_plan_changed` appears only on the [simulate](https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events) page. It is absent from the event-type table and from the [developer webhook guide](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks). A pack should not depend on it. A plan change is a new `variant_id` on `subscription_updated`.

### Access pin, if a pack is written later

Two help pages disagree about `unpaid`. The [subscription lifecycle](https://docs.lemonsqueezy.com/help/products/subscriptions) says customers keep access in every status except `expired`. The [recovery page](https://docs.lemonsqueezy.com/help/online-store/recovery-dunning) says the customer keeps access while `past_due` and loses it when the subscription becomes `unpaid`. A pack should pin the more specific recovery page for `unpaid`, and the lifecycle page for every other status, and record the disagreement in the golden header:

| Signal | Access row |
| --- | --- |
| `order_created` with `paid` | unlocked; variant name is the plan |
| `order_created` with `refunded`, or `refunded: true` | locked |
| `order_created` or `order_refunded` with `partial_refund` | unchanged |
| `order` status `fraudulent`, if delivered | locked |
| subscription `on_trial` or `active` | unlocked |
| subscription `paused` or `past_due` | unlocked; plan and seats kept |
| subscription `unpaid` or `expired` | locked |
| subscription `cancelled` while `now < ends_at` | unlocked |
| the same once `now >= ends_at`, or `subscription_expired` | locked |
| `subscription_resumed` | unlocked |
| `subscription_unpaused` | unlocked |
| `subscription_payment_failed`, `subscription_payment_success`, `subscription_payment_recovered` | unchanged; the paired `subscription_updated` decides |
| `subscription_payment_refunded` while the subscription stays `active` | unchanged; one refunded invoice does not end the period |
| `customer_updated`, `affiliate_activated` | unchanged |

`ends_at` is the period boundary for a cancel, in the same role as `period_end` on the H6 and Polar cancel files. `renews_at` is the next charge, including the next retry while `past_due`. Time in a golden is the fixture `now` compared with `ends_at`, the same way Polar and Paddle compare `now` with `period_end`.

Trials grant access. The [free-trial page](https://docs.lemonsqueezy.com/help/products/free-trials) says the trial is full access before payments begin. Status is `on_trial` and `trial_ends_at` is set. That is the opposite of the Stripe trial goldens, which stay locked until `invoice.paid`. `on_trial` is not the string `trialing`, so it does not hit `isTrialing` unless a mapper renames it. `first_subscription_item` is null during a trial, so a trial event must not clear seats.

Pause is collection, not a deny. `pause` is null unless status is `paused`. `pause.mode` is `void` or `free`, and `pause.resumes_at` is when collection resumes ([subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object)). Both modes leave the subscription “still active” on the lifecycle page. This is the Stripe `pause_collection` outcome (access stays) and the opposite of Paddle `subscription.paused` (the row locks).

PayPal is a second dunning machine on the same recovery page: retries every 5 days, and the subscription is suspended after two failed billing cycles. The status enum has no `suspended` value. A card golden (four failures, then `unpaid`) does not describe PayPal.

### Quantity, usage, and plan changes

`first_subscription_item.quantity` is the unit count ([subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object), [subscription item](https://docs.lemonsqueezy.com/api/subscription-items/the-subscription-item-object)). That is the seat field, and only when `is_usage_based` is false. Usage-based items report `quantity: 0`. Metered usage is reported by the merchant through the usage-records API and billed on a later renewal ([Usage-based billing](https://docs.lemonsqueezy.com/help/products/usage-based-billing)). No usage-record event is in the webhook list, so metered usage cannot drive an access golden.

Checkout `quantity` on a usage-based product is ignored. A seat golden must not treat that quantity, or a usage-based `0`, as the stored cap.

Plan changes are variant changes. The subscription help page maps dashboard proration choices to `invoice_immediately` and `disable_prorations`. It does not describe holding a downgrade until `renews_at` or `ends_at`. The Customer Portal URL on the subscription object can change the plan. The resulting webhook is `subscription_updated` with a new `variant_id`.

### License keys

License keys are the entitlement surface Stripe goldens do not have.

Generation and lifetime: [Generating license keys](https://docs.lemonsqueezy.com/help/licensing/generating-license-keys), [License keys and subscriptions](https://docs.lemonsqueezy.com/help/licensing/license-keys-subscriptions), [The License Key Object](https://docs.lemonsqueezy.com/api/license-keys/the-license-key-object).

| Status | Meaning | Access |
| --- | --- | --- |
| `inactive` | Valid key, zero activations | lock unchanged |
| `active` | One or more activations | lock unchanged |
| `expired` | License length elapsed, or the linked subscription has expired | locked |
| `disabled` | Disabled from the dashboard | locked |

`inactive` means “paid, not yet activated.” It does not mean revoked. `active` means “activated somewhere,” not “invoice paid.”

Webhooks are `license_key_created` (always beside `order_created`) and `license_key_updated`. There is no `license_key_activated` or `license_key_deactivated` event.

Activation and deactivation are License API calls, a separate API ([License API](https://docs.lemonsqueezy.com/api/license-api)):

- `POST /v1/licenses/activate` with `license_key` and `instance_name` ([Activate](https://docs.lemonsqueezy.com/api/license-api/activate-license-key))
- `POST /v1/licenses/deactivate` with `license_key` and `instance_id` ([Deactivate](https://docs.lemonsqueezy.com/api/license-api/deactivate-license-key))
- `POST /v1/licenses/validate` with `license_key` and an optional `instance_id` ([Validate](https://docs.lemonsqueezy.com/api/license-api/validate-license-key))

The documented curls send `Accept: application/json` and form fields. They do not send `Authorization: Bearer`. Deactivating the last instance returns status `inactive`, which still must not lock. Hitting `activation_limit` returns `activated: false` and leaves the key `active`.

Field names differ across the two APIs. The webhook object uses `instances_count`. The License API response uses `activation_usage`. A golden should pick one body, the webhook object, and not assume the other name.

On a subscription product the license length control is removed. The key stays live until the subscription expires, not when it is merely `cancelled` ([License keys and subscriptions](https://docs.lemonsqueezy.com/help/licensing/license-keys-subscriptions)). `activation_limit` is how many machines may activate. It is not `first_subscription_item.quantity` and should not be written into `seats`.

The app user id travels in `meta.custom_data` on order, subscription, and license-key events ([Passing custom data](https://docs.lemonsqueezy.com/help/checkout/passing-custom-data), [Webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)). That value is the Gatefit `customerId`. Lemon Squeezy’s own `customer_id` is not the access subject unless the app chose it as custom data.

Lemon.js `Checkout.Success` hands the page an Order object in the browser ([Handling events](https://docs.lemonsqueezy.com/help/lemonjs/handling-events)). That is the same class of signal as a Polar checkout return: it can arrive before the webhook, and it is not the access grant. The grant is `order_created` or `subscription_created`.

## 2. Test mode, and the absence of a clock

[Test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode) is a dashboard toggle. New stores start in it. It covers checkout, products, discounts, subscriptions, license keys, webhooks, and the API. Test-mode API keys read and write test-mode data only. Test-mode webhooks fire only for test-mode data ([Simulate webhook events](https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events)). Products do not move to live mode on their own. The dashboard can copy a product or a discount across. File downloads are disabled for test purchases. Receipt mail goes to the store team, not to the address typed at checkout.

Test cards on that page include `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (insufficient funds), `4000 0000 0000 0069` (expired card), and `4000 0027 6000 3184` (3D Secure). The page points at a longer card list and does not describe a clock, a frozen `now`, or an API that advances `renews_at` or `ends_at`.

The simulator sends one event for an existing test-mode order or subscription. It can send:

- `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, `subscription_expired`, `subscription_paused`, `subscription_unpaused`, `subscription_plan_changed`
- `order_created`, `order_refunded`

It does not list `subscription_payment_failed`, `subscription_payment_success`, `subscription_payment_recovered`, `subscription_payment_refunded`, `license_key_created`, or `license_key_updated`. The dashboard can also resend a stored delivery ([Webhooks](https://docs.lemonsqueezy.com/help/webhooks)). A resend repeats a payload. It does not move time.

The [update-a-subscription](https://docs.lemonsqueezy.com/api/subscriptions/update-a-subscription) reference did not load during this pass. The subscription help page documents plan changes through proration flags, not a time skip. Nothing in the pages that did load is a Stripe Test Clock.

How a scenario would be driven anyway:

- The pack contract is already fixture-first. Polar and Paddle refuse `GATEFIT_LIVE_CLOCK`. A Lemon Squeezy pack would too. `now` and `ends_at` live on the YAML event, as `now` and `period_end` do for H6.
- A live check can place a test-mode order with `4242…` and receive the real `order_created` / `subscription_created` / `license_key_created` trio, or press simulate for the events in the list above.
- The four-retry, two-week path from `past_due` to `unpaid` to `expired`, and the end of a trial, cannot be skipped. Those goldens stay authored YAML, the way H7 and S7–S12 stay off the live lane. There is no opt-in clock to add later without Lemon Squeezy shipping one.

The [API reference](https://docs.lemonsqueezy.com/api) says `/v1` additions, including new webhook event types, are backwards compatible, and a break would be a new major. The schema pin would be `v1+fixtures.N`, the same shape as `POLAR_SCHEMA` and `PADDLE_SCHEMA`. `fixtures.N` moves when a golden changes meaning. A captured test-mode body should exist before that pin is treated as stable: the [developer guide sample](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks) places the subscription fields beside `meta`, while [Webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests) nests them under `data`. The requests page is the one that also documents the headers, so that body is the contract. The guide sample is an illustration that omits the wrapper.

## 3. What maps, what needs new goldens, what is impossible

Every Lemon Squeezy file would be new. None of the Stripe, Polar, or Paddle YAML uses these event names. “Maps cleanly” means the access outcome and the `now` / period comparison already exist, so the new file is a translation. “New golden” means copying the existing file would assert the wrong row. “Impossible” means the provider has no event or state for that transition.

### Maps cleanly

| Existing id | Lemon Squeezy translation |
| --- | --- |
| `paid_grants_access` (S1), `polar_order_paid_grants` | `order_created` with `paid` unlocks. `Checkout.Success` and a webhook HTTP 200 stay locked. A subscription grant is `subscription_created` with `active`, not the invoice event. |
| `refund_revokes_access` (S3), `polar_refund_after_grant_revokes`, `paddle_refund_adjustment_after_grant_revokes` | Full refund locks. `partial_refund` stays unlocked. The split is `status` and `refunded`, because both outcomes share `order_refunded`. |
| `duplicate_webhook_idempotent` (S6), `polar_duplicate_order_paid_idempotent` | A retry and a dashboard resend repeat the body. They are a no-op once the id in section 4 is applied. The outcome matches S6. The id is synthesized. Lemon Squeezy does not send one. |
| `cancel_at_period_end_keeps_access_until_end` (H6), `polar_cancel_keeps_access_until_period_end`, `paddle_cancel_keeps_access_until_period_end` | `subscription_cancelled` stays unlocked until `now >= ends_at`. `subscription_resumed` during the grace period unlocks the ongoing subscription. `subscription_expired` locks. |
| `polar_checkout_return_before_webhook`, `paddle_checkout_return_before_webhook` | Lemon.js `Checkout.Success` stays locked until `order_created` or `subscription_created`. |
| `polar_out_of_order_revoked_before_active`, `polar_late_stale_update_after_revoke`, and the Paddle cancel twins | Fold on `attributes.updated_at` as `created`. An older `active` after `subscription_expired` stays locked. |

### Needs new goldens

| Existing behaviour | Why the existing file is the wrong expect |
| --- | --- |
| `cancel_revokes_access` (S2) | Cancel is a grace period, not an immediate lock. The H6 translation above is the real transition. S2’s immediate lock is the wrong row. |
| `trial_to_paid_grants` (S4) | `on_trial` unlocks. The Stripe golden stays locked until `invoice.paid`. The Lemon Squeezy golden grants on `subscription_created` with `on_trial` and stays unlocked when `subscription_payment_success` arrives. |
| `past_due_denies_until_recovery` (S5), `polar_past_due_denies_until_recovery`, `paddle_past_due_denies_until_recovery` | `past_due` stays unlocked. `subscription_payment_failed` changes nothing. `unpaid` locks. A later `active`, with the paired `subscription_payment_recovered`, unlocks. Copying S5 would lock too early. |
| `unpaid_after_retries_revokes` (H7) and `smart_retries_unpaid_then_paid_recovers` (S11) | Same card path as the row above: four failures over two weeks, access held until `unpaid`, then `expired`. There is no Smart Retries product. One new golden covers S5, S11, and H7. A second file would be required for PayPal, and only after the suspended status is actually named. |
| `pause_collection_keeps_access_all_behaviors` (S12) | `subscription_paused` / `subscription_unpaused` keep access, which is the S12 outcome, for two modes (`void`, `free`). There is no `keep_as_draft`, no `mark_uncollectible`, and no `invoice.marked_uncollectible`. Paddle’s pause-locks golden is the wrong expect. |
| `portal_downgrade_period_end_vs_immediate` (S8) | An immediate `variant_id` change on `subscription_updated` can be a golden (plan replaces plan, proration flags do not change the row by themselves). A downgrade held until period end is not documented, so the S8 pair cannot be copied. `subscription_plan_changed` is not a canonical event. |
| `upgrade_plus_cape_race` (H6) | The object can show a new `variant_id` while `cancelled` and `ends_at` are set, and `subscription_updated` is the catch-all. That can be a fixture. It is not documented as a captured sequence, and the simulator’s name for a plan change is the non-canonical `subscription_plan_changed`. |
| `seat_qty_vs_db_cap` (H6) | `quantity` replaces seats only when `is_usage_based` is false and the subscription item is present. A trial has a null item and must not zero seats. A usage-based `0` must not zero seats. The Stripe file has no such guard. |
| `trial_end_pause_resume_waits_for_paid` (S10) | No trial-end pause that waits for a payment. The trial already has access. Pause is the collection pause above. |
| `trial_no_card` (S7) | The trial page does not describe a trial without a payment method, and test checkout uses a card. The trial golden is the S4 inversion, not S7. Listed again under impossible for the no-card branch. |
| License keys | No current golden. `license_key_created` beside `order_created` leaves the row unlocked when status is `inactive`. `license_key_updated` to `disabled` or `expired` locks. A last-instance deactivate that returns `inactive` does not lock. `activation_limit` is not seats. Subscription-linked keys expire with the subscription, not at cancel time. |
| `subscription_payment_refunded` on a live subscription | Do not lock while status stays `active`. S3’s “any refund locks” is the wrong row for a single renewal invoice. |

### Impossible on the published API

| Existing behaviour | Why |
| --- | --- |
| `entitlements_active_summary` (S9) | No entitlements product and no summary webhook. License status is not a feature list. Do not invent `features` from `inactive` / `active`. |
| `dispute_revokes_or_flags` (H7) | No dispute or early-fraud webhook, no chargeback-reverse event, no separate “clear features” signal. A dispute that Lemon Squeezy turns into a refund is indistinguishable from a seller refund. |
| S7 no-card trial | Not described. Test checkout uses a card. |
| S8 downgrade held until period end | Proration flags only. No scheduled `pending_plan`. |
| S10 pause at trial end until a paid invoice | Not a status. |
| S12’s three collection behaviours and uncollectible invoices | Modes are `void` and `free` only. |
| A live Test Clock lane | No clock and no documented way to advance `ends_at` or `renews_at`. The simulator omits payment and license events. Provider packs already refuse `GATEFIT_LIVE_CLOCK`. |
| Metered usage as an access transition | Usage records are merchant-submitted API calls. They are not webhooks. |
| Reusing Polar or Paddle names | Only by translating underscores into dots, which would select the Stripe, Polar, or Paddle fold and lock `past_due`, `paused`, and a renamed trial. |

`customer_updated` and `affiliate_activated` are real events and are irrelevant to the access row.

## 4. Signature verification and idempotency

Signing: [Signing requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests). Delivery: [Webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests). Setup: [Webhooks](https://docs.lemonsqueezy.com/help/webhooks).

The merchant chooses the signing secret when creating the webhook. The documented length is 6 to 40 characters. Lemon Squeezy computes an HMAC-SHA256 hex digest of the raw body and sends it in `X-Signature`. The receiver recomputes that digest and compares with a timing-safe equality check. The other documented headers are `Content-Type: application/json` and `X-Event-Name`. `meta.event_name` repeats the event name. There is no timestamp in the signature, no Standard Webhooks `webhook-id`, and no `webhook-timestamp`.

A body captured with its signature verifies forever. The signature proves the body was signed with the secret. It does not prove the delivery is new. Rejecting stale deliveries is the access fold’s job, which is the same job `created` already does for Polar.

Retries: anything other than HTTP 200 is retried up to three more times, with the documented gaps of 5 seconds, 25 seconds, and 125 seconds. The dashboard can resend a stored delivery as well. Both paths are at-least-once copies of a payload. Gatefit’s seen-set keys on `event.id`. Lemon Squeezy’s `data.id` is the resource id, stable across every later update of that order, subscription, invoice, or license key. Using `data.id` alone would drop every event after the first.

A future pack’s id, stated here as a convention rather than a field the API sends, has to include the event name so a paired `subscription_cancelled` and `subscription_updated` are both applied:

`{event_name}:{data.type}:{data.id}:{attributes.updated_at}`

`attributes.updated_at` is the `created` value the fold sorts on (ISO 8601, with fractional seconds in the samples). A retry shares that timestamp and collapses. A later mutation has a newer timestamp and is a new id. Two events in one pair can share a timestamp. `applyBillingEvent` then orders them by id string. The rules have to give both events in the pair the same access outcome, so that tie does not matter. That is true if invoice events do not grant or lock and the subscription-status event carries the decision.

Out-of-order delivery is the Polar case: an `active` payload whose `updated_at` is older than an `expired` payload must not reopen the row. The fold already does that once `updated_at` is `created`.

The pack itself, like Polar and Paddle, would not verify signatures and would not call the API. Signature checks stay in the app’s webhook endpoint. The golden’s `id` is the synthesized key above, written out in the YAML the way Polar writes a `webhook-id`.

## 5. Auth, rate limits, ownership

### Auth

[Getting started with the API](https://docs.lemonsqueezy.com/guides/developer-guide/getting-started): keys are created under Settings → API, shown once, and sent as `Authorization: Bearer {api_key}` to `https://api.lemonsqueezy.com/v1/`. JSON:API requests also send `Accept: application/vnd.api+json` and `Content-Type: application/vnd.api+json`. Test-mode keys and live-mode keys are different secrets and see different data ([API reference](https://docs.lemonsqueezy.com/api), [Test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode)).

No key prefix is documented. Polar can refuse `polar_oat_` / `polar_pat_`, and Paddle can refuse `pdl_live_` / `pdl_sdbx_` / `pdl_ntfset_`, because those prefixes are part of the token. A Lemon Squeezy scanner cannot do that. A fixture pack does not need the key. If it refuses anything, it should refuse a set `LEMONSQUEEZY_API_KEY` by name, without printing the value, and it should not invent a prefix pattern. The signing secret is also merchant-chosen and has no prefix.

The License API rate limit and the missing `Authorization` header are in [License API](https://docs.lemonsqueezy.com/api/license-api). That API is not the JSON:API. A pack that never activates keys does not call it. License-key material does not belong in YAML.

### Rate limits

| API | Limit | Source |
| --- | --- | --- |
| `https://api.lemonsqueezy.com/v1/` | 300 calls per minute. Responses include `X-Ratelimit-Limit` and `X-Ratelimit-Remaining`. Over the limit: HTTP 429. | [API reference](https://docs.lemonsqueezy.com/api) |
| License API | 60 requests per minute. | [License API](https://docs.lemonsqueezy.com/api/license-api) |

A fixture pack makes neither call, so the limits do not affect `./ci-local.sh`. They are a reason not to add a live lane that creates checkouts or walks license activation in CI.

### Ownership

Stripe acquired Lemon Squeezy. The announcement is [Stripe acquires Lemon Squeezy](https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy). Stripe’s 2025 payments roadmap says the acquisition was the year before that talk and that Managed Payments came out of it ([Product roadmap: Payments](https://stripe.com/sessions/2025/product-roadmap-payments)). Search indexes date the announcement post 26 July 2024. The page metadata fetched on 8 November 2026 reports a published date of 22 October 2024. The roadmap sentence is the one this evaluation relies on.

The follow-up, [Stripe + Lemon Squeezy Update](https://www.lemonsqueezy.com/blog/stripe-lemon-squeezy-update-2025), says existing Lemon Squeezy customers needed no action, and that Managed Payments was a new path on Stripe rather than a shutdown of the current product. Page metadata fetched the same day reports 15 August 2025. Search indexes date the post 29 April 2025. The body still describes Managed Payments as a preview that would open later that summer.

Stripe’s current Merchant of Record product is [Managed Payments](https://docs.stripe.com/payments/managed-payments): Stripe is the merchant of record, subscriptions run through Billing, and checkout is Checkout or Payment Links. That page does not mention `api.lemonsqueezy.com` or Lemon Squeezy webhooks. Those merchants are Stripe Billing customers. The free S1–S12 suite is the pack for them.

Stripe’s support article on Managed Payments fee invoices says invoices issued before 6 April 2026 may show LemonSqueezy LLC, and later invoices show Sold through Link, LLC, for the same Merchant of Record service ([Why is Sold through Link, LLC the legal entity](https://support.stripe.com/questions/why-is-sold-through-link-llc-the-legal-entity-on-my-invoice-for-stripe-managed-payments-fees), article `modified_time` 15 July 2026). That is an entity rename on the Stripe product, not a statement that the Lemon Squeezy API has been turned off.

On 8 November 2026 the Lemon Squeezy docs still describe `/v1`, webhooks, test mode, and license keys as the current API. No sunset date was on the pages fetched. Third-party posts disagree about a merchant migration and are not used here.

Longevity risk is therefore: the owner’s forward product emits Stripe Billing events Gatefit already tests, and the Lemon Squeezy API remains documented with no end date. A paid pack would track the older API.

## 6. Effort, risk, and what would change the answer

### Effort: M

A build is one rules module, one pack registration, and about nine YAML files. It is the size of the Paddle pack, plus a license-copy sweep.

The rules module dispatches before the Stripe fold, on the underscore names, and does not call `isPastDue`, `isPaused`, or `isTrialing`. Underscore names do not need a `provider` tag. The runner copies the Polar and Paddle shape: license gate, refuse `GATEFIT_LIVE_CLOCK`, require `reset`, print `v1+fixtures.1`, never call Lemon Squeezy. Suggested files, none of them in this change:

- grant on `order_created` / `subscription_created`, with `Checkout.Success` left locked
- replay of the synthesized id
- `subscription_expired` arriving before an older `active`, then a stale `subscription_updated`
- full refund locks, partial refund stays open
- cancel, resume, `ends_at`, expire
- `past_due` stays open, `unpaid` locks, recovery opens
- pause and unpause stay open
- trial `on_trial` opens, and a null subscription item does not clear seats
- license key `inactive` stays open, `disabled` and `expired` lock

That is smaller than it looks because S5, S11, and H7 collapse into the one `unpaid` file.

What keeps it from being S is the license sentence. `docs/license.md`, the README, the site docs, `tests/entitlements/onboarding-docs.test.ts`, and `tests/entitlements/site.test.ts` pin the words “only chaos mode and the Polar and Paddle packs.” `src/telemetry.ts` allow-lists `chaos`, `polar`, and `paddle`. A real pack edits all of those, and the collector has to accept the new pack name. This evaluation does not.

What keeps it from being L is the missing clock. There is no live client, no clock cleanup, and no API client in the runner.

### Risk

- Longevity, medium-high. Documented and unscheduled, with a Stripe-native successor already covered by the free suite. The license-key sequences are the only slice that successor does not cover.
- Policy, medium. A mapper that renames `past_due`, `paused`, or `on_trial` into the Stripe words will lock rows the Lemon Squeezy docs leave open. The `unpaid` disagreement between the lifecycle page and the recovery page has to be pinned in the golden, or two readers will “fix” it in opposite directions.
- Idempotency, medium. The id is a convention. Dropping the event name from it collapses the paired events. Using `data.id` alone collapses every later update.
- Payload shape, medium until a captured body exists. The guide sample and the webhook-requests sample disagree about the `data` wrapper.
- Name collision, low, as long as the underscore spelling is preserved.
- Secrets, low for a fixture pack. No documented prefix, and the runner does not need a key.

### What would change the answer

Build if a licensee asks for license-key or Lemon Squeezy subscription sequences, the v1 webhook docs are still the supported contract, and the work stays on YAML with `GATEFIT_LIVE_CLOCK` refused. Managed Payments customers do not need the pack. They are Stripe Billing.

Skip if Lemon Squeezy publishes a sunset, or says stores now emit Stripe Billing events. S1–S12 is then the pack, and a provider pack would be a second copy.

Revisit the `unpaid` and `past_due` expects if the two help pages are reconciled. Revisit S7 if a trial without a payment method is documented. Revisit a live lane only if Lemon Squeezy ships a deterministic way to advance `ends_at` and `renews_at`. Do not add a live lane under the current docs.

## License

If this pack is built, it is paid. It would sit behind the existing $49 one-time Gatefit Indie License, the same gate as chaos mode and the Polar and Paddle packs (`src/packs.ts`, `src/license.ts`, `docs/license.md`). The core, Phase 2, and S1–S12 (17 goldens) stay free. The license today unlocks only chaos mode and the Polar and Paddle packs. This evaluation does not change that copy, the buy page, or the site.

## Sources

Read 8 November 2026.

Lifecycle and webhooks:

- https://docs.lemonsqueezy.com/help/webhooks/event-types
- https://docs.lemonsqueezy.com/help/webhooks/webhook-requests
- https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events
- https://docs.lemonsqueezy.com/help/webhooks
- https://docs.lemonsqueezy.com/help/webhooks/example-payloads
- https://docs.lemonsqueezy.com/guides/developer-guide/webhooks
- https://docs.lemonsqueezy.com/help/checkout/passing-custom-data
- https://docs.lemonsqueezy.com/help/lemonjs/handling-events

Subscription, order, trial, pause, dunning, usage:

- https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object
- https://docs.lemonsqueezy.com/api/subscription-items/the-subscription-item-object
- https://docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object
- https://docs.lemonsqueezy.com/api/orders/the-order-object
- https://docs.lemonsqueezy.com/help/products/subscriptions
- https://docs.lemonsqueezy.com/help/products/free-trials
- https://docs.lemonsqueezy.com/help/products/usage-based-billing
- https://docs.lemonsqueezy.com/help/online-store/recovery-dunning
- https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks

License keys:

- https://docs.lemonsqueezy.com/help/licensing/generating-license-keys
- https://docs.lemonsqueezy.com/help/licensing/license-keys-subscriptions
- https://docs.lemonsqueezy.com/api/license-keys/the-license-key-object
- https://docs.lemonsqueezy.com/api/license-api
- https://docs.lemonsqueezy.com/api/license-api/activate-license-key
- https://docs.lemonsqueezy.com/api/license-api/deactivate-license-key
- https://docs.lemonsqueezy.com/api/license-api/validate-license-key

Test mode, auth, limits:

- https://docs.lemonsqueezy.com/help/getting-started/test-mode
- https://docs.lemonsqueezy.com/api
- https://docs.lemonsqueezy.com/guides/developer-guide/getting-started

Ownership:

- https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy
- https://www.lemonsqueezy.com/blog/stripe-lemon-squeezy-update-2025
- https://stripe.com/sessions/2025/product-roadmap-payments
- https://docs.stripe.com/payments/managed-payments
- https://support.stripe.com/questions/why-is-sold-through-link-llc-the-legal-entity-on-my-invoice-for-stripe-managed-payments-fees

Not loaded in this pass: https://docs.lemonsqueezy.com/api/subscriptions/update-a-subscription (request blocked). The conclusion that there is no test clock rests on the test-mode page, the simulate page, and the subscription help page, which do not describe one.

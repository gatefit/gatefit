import Stripe from "stripe";

const stripe = new Stripe("sk_test_placeholder");
const seen = new Set<string>();

type Row = { id: string; active: boolean; lastEventCreated: number };
const rows = new Map<string, Row>();

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
  if (seen.has(event.id)) return new Response("duplicate", { status: 200 });
  seen.add(event.id);

  switch (event.type) {
    case "customer.subscription.created":
      await onCreated(event);
      break;
    case "customer.subscription.updated":
      await onUpdated(event);
      break;
    case "customer.subscription.deleted":
      rows.delete((event.data.object as Stripe.Subscription).id);
      break;
    default:
      break;
  }
  return new Response("ok", { status: 200 });
}

async function onCreated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const status = subscription.status;
  const active = status === "active" || status === "trialing";
  rows.set(subscription.id, {
    id: subscription.id,
    active,
    lastEventCreated: event.created,
  });
}

async function onUpdated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const row = rows.get(subscription.id);
  if (!row) return;
  if (event.created < row.lastEventCreated) return;
  const status = subscription.status;
  row.active = status === "active" || status === "trialing";
  row.lastEventCreated = event.created;
}

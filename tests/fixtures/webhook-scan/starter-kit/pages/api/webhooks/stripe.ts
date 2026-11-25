import { stripe } from "../../../lib/stripe";
import {
  createTeamSubscription,
  deleteTeamSubscription,
  findSubscription,
  saveSubscription,
  findTeamByCustomer,
} from "../../../models/subscription";

export const config = { api: { bodyParser: false } };

// Shaped like the boxyhq/saas-starter-kit Stripe webhook. Original text.
// TODO: seen.add(event.id) before applying.
// TODO: if (event.created < row.lastEventCreated) return;

const relevant = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

async function readRaw(req: { on: unknown }): Promise<Buffer> {
  void req;
  return Buffer.from("");
}

export default async function webhook(
  req: { headers: Record<string, string | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const rawBody = await readRaw(req);
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    if (!sig || !secret) return;
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "bad signature";
    return res.status(400).json({ error: { message } });
  }

  if (!relevant.includes(event.type)) {
    return res.status(200).json({ received: true });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await onSubscriptionCreated(event);
        break;
      case "customer.subscription.updated":
        await onSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        await deleteTeamSubscription(String(event.data.object.id));
        break;
      default:
        break;
    }
  } catch {
    return res.status(400).json({ error: { message: "Webhook handler failed." } });
  }
  return res.status(200).json({ received: true });
}

async function onSubscriptionUpdated(event: { data: { object: Record<string, unknown> } }): Promise<void> {
  const object = event.data.object;
  const id = String(object.id);
  const status = String(object.status);
  const customer = String(object.customer);
  const subscription = await findSubscription(id);
  if (!subscription) {
    const team = await findTeamByCustomer(customer);
    if (!team) return;
    await onSubscriptionCreated(event);
    return;
  }
  await saveSubscription(id, {
    active: status === "active",
    endDate: object.current_period_end ? new Date(Number(object.current_period_end) * 1000) : undefined,
    startDate: object.current_period_start ? new Date(Number(object.current_period_start) * 1000) : undefined,
    priceId: "",
  });
}

async function onSubscriptionCreated(event: { data: { object: Record<string, unknown> } }): Promise<void> {
  const object = event.data.object;
  await createTeamSubscription({
    customerId: String(object.customer),
    id: String(object.id),
    active: true,
    startDate: new Date(Number(object.current_period_start) * 1000),
    endDate: new Date(Number(object.current_period_end) * 1000),
    priceId: "",
  });
}

import { prisma } from "../../../lib/prisma";
import { stripe, type SubscriptionEvent } from "../../../lib/stripe";

export const config = { api: { bodyParser: false } };

const relevant = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

type WebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  on?: (event: string, listener: (chunk?: Buffer) => void) => void;
};

type WebhookResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

async function readRaw(req: WebhookRequest): Promise<Buffer> {
  if (typeof req.on !== "function") return Buffer.from("");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on!("data", (chunk?: Buffer) => {
      if (chunk) chunks.push(chunk);
    });
    req.on!("end", () => resolve(Buffer.concat(chunks)));
    req.on!("error", () => reject(new Error("body")));
  });
}

function priceIdOf(object: Record<string, unknown>): string {
  const items = object.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
  const id = items?.data?.[0]?.price?.id;
  return typeof id === "string" ? id : "";
}

function periodDate(value: unknown): Date {
  return new Date(typeof value === "number" ? value * 1000 : 0);
}

export default async function webhook(req: WebhookRequest, res: WebhookResponse): Promise<void> {
  const header = req.headers["stripe-signature"];
  const signature = Array.isArray(header) ? header[0] : header;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    res.status(400).json({ error: { message: "missing signature" } });
    return;
  }

  let event: SubscriptionEvent;
  try {
    const rawBody = await readRaw(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "bad signature";
    res.status(400).json({ error: { message } });
    return;
  }

  if (!relevant.includes(event.type)) {
    res.status(200).json({ received: true });
    return;
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
        await prisma.subscription.delete({ where: { id: String(event.data.object.id) } });
        break;
      default:
        break;
    }
  } catch {
    res.status(400).json({ error: { message: "Webhook handler failed." } });
    return;
  }
  res.status(200).json({ received: true });
}

async function onSubscriptionCreated(event: SubscriptionEvent): Promise<void> {
  const object = event.data.object;
  await prisma.subscription.create({
    data: {
      id: String(object.id),
      customerId: String(object.customer),
      priceId: priceIdOf(object),
      active: true,
      startDate: periodDate(object.current_period_start),
      endDate: periodDate(object.current_period_end),
    },
  });
}

async function onSubscriptionUpdated(event: SubscriptionEvent): Promise<void> {
  const object = event.data.object;
  const id = String(object.id);
  const status = String(object.status);
  const existing = await prisma.subscription.findUnique({ where: { id } });
  if (!existing) {
    await onSubscriptionCreated(event);
    return;
  }
  await prisma.subscription.update({
    where: { id },
    data: {
      active: status === "active",
      priceId: priceIdOf(object),
      startDate: periodDate(object.current_period_start),
      endDate: periodDate(object.current_period_end),
      cancelAt: typeof object.cancel_at === "number" ? periodDate(object.cancel_at) : null,
    },
  });
}

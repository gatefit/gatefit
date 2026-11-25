import { createHmac, timingSafeEqual } from "node:crypto";

export type SubscriptionEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

const TOLERANCE_SECONDS = 300;

function headerValue(header: string, key: string): string | undefined {
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    if (piece.slice(0, eq) === key) return piece.slice(eq + 1);
  }
  return undefined;
}

/**
 * Local Stripe webhook signature check. No Stripe SDK and no network.
 * The example CI never calls this function and never sets a webhook secret.
 */
export function constructEvent(raw: Buffer, signature: string, secret: string): SubscriptionEvent {
  const timestamp = headerValue(signature, "t");
  const v1 = headerValue(signature, "v1");
  if (!timestamp || !v1) throw new Error("missing signature");
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > TOLERANCE_SECONDS) {
    throw new Error("stale signature");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
  const actual = Buffer.from(v1);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new Error("bad signature");
  }
  const parsed: unknown = JSON.parse(raw.toString("utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("bad event");
  const body = parsed as { type?: unknown; data?: { object?: unknown } };
  if (typeof body.type !== "string" || !body.data || typeof body.data.object !== "object" || body.data.object === null) {
    throw new Error("bad event");
  }
  return { type: body.type, data: { object: body.data.object as Record<string, unknown> } };
}

export const stripe = {
  webhooks: { constructEvent },
};

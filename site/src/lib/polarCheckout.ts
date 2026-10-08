/** Polar Checkout Link host+id. Not a product page and not polar.sh marketing. */
export const POLAR_CHECKOUT_HREF_RE =
  /^https:\/\/buy\.polar\.sh\/polar_cl_[A-Za-z0-9]+(\?[^\s]*)?$/;

/** Public Gatefit Indie License Checkout Link. Not a secret. */
export const DEFAULT_POLAR_CHECKOUT_URL =
  "https://buy.polar.sh/polar_cl_biyvx7HYtN2u19tUJCCkIuGOc98uVv7IG3gcB04eIJ0";

export function resolvePolarCheckoutUrl(
  raw: string | undefined,
): string | null {
  const url = (raw ?? "").trim();
  const candidate = url === "" ? DEFAULT_POLAR_CHECKOUT_URL : url;
  if (!POLAR_CHECKOUT_HREF_RE.test(candidate)) return null;
  return candidate;
}

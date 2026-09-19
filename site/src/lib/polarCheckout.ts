/** Polar Checkout Link host+id. Not a product page and not polar.sh marketing. */
export const POLAR_CHECKOUT_HREF_RE =
  /^https:\/\/buy\.polar\.sh\/polar_cl_[A-Za-z0-9]+(\?[^\s]*)?$/;

export function resolvePolarCheckoutUrl(
  raw: string | undefined,
): string | null {
  const url = (raw ?? "").trim();
  if (!POLAR_CHECKOUT_HREF_RE.test(url)) return null;
  return url;
}

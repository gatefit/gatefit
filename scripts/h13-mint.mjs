// H27 mint detectors for h13-frames.mjs, split out so tests can plant pixels.
// img is { width, height, rgb } with 3 bytes per pixel.

// H27: the glow is brand mint (#5EE0A8) on navy. Navy and every text token are
// blue-leaning (b >= g), so mint is "green clearly above red and blue". This
// matches mint at roughly >= 50% over navy, like the old amber threshold.
export function isMint(r, g, b) {
  return g > 120 && g > b + 12 && g > r + 55;
}

export function mintInside(img, box, scaleX, scaleY) {
  const x0 = Math.max(0, Math.floor((box.x + 3) * scaleX));
  const y0 = Math.max(0, Math.floor((box.y + 3) * scaleY));
  const x1 = Math.min(img.width, Math.ceil((box.x + box.w - 3) * scaleX));
  const y1 = Math.min(img.height, Math.ceil((box.y + box.h - 3) * scaleY));
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * img.width + x) * 3;
      if (isMint(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2])) count += 1;
    }
  }
  return count;
}

export function insideRoundedRect(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  return r - (Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)));
}

// Faint orbit mint (about 25% over the card surface) still lifts green above
// the red/blue mean; navy, surface, hairlines, and text sit at or below zero.
export function isOrbitMint(r, g, b) {
  return g > 55 && g > r + 30 && g - (r + b) / 2 > 12;
}

export function mintPastBorder(img, scaleX, scaleY, radiusCss, holes) {
  const w = img.width / scaleX;
  const h = img.height / scaleY;
  let count = 0;
  for (let y = 0; y < img.height; y += 1) {
    const cy = (y + 0.5) / scaleY;
    for (let x = 0; x < img.width; x += 1) {
      const cx = (x + 0.5) / scaleX;
      if (insideRoundedRect(cx, cy, w, h, radiusCss) <= 4) continue;
      if (holes.some((hole) => cx >= hole.x && cy >= hole.y && cx <= hole.x + hole.w && cy <= hole.y + hole.h)) continue;
      const i = (y * img.width + x) * 3;
      if (isOrbitMint(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2])) count += 1;
    }
  }
  return count;
}

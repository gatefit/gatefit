import assert from "node:assert/strict";
import { test } from "node:test";
import { isMint, isOrbitMint, mintInside, mintPastBorder } from "../../scripts/h13-mint.mjs";
import { BRAND } from "../../site/src/lib/brand.ts";

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function image(width: number, height: number, fill: string) {
  const px = rgb(fill);
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(px, i);
  return { width, height, rgb: data };
}

function plant(img: ReturnType<typeof image>, x: number, y: number, hex: string) {
  img.rgb.set(rgb(hex), (y * img.width + x) * 3);
}

const NOT_MINT = ["navy", "navyDeep", "surface", "surface2", "text", "body", "muted", "faint", "red", "redHigh"] as const;

test("H27 h13 detectors: brand mint counts, navy and text tokens do not", () => {
  assert.ok(isMint(...rgb(BRAND.mint)), "mint");
  assert.ok(isOrbitMint(...rgb(BRAND.mint)), "orbit mint");
  for (const k of NOT_MINT) {
    assert.ok(!isMint(...rgb(BRAND[k])), `isMint fired on ${k}`);
    assert.ok(!isOrbitMint(...rgb(BRAND[k])), `isOrbitMint fired on ${k}`);
  }
});

test("H27 h13 detectors: mintInside finds one planted mint pixel and none on navy or text", () => {
  const box = { x: 0, y: 0, w: 40, h: 40 };
  const img = image(40, 40, BRAND.navy);
  assert.equal(mintInside(img, box, 1, 1), 0, "plain navy");
  for (let x = 8; x < 30; x += 1) plant(img, x, 20, BRAND.text);
  plant(img, 10, 10, BRAND.faint);
  assert.equal(mintInside(img, box, 1, 1), 0, "navy with text");
  plant(img, 12, 12, BRAND.mint);
  assert.equal(mintInside(img, box, 1, 1), 1, "planted mint");
});

test("H27 h13 detectors: mintPastBorder fires on mint inside the card, not on surface or a hole", () => {
  const img = image(60, 60, BRAND.surface);
  assert.equal(mintPastBorder(img, 1, 1, 12, []), 0, "plain surface");
  plant(img, 2, 2, BRAND.mint); // corner, outside the rounded border band
  assert.equal(mintPastBorder(img, 1, 1, 12, []), 0, "mint outside the card");
  plant(img, 30, 30, BRAND.mint);
  assert.equal(mintPastBorder(img, 1, 1, 12, []), 1, "planted interior mint");
  assert.equal(mintPastBorder(img, 1, 1, 12, [{ x: 25, y: 25, w: 10, h: 10 }]), 0, "mint in a hole");
});

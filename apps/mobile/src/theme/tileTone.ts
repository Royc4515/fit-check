import type { Subcategory } from "@fit-check/schema";
import type { ColorToken } from "./tokens";

/** The three tile grounds of DESIGN.md section 2. */
export type TileTone = Extract<ColorToken, "tile" | "tile-deep" | "tile-cool">;

/**
 * Bounds for {@link tileTone}, in OKLCH. Checked against the palette the app actually stores (features/intake/palette.ts
 * plus white, khaki, camel, tan, light brown); see the report in CHANGELOG 2026-11-18.
 */
const TONE = {
  /** Above this lightness a garment dissolves into the default tile (white, cream). */
  deepAboveL: 0.86,
  /** Sand and earth band: warm hue, mid-light, muted. */
  coolHue: [40, 110],
  coolL: [0.55, 0.86],
  // don't touch / the 0.02 floor keeps neutral grey (#8A8780, C 0.011, hue ~88 by rounding noise) on `tile`; without
  // it every grey garment lands on the cool stone. The 0.10 ceiling keeps saturated mustard (C 0.14) on `tile`.
  coolC: [0.02, 0.1],
} as const;

/** sRGB channel (0-255) to linear light. */
function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Parses #RGB / #RRGGBB (hash optional, any case). Null for anything else. */
function parseHex(input: string): [number, number, number] | null {
  const s = input.trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
  const full = s.length === 3 ? s.replace(/./g, (ch) => ch + ch) : s;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * sRGB hex to OKLCH (Björn Ottosson's matrices). Inline rather than a colour library: three matrix products are not
 * worth a dependency in the app bundle.
 * @returns `{ L: 0..1, C: >= 0, h: 0..360 }`, or null for an unparseable colour.
 */
export function toOklch(hex: string): { L: number; C: number; h: number } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, C: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;

/**
 * Tile ground for a garment (DESIGN.md section 4 "אריח: בחירת הגוון"). Pure; safe to call per render.
 * @param colorHex - the item's `tags.color_hex`. Missing or malformed values are not an error: they get `tile`.
 * @returns `tile-deep` for very light garments, `tile-cool` for sand/earth tones, otherwise `tile`.
 */
export function tileTone(colorHex: string | null | undefined): TileTone {
  if (!colorHex) return "tile";
  const c = toOklch(colorHex);
  if (!c) return "tile";
  if (c.L > TONE.deepAboveL) return "tile-deep";
  if (within(c.h, TONE.coolHue) && within(c.L, TONE.coolL) && within(c.C, TONE.coolC)) return "tile-cool";
  return "tile";
}

/**
 * Height / width of a masonry tile by garment type (DESIGN.md section 3 "ארון" item 4). Keyed by the schema's
 * subcategory enum (packages/schema/src/item-tags.ts); the height is known before the image loads, so nothing jumps.
 */
const ASPECT = {
  jeans: 1.55,
  chinos: 1.55,
  trousers: 1.55,
  coat: 1.45,
  button_down: 1.25,
  overshirt: 1.25,
  knit: 1.25,
  sweatshirt: 1.25,
  jacket: 1.25,
  tshirt: 1.1,
  polo: 1.1,
  shorts: 1.1,
  boots: 1.05,
  sneakers: 0.85,
  dress_shoes: 0.85,
  sandals: 0.85,
  belt: 0.85,
  watch: 0.85,
  hat: 0.85,
} as const satisfies Record<Subcategory, number>;

/** Fallback for a subcategory added to the schema but not yet to the table: the most common garment shape. */
const DEFAULT_ASPECT = 1.25;

/**
 * Tile aspect (height / width) for a subcategory.
 * @param subcategory - `tags.subcategory`; unknown values get 1.25 rather than throwing.
 */
export function tileAspect(subcategory: string): number {
  // Widened to a string index: callers may hold a value from an older or newer schema than this table.
  const table: Readonly<Record<string, number | undefined>> = ASPECT;
  return table[subcategory] ?? DEFAULT_ASPECT;
}

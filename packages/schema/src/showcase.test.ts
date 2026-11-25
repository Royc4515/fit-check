import { describe, expect, it } from "vitest";
import { ShowcaseResponseSchema } from "./showcase.ts";

const tags = (category: string, subcategory: string) => ({
  category,
  subcategory,
  color_hex: "#F4F1EA",
  color_name: "white",
  secondary_color_hex: null,
  pattern: "solid",
  material: "linen",
  fit: "regular",
  sleeve: "long",
  formality: 5,
  seasons: ["summer"],
  temp_min_c: 18,
  temp_max_c: 32,
  modesty_flags: [],
  style_tags: [],
});
const piece = (slot: string, category: string, subcategory: string, i: number) => ({
  slot,
  item: { id: `00000000-0000-4000-8000-00000000000${i}`, tags: tags(category, subcategory), cutout_path: `u/${i}.png`, thumb_path: null },
});
const three = [piece("top", "top", "button_down", 1), piece("bottom", "bottom", "chinos", 2), piece("shoes", "shoes", "sandals", 3)];

describe("ShowcaseResponseSchema", () => {
  it("a look of three or four garments, one per slot", () => {
    expect(ShowcaseResponseSchema.safeParse({ ok: true, pieces: three }).success).toBe(true);
    expect(ShowcaseResponseSchema.safeParse({ ok: true, pieces: [...three, piece("layer", "layer", "knit", 4)] }).success).toBe(true);
    expect(ShowcaseResponseSchema.safeParse({ ok: false, reason: "none" }).success).toBe(true);
  });

  it("refuses two garments, a doubled slot, or a garment without a photo", () => {
    expect(ShowcaseResponseSchema.safeParse({ ok: true, pieces: three.slice(0, 2) }).success).toBe(false);
    expect(ShowcaseResponseSchema.safeParse({ ok: true, pieces: [...three, piece("top", "top", "tshirt", 4)] }).success).toBe(false);
    const noPhoto = { ...three[0], item: { ...three[0]!.item, cutout_path: "" } };
    expect(ShowcaseResponseSchema.safeParse({ ok: true, pieces: [noPhoto, ...three.slice(1)] }).success).toBe(false);
  });
});

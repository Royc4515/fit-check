import { z } from "zod";

/**
 * The item tag schema. FROZEN after the first real import (PRD 6.2).
 *
 * Every closed list below is handed verbatim to the tagging model as the only
 * allowed values, so adding a value here changes what the model may answer and
 * requires a re-tag job for existing items. Treat edits like a migration.
 */

export const CATEGORIES = [
  "top",
  "bottom",
  "shoes",
  "layer",
  "outerwear",
  "accessory",
] as const;

export const SUBCATEGORIES = [
  "button_down",
  "tshirt",
  "polo",
  "knit",
  "sweatshirt",
  // Added 2026-11-10 (Roy): a shirt worn open over a T-shirt is a layer, not a top. Re-tag: existing button-downs
  // were reviewed by hand, see CHANGELOG.
  "overshirt",
  "jeans",
  "chinos",
  "trousers",
  "shorts",
  "sneakers",
  "boots",
  "dress_shoes",
  "sandals",
  "coat",
  "jacket",
  "belt",
  "watch",
  "hat",
] as const;

export const COLOR_NAMES = [
  "navy",
  "white",
  "black",
  "grey",
  "beige",
  "brown",
  "olive",
  "burgundy",
  "blue",
  "light_blue",
  "red",
  "green",
  "orange",
  "yellow",
  "pink",
  "cream",
] as const;

export const PATTERNS = ["solid", "stripes", "check", "print", "melange", "denim"] as const;

export const MATERIALS = [
  "cotton",
  "linen",
  "wool",
  "denim",
  "synthetic",
  "leather",
  "suede",
  "mixed",
  "unknown",
] as const;

export const FITS = ["slim", "regular", "relaxed", "oversized"] as const;

export const SLEEVES = ["short", "long", "sleeveless", "na"] as const;

export const SEASONS = ["summer", "transition", "winter"] as const;

export const MODESTY_FLAGS = ["short_sleeve", "short_pants", "open_front"] as const;

export const STYLE_TAGS = [
  "preppy",
  "smart_casual",
  "streetwear",
  "outdoor",
  "sport",
  "formal",
  "resort",
] as const;

/** Which subcategories belong to which slot. The engine fills slots, not categories. */
export const SUBCATEGORY_TO_CATEGORY: Record<(typeof SUBCATEGORIES)[number], (typeof CATEGORIES)[number]> = {
  button_down: "top",
  tshirt: "top",
  polo: "top",
  knit: "layer",
  sweatshirt: "layer",
  overshirt: "layer",
  jeans: "bottom",
  chinos: "bottom",
  trousers: "bottom",
  shorts: "bottom",
  sneakers: "shoes",
  boots: "shoes",
  dress_shoes: "shoes",
  sandals: "shoes",
  coat: "outerwear",
  jacket: "outerwear",
  belt: "accessory",
  watch: "accessory",
  hat: "accessory",
};

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected #RRGGBB");

export const ItemTagsSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: z.enum(SUBCATEGORIES),
  color_hex: hexColor,
  color_name: z.enum(COLOR_NAMES),
  secondary_color_hex: hexColor.nullable(),
  pattern: z.enum(PATTERNS),
  material: z.enum(MATERIALS),
  fit: z.enum(FITS),
  sleeve: z.enum(SLEEVES),
  // 1-10, same scale as the original sheet so the import needs no remapping.
  formality: z.number().int().min(1).max(10),
  seasons: z.array(z.enum(SEASONS)).min(1),
  temp_min_c: z.number().int().min(-10).max(45),
  temp_max_c: z.number().int().min(-10).max(45),
  modesty_flags: z.array(z.enum(MODESTY_FLAGS)),
  style_tags: z.array(z.enum(STYLE_TAGS)),
}).superRefine((tags, ctx) => {
  if (tags.temp_min_c > tags.temp_max_c) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "temp_min_c must be <= temp_max_c" });
  }
  // don't touch / the engine assumes category is derivable from subcategory; a mismatch
  // here would let an item land in the wrong slot and never be caught downstream.
  if (SUBCATEGORY_TO_CATEGORY[tags.subcategory] !== tags.category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `subcategory ${tags.subcategory} belongs to ${SUBCATEGORY_TO_CATEGORY[tags.subcategory]}, not ${tags.category}`,
    });
  }
});

export type ItemTags = z.infer<typeof ItemTagsSchema>;
export type Category = (typeof CATEGORIES)[number];
export type Subcategory = (typeof SUBCATEGORIES)[number];
export type ColorName = (typeof COLOR_NAMES)[number];
export type Season = (typeof SEASONS)[number];
export type ModestyFlag = (typeof MODESTY_FLAGS)[number];
export type StyleTag = (typeof STYLE_TAGS)[number];

import { SUBCATEGORY_TO_CATEGORY, type ItemTags } from "@fit-check/schema";

/** Sleeve choices offered to the user; "na" is implied for garments without sleeves and never shown. */
export const SLEEVE_CHOICES = ["short", "long", "sleeveless"] as const;

/** Only these slots have a sleeve to choose. */
export const hasSleeves = (tags: ItemTags) => ["top", "layer", "outerwear"].includes(tags.category);

/** Leg length is the subcategory: "shorts" versus any long trouser type. */
export const LEG_CHOICES = ["long", "short"] as const;
export type LegLength = (typeof LEG_CHOICES)[number];
export const isBottom = (tags: ItemTags) => tags.category === "bottom";
export const legOf = (tags: ItemTags): LegLength => (tags.subcategory === "shorts" ? "short" : "long");

/**
 * The subcategory for a leg-length choice. Going long restores the long type the garment had (or was proposed
 * with), else chinos, the most common long trouser in this wardrobe.
 */
export function subcategoryForLeg(leg: LegLength, current: ItemTags, longFallback?: ItemTags["subcategory"]): ItemTags["subcategory"] {
  if (leg === "short") return "shorts";
  if (current.subcategory !== "shorts") return current.subcategory;
  return longFallback && longFallback !== "shorts" ? longFallback : "chinos";
}

/**
 * Keeps the fields that follow from others consistent after a manual edit: category from subcategory, sleeve "na"
 * for garments without sleeves (a default "short" when a garment gains them), and the modesty flags that sleeve and
 * shorts imply. The engine filters on those flags (modesty rules), so a stale flag would hide or wrongly suggest it.
 */
export function normalizeTags(tags: ItemTags): ItemTags {
  const category = SUBCATEGORY_TO_CATEGORY[tags.subcategory];
  const sleeved = ["top", "layer", "outerwear"].includes(category);
  // Short is the default when a garment gains sleeves (Roy, 2026-11-10: "if unsure, default short").
  const sleeve = !sleeved ? "na" : tags.sleeve === "na" ? "short" : tags.sleeve;
  const flags = new Set(tags.modesty_flags);
  if (sleeve === "short" || sleeve === "sleeveless") flags.add("short_sleeve");
  else flags.delete("short_sleeve");
  if (tags.subcategory === "shorts") flags.add("short_pants");
  else flags.delete("short_pants");
  return { ...tags, category, sleeve, modesty_flags: [...flags] };
}

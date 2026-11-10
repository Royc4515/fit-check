import { SUBCATEGORY_TO_CATEGORY, type ItemTags } from "@fit-check/schema";

/** Sleeve choices offered to the user; "na" is implied for garments without sleeves and never shown. */
export const SLEEVE_CHOICES = ["short", "long", "sleeveless"] as const;

/** Only these slots have a sleeve to choose. */
export const hasSleeves = (tags: ItemTags) => ["top", "layer", "outerwear"].includes(tags.category);

/**
 * Keeps the fields that follow from others consistent after a manual edit: category from subcategory, sleeve "na"
 * for garments without sleeves (a default "long" when a garment gains them), and the modesty flags that sleeve and
 * shorts imply. The engine filters on those flags (modesty rules), so a stale flag would hide or wrongly suggest it.
 */
export function normalizeTags(tags: ItemTags): ItemTags {
  const category = SUBCATEGORY_TO_CATEGORY[tags.subcategory];
  const sleeved = ["top", "layer", "outerwear"].includes(category);
  const sleeve = !sleeved ? "na" : tags.sleeve === "na" ? "long" : tags.sleeve;
  const flags = new Set(tags.modesty_flags);
  if (sleeve === "short" || sleeve === "sleeveless") flags.add("short_sleeve");
  else flags.delete("short_sleeve");
  if (tags.subcategory === "shorts") flags.add("short_pants");
  else flags.delete("short_pants");
  return { ...tags, category, sleeve, modesty_flags: [...flags] };
}

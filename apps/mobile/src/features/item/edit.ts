import type { ColorName, Item, ItemTags } from "@fit-check/schema";
import { COLOR_HEX } from "../intake/palette";
import { normalizeTags, subcategoryForLeg, type LegLength } from "../intake/tagRules";

/** What `updateItemDetails` writes: the whole editable identity of an item in one row update. */
export type ItemDetailsPayload = { name: string; brand: string | null; tags: ItemTags };

/** One edit made on the item screen: a field of the identity, or a patch of tags (one tag, or the redraw's words). */
export type ItemChange = { name: string } | { brand: string } | { tags: Partial<ItemTags> };

/** The item screen's writes, injected so the screen also renders read-only (no session) and in the design gallery. */
export type ItemEdits = {
  /** Saves the full payload; resolves after the write. Throws on failure (the caller rolls back and says so). */
  save: (itemId: string, edit: ItemDetailsPayload) => Promise<void>;
  setImage: (itemId: string, cutoutPath: string, thumbPath: string | null) => Promise<void>;
  archive: (itemId: string) => Promise<void>;
  userId: string;
};

/**
 * The payload for "the item as it is now, plus one change": exactly what the old all-fields editor saved when that
 * one field was the only thing touched. Name and brand are trimmed, an empty name keeps the old one and an empty
 * brand is null; a tag patch goes through `normalizeTags` (category from subcategory, sleeve "na", modesty flags),
 * and tags that were not touched are written back as they are, unnormalised, as the editor did.
 * @returns the payload, or null when the change would write what is already stored (nothing to save).
 */
export function editPayload(item: Pick<Item, "name" | "brand" | "tags">, change: ItemChange): ItemDetailsPayload | null {
  const name = ("name" in change ? change.name : item.name).trim() || item.name;
  const brand = ("brand" in change ? change.brand : (item.brand ?? "")).trim() || null;
  const tags = "tags" in change ? normalizeTags({ ...item.tags, ...change.tags }) : item.tags;
  const same = name === item.name && brand === item.brand && JSON.stringify(tags) === JSON.stringify(item.tags);
  return same ? null : { name, brand, tags };
}

/*
 * Reversible picks. The old editor kept every pick as a draft against the item as it was when the editor opened, so
 * a pick that went back to that state restored it exactly. Here every pick saves at once, so the item keeps
 * changing; the two patches below therefore look at a BASELINE (the item's tags when the screen opened), not at the
 * last saved state. Otherwise jeans -> shorts -> long became chinos (the long fallback of shorts) and a colour changed
 * and changed back took the palette hex instead of the measured one (verification D12, 2026-11-18).
 */

/**
 * The colour patch for a picked colour name. The tagger measured a hex for the colour it saw; picking the baseline's
 * colour name gets that measured hex back, any other name takes the palette hex (the same values as the sheet
 * import), exactly as the old editor did against the item it was opened on.
 */
export function colorPatch(baseline: Pick<Item, "tags">, color: ColorName): Pick<ItemTags, "color_name" | "color_hex"> {
  return { color_name: color, color_hex: colorHexFor(baseline, color) };
}

/**
 * The subcategory patch for a picked leg length. Going back to the baseline's leg length restores the baseline's own
 * trouser type (jeans stay jeans); otherwise the same rule as the old editor (`subcategoryForLeg`, whose long fallback
 * was the type the editor opened with).
 */
export function legPatch(current: ItemTags, baseline: ItemTags, leg: LegLength): Pick<ItemTags, "subcategory"> {
  return { subcategory: subcategoryForLeg(leg, current, baseline.subcategory) };
}

/** The swatch hex for a colour name in this item's context: its measured hex for its own colour, else the palette. */
export function colorHexFor(item: Pick<Item, "tags">, color: ColorName): string {
  return color === item.tags.color_name ? item.tags.color_hex : COLOR_HEX[color];
}

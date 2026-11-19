import type { Item, Slot } from "@fit-check/schema";
import type { SavedOutfit } from "../../data/savedOutfit";

/*
 * The "לוקים" place's decisions with no I/O and no React (DESIGN.md "שלב 5.2" items 3-4): what the tabs show, how
 * many columns the grid has, what a tile and the outfit screen say about an outfit. The screens only render these.
 */

/** The two text tabs of the collection: every saved outfit, or only the favourites. */
export type OutfitsTab = "all" | "favorites";

/** The outfits a tab shows, in the collection's order (newest saved first, as the data layer returns them). */
export function visibleOutfits(outfits: readonly SavedOutfit[], tab: OutfitsTab): SavedOutfit[] {
  return tab === "favorites" ? outfits.filter((o) => o.isFavorite) : [...outfits];
}

/** Grid columns by window width: 2 up to 599, 3 up to 899, 4 from 900 (DESIGN.md "שלב 5.2" item 3). */
export function outfitGridColumns(windowWidth: number): 2 | 3 | 4 {
  if (windowWidth < 600) return 2;
  if (windowWidth < 900) return 3;
  return 4;
}

/** Each tile's width for a content width, a column count and the 8 gap; floored so a row never wraps on rounding. */
export function outfitTileWidth(contentWidth: number, columns: number, gap: number): number {
  return Math.floor((contentWidth - gap * (columns - 1)) / columns);
}

/** Separator of the garment types in a caption ("פולו · צ'ינו · סניקרס"). */
export const TYPE_SEPARATOR = " · ";

/**
 * What a tile and the outfit screen call an outfit: its name, or, without one, the garment types in reading order
 * joined with " · " (`named: false`, so the outfit screen can say "לוק בלי שם" instead). A missing garment adds no
 * type: the caption names what is there.
 * @param typeOf - the garment type in the active language (`item.subcategory.<sub>`).
 */
export function outfitCaption(
  outfit: { name: string | null; pieces: readonly { item: Pick<Item, "tags"> }[] },
  typeOf: (subcategory: string) => string
): { text: string; named: boolean } {
  if (outfit.name) return { text: outfit.name, named: true };
  return { text: outfit.pieces.map((p) => typeOf(p.item.tags.subcategory)).join(TYPE_SEPARATOR), named: false };
}

/** The wear line's data: never worn, or how many times and the last date (yyyy-mm-dd). */
export type WornMeta = { kind: "never" } | { kind: "worn"; count: number; last: string };

/** See WornMeta. A count without a date (impossible from the data layer) reads as never worn rather than a blank. */
export function wornMeta(outfit: Pick<SavedOutfit, "wornCount" | "lastWornOn">): WornMeta {
  if (outfit.wornCount <= 0 || outfit.lastWornOn === null) return { kind: "never" };
  return { kind: "worn", count: outfit.wornCount, last: outfit.lastWornOn };
}

/** Reading order of the slots; the 01-04 numbers follow it. */
const SLOT_ORDER: readonly Slot[] = ["top", "bottom", "shoes", "layer"];

/** One legend row of the outfit screen: its number, its slot, and the garment, or null when it was deleted. */
export type LegendEntry = { index: string; slot: Slot; item: Item | null };

/**
 * The outfit's legend in reading order, missing garments included, so the numbers on the flat-lay and in the legend
 * agree and a deleted garment keeps its place (and number) instead of shifting the rest up.
 * @param resolve - the garment as the screen should show it (the wardrobe's current copy when it has one).
 */
export function legendEntries(outfit: Pick<SavedOutfit, "pieces" | "missing">, resolve: (item: Item) => Item = (i) => i): LegendEntry[] {
  const present = new Map(outfit.pieces.map((p) => [p.slot, p.item] as const));
  const slots = SLOT_ORDER.filter((s) => present.has(s) || outfit.missing.includes(s));
  return slots.map((slot, n) => {
    const item = present.get(slot);
    return { index: String(n + 1).padStart(2, "0"), slot, item: item ? resolve(item) : null };
  });
}

/** Garments of the outfit that are not at home now (laundry, base, lent), in reading order. */
export function awayGarments(entries: readonly LegendEntry[]): Item[] {
  return entries.flatMap((e) => (e.item && e.item.availability !== "home" ? [e.item] : []));
}

/** The list with one outfit's favourite flag set (an optimistic write, or its roll back). */
export function withFavorite(outfits: readonly SavedOutfit[], id: string, favorite: boolean): SavedOutfit[] {
  return outfits.map((o) => (o.id === id ? { ...o, isFavorite: favorite } : o));
}

/** The list with one outfit renamed. */
export function withName(outfits: readonly SavedOutfit[], id: string, name: string | null): SavedOutfit[] {
  return outfits.map((o) => (o.id === id ? { ...o, name } : o));
}

/** The list without one outfit (removed from the collection). */
export function withoutOutfit(outfits: readonly SavedOutfit[], id: string): SavedOutfit[] {
  return outfits.filter((o) => o.id !== id);
}

/** The list with one outfit put in (fetched alone by a deep link) or replaced, keeping the newest-saved-first order. */
export function withOutfit(outfits: readonly SavedOutfit[], outfit: SavedOutfit): SavedOutfit[] {
  const rest = outfits.filter((o) => o.id !== outfit.id);
  const time = (o: SavedOutfit) => Date.parse(o.savedAt);
  return [...rest, outfit].sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

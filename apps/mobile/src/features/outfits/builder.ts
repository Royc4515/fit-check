import { orderByCompatibility, slotOf, type PairWeights } from "@fit-check/engine";
import type { ContextType, Item, Slot } from "@fit-check/schema";
import { REQUIRED_SLOTS, type OutfitPiece, type SavedOutfit } from "../../data/savedOutfit";
import { byName, listed, matchesQuery } from "../wardrobe/filters";

/*
 * The build screen's decisions with no I/O and no React (DESIGN.md "שלב 5.2" item 5): what a draft holds, what is
 * missing, whether anything changed, and which garments the picker offers in what order. BuilderView only renders.
 */

/** The four slots in reading order; the legend's 01-04 follow it. */
export const BUILDER_SLOTS: readonly Slot[] = ["top", "bottom", "shoes", "layer"];

/** "למתי": the six choices of the chip row, in its order. Default: the first. */
export const BUILDER_CONTEXTS = ["weekday", "shabbat", "holiday", "date", "interview", "event"] as const satisfies readonly ContextType[];

/** A name may be at most this long (SAVED_OUTFIT_NAME_MAX); the counter shows from 10 before it. */
export const NAME_MAX = 40;
export const NAME_COUNTER_FROM = NAME_MAX - 10;

/** What the build screen is holding: one garment per chosen slot, "למתי", the name as typed. */
export type Draft = { pieces: Partial<Record<Slot, Item>>; contextType: ContextType; name: string };

/** A new outfit: nothing chosen, "יום חול", no name. */
export function emptyDraft(): Draft {
  return { pieces: {}, contextType: "weekday", name: "" };
}

/**
 * A saved outfit as a draft for editing: its garments (the wardrobe's current copy when there is one), its context and
 * its name. A garment deleted from the wardrobe is not in `pieces`, so its slot opens empty.
 * @param resolve - the garment as the screen should show it.
 */
export function draftFromOutfit(outfit: Pick<SavedOutfit, "pieces" | "contextType" | "name">, resolve: (item: Item) => Item = (i) => i): Draft {
  const pieces: Partial<Record<Slot, Item>> = {};
  for (const p of outfit.pieces) pieces[p.slot] = resolve(p.item);
  return { pieces, contextType: outfit.contextType, name: outfit.name ?? "" };
}

/** The draft with one slot set to a garment, or cleared (null). */
export function withPiece(draft: Draft, slot: Slot, item: Item | null): Draft {
  const pieces = { ...draft.pieces };
  if (item) pieces[slot] = item;
  else delete pieces[slot];
  return { ...draft, pieces };
}

/** The draft's garments as `outfit_items` rows, in reading order. */
export function draftPieces(draft: Draft): OutfitPiece[] {
  return BUILDER_SLOTS.flatMap((slot) => {
    const item = draft.pieces[slot];
    return item ? [{ item_id: item.id, slot }] : [];
  });
}

/** Required slots with no garment, in reading order (top, bottom, shoes). Empty = "שמור" is enabled. */
export function missingSlots(draft: Draft): Slot[] {
  return REQUIRED_SLOTS.filter((slot) => !draft.pieces[slot]);
}

/**
 * The key of the "what is missing" line under `builder.missing`, one per combination, so each language words every
 * case itself (Hebrew agrees the verb with the nouns: "חסר חלק עליון", "חסרים מכנסיים", "חסרות נעליים", "חסרים חלק
 * עליון ונעליים"). Null when nothing is missing.
 */
export function missingKey(missing: readonly Slot[]): string | null {
  const required = REQUIRED_SLOTS.filter((s) => missing.includes(s));
  if (required.length === 0) return null;
  if (required.length === REQUIRED_SLOTS.length) return "all";
  return required.join("_");
}

/**
 * Whether leaving now would lose something: a garment, "למתי" or the name differs from what the screen opened with.
 * A name that differs only in surrounding spaces is the same name (that is how it is stored).
 */
export function isDirty(draft: Draft, initial: Draft): boolean {
  if (draft.contextType !== initial.contextType) return true;
  if (draft.name.trim() !== initial.name.trim()) return true;
  return BUILDER_SLOTS.some((slot) => draft.pieces[slot]?.id !== initial.pieces[slot]?.id);
}

/** Whether the draft's garment set differs from the one the screen opened with (any order is the same set). */
export function garmentsChanged(draft: Draft, initial: Draft): boolean {
  const ids = (d: Draft) => draftPieces(d).map((p) => p.item_id).sort().join(",");
  return ids(draft) !== ids(initial);
}

/**
 * Whether saving this edit will keep the worn outfit for history and save a new one in its place (the data layer's
 * `copy`, DESIGN.md "שלב 5.2" item 4): an edit, of an outfit with any wear, whose garments now differ. The screen says
 * so above "שמור" exactly then.
 * @param wearCount - every `wears` row of the outfit being edited (any feedback); 0 for a new outfit.
 */
export function editKeepsWornCopy(editing: boolean, wearCount: number, draft: Draft, initial: Draft): boolean {
  return editing && wearCount > 0 && garmentsChanged(draft, initial);
}

/** Code points, as the database counts a name. */
export function nameLength(name: string): number {
  return [...name].length;
}

/**
 * The garments the picker offers for a slot, in the order it shows them:
 * - every listed (active, so not archived) garment whose type maps to the slot (the engine's `slotOf`), wherever it
 *   is: one that is not at home can be chosen (a saved outfit is not only for today); the screen dims it;
 * - matching the search like the wardrobe's (name or brand, any case, Hebrew and Latin);
 * - before any other slot has a garment: the wardrobe's order (by name); once one has: by the engine's compatibility
 *   with the garments already chosen in the other slots, best first, ties in the wardrobe's order.
 * @param items - the whole wardrobe as loaded (every status).
 */
export function pickerItems(items: readonly Item[], slot: Slot, query: string, draft: Draft, weights: PairWeights): Item[] {
  const pool = listed(items)
    .filter((i) => slotOf(i) === slot && matchesQuery(i, query))
    .sort(byName);
  const others = BUILDER_SLOTS.flatMap((s) => {
    const item = draft.pieces[s];
    return s !== slot && item ? [item] : [];
  });
  return orderByCompatibility(pool, others, weights);
}

/** The picker draws this many tiles first, and this many more for each "הצג עוד". */
export const PICKER_PAGE = 30;

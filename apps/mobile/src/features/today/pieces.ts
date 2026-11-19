import type { CandidateOutfit, Item } from "@fit-check/schema";

/** Reading order of an outfit: top, bottom, shoes, layer. The flat-lay numbers and the captions share it. */
export const SLOT_ORDER = ["top", "bottom", "shoes", "layer"] as const;

/**
 * "01".."04" for an item by reading order, so a garment's number on the flat-lay and its caption always agree.
 * @returns "00" when the id is not in the outfit (a caller bug, visible rather than thrown).
 */
export function outfitIndex(items: CandidateOutfit["items"], id: string): string {
  const ordered = SLOT_ORDER.flatMap((slot) => items.filter((i) => i.slot === slot));
  return String(ordered.findIndex((i) => i.id === id) + 1).padStart(2, "0");
}

/**
 * The outfit as corrected after wearing ("wore something else?", DESIGN.md "שלב 5.1" item 1): the recorded pieces
 * with one garment replaced by the alternative chosen for it, in the same order. A replaced id that is not in the
 * outfit leaves it as it is.
 */
export function correctedPieces(worn: readonly Item[], replacedId: string, replacement: Item): Item[] {
  return worn.map((i) => (i.id === replacedId ? replacement : i));
}

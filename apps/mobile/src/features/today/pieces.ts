import type { CandidateOutfit } from "@fit-check/schema";

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

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

/** Whether the one-time tap hint is shown on this visit: undecided until measured, then shown or held back. */
export type HintFit = "show" | "hide" | null;

/**
 * The tap hint's place above the hero (DESIGN.md "שלב 5.1" item 2): shown only when the flat-lay keeps at least its
 * floor with the hint there; otherwise held back for this visit (the device flag stays unset, so it comes back on a
 * later visit with room). Decided once from the free space measured WITHOUT the hint and the hint's known height,
 * then only ever withdrawn (a line arriving later can take its room), so it can never oscillate.
 *
 * @param args.decided The decision so far on this visit.
 * @param args.space The hero's free height as measured now (with the hint in it when it is shown).
 * @param args.floor The hero's minimum height.
 * @param args.hintBlock The height the hint takes when drawn.
 * @param args.desktop Desktop puts the line in the text column: it never takes the hero's room.
 */
export function tapHintFit(args: { decided: HintFit; measured: boolean; space: number; floor: number; hintBlock: number; desktop: boolean }): HintFit {
  const { decided, measured, space, floor, hintBlock, desktop } = args;
  if (desktop) return "show";
  if (!measured) return decided;
  if (decided === null) return space - hintBlock >= floor ? "show" : "hide";
  if (decided === "show" && space < floor) return "hide";
  return decided;
}

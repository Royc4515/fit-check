import type { ContextType, OutfitSource } from "@fit-check/schema";
import { itemSetKey, findSameOutfit, outfitProblems, type OutfitPiece } from "../../data/savedOutfit";

/*
 * Saving an outfit from Today (DESIGN.md "שלב 5.2" item 6), with no I/O and no React: whether the bookmark shows, which
 * write it makes, and which outfit row a wear points at. The screen and the hook only call these, so the node test
 * runner covers every decision. "Same garments = same outfit" is decided by `itemSetKey` / `findSameOutfit` of the
 * data layer, never by a second key here.
 */

/** A saved outfit as Today needs it: its row id and the garments in it. */
export type SavedLookup = readonly { id: string; itemIds: readonly string[] }[];

/** What a press on the bookmark writes when the shown outfit is not saved. */
export type SaveWrite =
  /** A suggestion: a new saved `outfits` row (the data layer returns the existing one when the set is already saved). */
  | { op: "save"; date: string; contextType: ContextType; source: Extract<OutfitSource, "daily" | "swap">; pieces: OutfitPiece[] }
  /** A worn outfit: the row the wear already points at gets `saved_at`, so no second row is created. */
  | { op: "mark"; outfitId: string };

/**
 * The bookmark for the outfit shown on the selected tab.
 * - `hidden`: the outfit cannot be a saved outfit (no shoes on Yom Kippur, or any set the data layer would refuse).
 * - `saved`: its garment set equals a saved outfit's; a press removes that one.
 * - `unsaved`: a press makes `write`.
 * `key` is the garment set (order-free): an optimistic state belongs to one key, so a swap, which changes the set,
 * leaves it behind at once.
 */
export type BookmarkIntent =
  | { kind: "hidden" }
  | { kind: "saved"; key: string; savedId: string }
  | { kind: "unsaved"; key: string; write: SaveWrite };

/**
 * Decides the bookmark. Pure.
 *
 * Failure modes: none thrown. Pieces that are not a saveable outfit (outfitProblems) give `hidden`, which includes
 * no pieces at all. A worn outfit whose row is already saved is found by its garment set, so it is `saved` and never
 * reaches `mark`.
 *
 * @param args.pieces - the outfit as shown, after swaps: one `{ item_id, slot }` per garment.
 * @param args.saved - the saved outfits read so far (empty until the read answers: the caller keeps the toggle disabled
 *   until then, since this function cannot tell "none saved" from "not read yet").
 * @param args.wornOutfitId - the `outfits` row of the wear recorded for this tab's date, or null for a suggestion.
 * @param args.date - the tab's date: `created_for_date` of a new saved outfit.
 * @param args.contextType - the context the tab was planned under (weekday, shabbat, holiday, or the occasion).
 * @param args.source - `swap` when any garment of the shown outfit was swapped in, else `daily`.
 */
export function bookmarkIntent(args: {
  pieces: readonly OutfitPiece[];
  saved: SavedLookup;
  wornOutfitId: string | null;
  date: string;
  contextType: ContextType;
  source: "daily" | "swap";
}): BookmarkIntent {
  const { pieces, saved, wornOutfitId, date, contextType, source } = args;
  if (outfitProblems(pieces).length > 0) return { kind: "hidden" };
  const ids = pieces.map((p) => p.item_id);
  const key = itemSetKey(ids);
  const savedId = findSameOutfit(
    saved.map((o) => ({ id: o.id, itemIds: o.itemIds })),
    ids
  );
  if (savedId) return { kind: "saved", key, savedId };
  if (wornOutfitId !== null) return { kind: "unsaved", key, write: { op: "mark", outfitId: wornOutfitId } };
  return { kind: "unsaved", key, write: { op: "save", date, contextType, source, pieces: [...pieces] } };
}

/**
 * The outfit row a wear of these garments points at: the saved outfit with exactly this set (any order), or undefined
 * for "write a new, unsaved row" (the recording as it was before saved outfits). Used by "wearing it", "I'll wear it
 * on Shabbat" and by a correction, whose corrected set may itself be a saved outfit. Pure.
 *
 * @param itemIds - the garments being worn.
 * @param saved - the saved outfits read so far; before the read answers it is empty and the wear gets a new row.
 */
export function wearOutfitId(itemIds: readonly string[], saved: SavedLookup): string | undefined {
  return (
    findSameOutfit(
      saved.map((o) => ({ id: o.id, itemIds: o.itemIds })),
      itemIds
    ) ?? undefined
  );
}

/**
 * The bookmark as drawn: an optimistic state wins while it belongs to the garment set on screen, else what the store
 * says. `pending` is the state a press has already shown and not yet confirmed.
 */
export function shownSaved(intent: BookmarkIntent, pending: { key: string; saved: boolean } | null): boolean {
  if (intent.kind === "hidden") return false;
  return pending !== null && pending.key === intent.key ? pending.saved : intent.kind === "saved";
}

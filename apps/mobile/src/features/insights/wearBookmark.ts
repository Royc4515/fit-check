import { findSameOutfit, itemSetKey, outfitProblems, type OutfitPiece } from "../../data/savedOutfit";
import type { BookmarkFailureInfo, BookmarkIntent, SavedLookup } from "../today/bookmark";

/*
 * Saving a worn outfit from Insights (DESIGN.md "שלב 5.2" item 7), with no I/O and no React: which state a row's
 * bookmark is in and what a press writes. "Saved" is decided by GARMENT SET through the data layer's own key
 * (`itemSetKey` / `findSameOutfit`), never by the row id: the same garments are the same outfit, so two worn rows with
 * one set show one state and change together.
 */

/** A worn outfit as the bookmark needs it (a subset of WearSummary["outfits"][number]). */
export type WornRow = { outfitId: string; itemIds: readonly string[]; savePieces: readonly OutfitPiece[] };

/**
 * One row's bookmark.
 * - `saved`: a saved outfit has exactly these garments; a press removes that one (`savedId`, which may be another row).
 * - `unsaved`: a press marks this row's own outfit as saved.
 * - `unsaveable`: the garments cannot be a saved outfit any more (one was deleted); there is nothing to press.
 * `key` is the order-free garment set: an optimistic state belongs to one key, so every row of the set follows it.
 */
export type WearBookmark = Exclude<BookmarkIntent, { kind: "hidden" }> | { kind: "unsaveable"; key: string };

/**
 * The state of one worn row. Pure.
 *
 * The saved set wins over `unsaveable`: a set that is in the collection is shown as saved (and can be removed) even
 * if this row's own garment list is damaged. Failure modes: none thrown.
 *
 * @param row - the worn row.
 * @param saved - the saved outfits read so far; the caller keeps the bookmark disabled until the read has answered,
 *   because an empty list here cannot tell "none saved" from "not read yet".
 */
export function wearBookmark(row: WornRow, saved: SavedLookup): WearBookmark {
  const key = itemSetKey(row.itemIds);
  const savedId = findSameOutfit(saved.map((o) => ({ id: o.id, itemIds: o.itemIds })), row.itemIds);
  if (savedId) return { kind: "saved", key, savedId };
  if (outfitProblems(row.savePieces).length > 0) return { kind: "unsaveable", key };
  return { kind: "unsaved", key, write: { op: "mark", outfitId: row.outfitId } };
}

/** Whether the bookmark is drawn filled: an optimistic state wins while it belongs to this row's garment set. */
export function wearShownSaved(bookmark: WearBookmark, pending: { key: string; saved: boolean } | null): boolean {
  if (bookmark.kind === "unsaveable") return false;
  return pending !== null && pending.key === bookmark.key ? pending.saved : bookmark.kind === "saved";
}

/** What a failure line shows. */
export type WearFailureLine =
  /** The wish is already met, or the row is gone: no line. */
  | { kind: "none" }
  /** "Try again": `intent` is the press of the CURRENT state, which is not necessarily the one that failed. */
  | { kind: "retry"; wantSaved: boolean; intent: Exclude<WearBookmark, { kind: "unsaveable" }> }
  /** The outfit cannot be saved any more: the line says so and offers nothing. */
  | { kind: "cannotSave" };

/**
 * Whether a failure line is shown and what "try again" does, recomputed from the current rows every time (never a
 * replay of the press that failed: the outfit may have been saved or removed meanwhile, from another row or another
 * screen). Pure.
 *
 * @param failure - the failed press: the garment set and whether the user wanted it saved. `unsaveable` is true when
 *   the data layer said `invalid_outfit`.
 * @param current - the bookmark of any row with that garment set as it is now, or null when no such row is listed.
 */
export function wearFailureLine(failure: BookmarkFailureInfo & { unsaveable: boolean }, current: WearBookmark | null): WearFailureLine {
  if (!current || current.key !== failure.key) return { kind: "none" };
  if (current.kind === "unsaveable") return { kind: "cannotSave" };
  if ((current.kind === "saved") === failure.wantSaved) return { kind: "none" };
  // The write refused the outfit although the read said it was fine (a garment deleted since): no retry could pass.
  if (failure.unsaveable && failure.wantSaved) return { kind: "cannotSave" };
  return { kind: "retry", wantSaved: failure.wantSaved, intent: current };
}

/** The first row with this garment set, as the bookmark sees it now; null when none is listed. */
export function bookmarkOfKey(rows: readonly WornRow[], saved: SavedLookup, key: string): WearBookmark | null {
  for (const row of rows) {
    const b = wearBookmark(row, saved);
    if (b.key === key) return b;
  }
  return null;
}

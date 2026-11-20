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

/** The saved list as the store holds it: `loading` (not answered yet), `error` (the first read failed), `ready`. */
export type SavedListState = { status: "loading" | "ready" | "error"; outfits: SavedLookup };

/**
 * What a write of feedback (worn, the Shabbat wear, skipped, corrected) does about its outfit row, from the state of
 * the saved list: `row` (decided: the saved outfit's id, or undefined for a new unsaved row), `wait` (the list has not
 * answered yet) or `reread` (it failed: read it once more). A row is never decided from a list that has not arrived,
 * since an empty placeholder would write a copy of a saved outfit. Pure.
 */
export type WearRowDecision = { kind: "row"; id: string | undefined } | { kind: "wait" } | { kind: "reread" };

/** See WearRowDecision. */
export function wearRowDecision(itemIds: readonly string[], list: SavedListState): WearRowDecision {
  if (list.status === "ready") return { kind: "row", id: wearOutfitId(itemIds, list.outfits) };
  return list.status === "loading" ? { kind: "wait" } : { kind: "reread" };
}

/** Thrown when the saved list cannot be read: the write fails instead of writing a copy of a saved outfit. */
export class SavedListUnavailableError extends Error {
  constructor() {
    super("the saved outfits could not be read");
    this.name = "SavedListUnavailableError";
  }
}

/** The store, as the resolver needs it. */
export type SavedListDeps = {
  read: () => SavedListState;
  /** Resolves when the list is no longer `loading`, or after `ms`. */
  settled: (ms: number) => Promise<void>;
  /** One fresh read of the list. */
  reread: () => Promise<void>;
};

/** How long a write waits for a list that is still loading before treating it as failed. */
export const SAVED_LIST_WAIT_MS = 8000;

/**
 * The outfit row a feedback write points at, decided at write time from a settled list: waits (up to 8 s) while the
 * list loads, reads once more when it failed or the wait ran out, and only then decides (wearRowDecision).
 *
 * @returns the saved outfit's id, or undefined for a new unsaved row.
 * @throws SavedListUnavailableError when the list is still unavailable after that one fresh read. The caller's write
 *   then fails like any failed wear (its failure line and "try again"): without the list the rule "the same garments
 *   are the same outfit" cannot be honoured, and a read that fails almost always means the write would fail too.
 */
export async function resolveWearRow(itemIds: readonly string[], deps: SavedListDeps, waitMs: number = SAVED_LIST_WAIT_MS): Promise<string | undefined> {
  let decision = wearRowDecision(itemIds, deps.read());
  if (decision.kind === "wait") {
    await deps.settled(waitMs);
    decision = wearRowDecision(itemIds, deps.read());
    if (decision.kind === "wait") decision = { kind: "reread" };
  }
  if (decision.kind === "reread") {
    await deps.reread();
    decision = wearRowDecision(itemIds, deps.read());
  }
  if (decision.kind === "row") return decision.id;
  throw new SavedListUnavailableError();
}

/** A failed save or removal: the garment set and day it was for, and whether the user wanted it saved. Not an action. */
export type BookmarkFailureInfo = { key: string; date: string; wantSaved: boolean };

/**
 * What a failed bookmark write means, by the data layer's error code (`undefined` for any other error). Pure.
 * - `met`: a REMOVE that found the outfit already gone or already not saved (`not_saved`, `not_found`): the user's wish
 *   is true, so there is no error line; the caller reads the saved list again so the shape follows the truth.
 * - `unsaveable`: the outfit cannot be saved (`invalid_outfit`, or a SAVE whose worn row is gone, `not_found`): the line
 *   says so and offers no retry, since no retry could pass.
 * - `failed`: anything else: the error line with "try again".
 */
export function writeFailureKind(wantSaved: boolean, code: string | undefined): "met" | "unsaveable" | "failed" {
  if (code === "invalid_outfit") return "unsaveable";
  if (wantSaved) return code === "not_found" ? "unsaveable" : "failed";
  return code === "not_saved" || code === "not_found" ? "met" : "failed";
}

/**
 * Whether a failure line still belongs to what is on screen. `show` only while the same garment set on the same day is
 * still not in the state the user asked for; then "try again" is recomputed from the CURRENT intent (the outfit may
 * have been worn since, so the write is `markOutfitSaved` of the worn row, not the save that failed). `drop` when the
 * set changed (a swap, another tab), the outfit can no longer be saved, or the state already is what was wanted.
 */
export function bookmarkFailureAction(failure: BookmarkFailureInfo, intent: BookmarkIntent, selectedDate: string): "show" | "drop" {
  if (intent.kind === "hidden" || failure.key !== intent.key || failure.date !== selectedDate) return "drop";
  return (intent.kind === "saved") === failure.wantSaved ? "drop" : "show";
}

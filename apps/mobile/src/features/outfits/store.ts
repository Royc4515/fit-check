import { useSyncExternalStore } from "react";
import { fetchSavedOutfit, fetchSavedOutfits, fetchWornTally, removeSavedOutfit, renameOutfit, saveOutfit, setOutfitFavorite, updateSavedOutfit, type EditResult, type SaveResult } from "../../data/outfits";
import { withTallyChange, wornTallyOf, type SavedOutfit, type UpdateOutfitInput, type WornIndex, type WornTally } from "../../data/savedOutfit";
import { withFavorite, withName, withOutfit, withoutOutfit, withWornChange } from "./collection";

/**
 * The saved outfits as the "לוקים" place shows them, shared by the collection and the outfit screen, so a favourite,
 * a rename or a removal made on one is already true on the other (the collection tab stays mounted under the outfit
 * screen). Supabase stays the source of truth (CLAUDE.md): this is a cache of the last read plus the optimistic
 * writes on top of it, and every focus of the collection reads again.
 *
 * Module state, keyed by user: a different signed-in user starts from an empty cache, never another user's outfits.
 */
export type OutfitsState =
  | { status: "loading"; outfits: readonly SavedOutfit[] }
  | { status: "error"; outfits: readonly SavedOutfit[] }
  | { status: "ready"; outfits: readonly SavedOutfit[] };

const EMPTY: OutfitsState = { status: "loading", outfits: [] };
let owner: string | null = null;
let state: OutfitsState = EMPTY;
// Bumped by every read and every local change: a read that started before a change must not overwrite it.
let version = 0;
const listeners = new Set<() => void>();

function emit(next: OutfitsState): void {
  state = next;
  for (const l of listeners) l();
}

function own(userId: string): void {
  if (owner === userId) return;
  owner = userId;
  version += 1;
  tallyVersion += 1;
  state = EMPTY;
  tally = TALLY_EMPTY;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The collection for `userId`, re-rendering on every change. */
export function useSavedOutfits(userId: string): OutfitsState {
  own(userId);
  return useSyncExternalStore(subscribe, () => (owner === userId ? state : EMPTY));
}

/**
 * Reads the collection again. The last good list stays on screen while it runs, and a failed read after a good one
 * keeps it; only a failure with nothing to show becomes the error state. A read that overlaps a local change (a
 * favourite tapped meanwhile) is dropped rather than undoing that change; the next focus reads again.
 */
export async function refreshOutfits(userId: string): Promise<void> {
  own(userId);
  const at = ++version;
  if (state.status === "error") emit({ status: "loading", outfits: state.outfits });
  try {
    const outfits = await fetchSavedOutfits();
    if (owner === userId && at === version) emit({ status: "ready", outfits });
  } catch (error) {
    console.error("Saved outfits read failed", error);
    if (owner === userId && at === version && state.status !== "ready") emit({ status: "error", outfits: state.outfits });
  }
}

/**
 * One outfit for the outfit screen: from the cache when it is there, else read alone (a deep link, a reload) and put
 * into the cache. Null = no such saved outfit. Throws on a network or permission error.
 */
export async function loadOutfit(userId: string, id: string): Promise<SavedOutfit | null> {
  own(userId);
  const cached = state.outfits.find((o) => o.id === id);
  if (cached) return cached;
  const outfit = await fetchSavedOutfit(id);
  if (outfit && owner === userId) {
    version += 1;
    emit({ ...state, outfits: withOutfit(state.outfits, outfit) });
  }
  return outfit;
}

/**
 * The list's state right now, for an action that must decide at the moment it runs (which row a wear points at):
 * `loading` for another user, so nothing of theirs is ever used.
 */
export function listNow(userId: string): OutfitsState {
  return owner === userId ? state : EMPTY;
}

/** Resolves when the list is no longer `loading`, or after `ms`, whichever comes first. */
export function whenSettled(userId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (listNow(userId).status !== "loading") return resolve();
    const done = () => {
      clearTimeout(timer);
      listeners.delete(check);
      resolve();
    };
    const check = () => {
      if (listNow(userId).status !== "loading") done();
    };
    const timer = setTimeout(done, ms);
    listeners.add(check);
  });
}

/** A local change (optimistic write, roll back, removal): applied at once, and wins over a read in flight. */
export function patchOutfits(userId: string, change: (outfits: readonly SavedOutfit[]) => SavedOutfit[]): void {
  if (owner !== userId) return;
  version += 1;
  emit({ ...state, outfits: change(state.outfits) });
}

// Favourite writes on their way, by outfit: a second tap while one is in flight is ignored, so a roll back can never
// land on top of a newer choice.
const favoriteInFlight = new Set<string>();

/**
 * Favourite on or off, optimistically: the heart changes at once and changes back if the write fails.
 * @returns "ok", "busy" (a write for this outfit is already on its way; nothing was done), or the error thrown.
 */
export async function toggleFavorite(userId: string, id: string, favorite: boolean): Promise<"ok" | "busy" | { error: unknown }> {
  if (favoriteInFlight.has(id)) return "busy";
  favoriteInFlight.add(id);
  patchOutfits(userId, (list) => withFavorite(list, id, favorite));
  try {
    await setOutfitFavorite(id, favorite);
    return "ok";
  } catch (error) {
    console.error("Favourite write failed", id, error);
    patchOutfits(userId, (list) => withFavorite(list, id, !favorite));
    return { error };
  } finally {
    favoriteInFlight.delete(id);
  }
}

/** Renames after the write succeeded (writing in place shows its own busy, saved and failed states). Throws on failure. */
export async function renameSavedOutfit(userId: string, id: string, name: string): Promise<void> {
  const stored = await renameOutfit(id, name);
  patchOutfits(userId, (list) => withName(list, id, stored));
}

/** Removes from the collection after the write succeeded; the outfit screen closes only then. Throws on failure. */
export async function removeFromCollection(userId: string, id: string): Promise<void> {
  await removeSavedOutfit(id);
  patchOutfits(userId, (list) => withoutOutfit(list, id));
}

/**
 * Saves an outfit built by hand and puts it into the collection at once (created or found), so the collection and
 * the outfit screen opened next already have it. Same inputs and failure modes as `saveOutfit` (data/outfits.ts);
 * on any failure nothing is put in and the error is thrown.
 */
export async function createSavedOutfit(userId: string, args: Parameters<typeof saveOutfit>[0]): Promise<SaveResult> {
  const result = await saveOutfit(args);
  patchOutfits(userId, (list) => withOutfit(list, result.outfit));
  return result;
}

/**
 * Edits a saved outfit (`updateSavedOutfit`) and puts the result into the collection: the same row replaced, or, when
 * the edit became a new row (a worn outfit's garments changed), the old one dropped and the new one added (same
 * `saved_at`, so the same place). On failure the collection is read again (best effort): a half-written edit (two saved
 * rows, or a row with extra garments) must not be shown as if nothing happened; the error is thrown either way.
 */
export async function editSavedOutfit(userId: string, id: string, changes: UpdateOutfitInput): Promise<EditResult> {
  try {
    const result = await updateSavedOutfit(id, changes);
    patchOutfits(userId, (list) => withOutfit(result.replacedId ? withoutOutfit(list, result.replacedId) : list, result.outfit));
    return result;
  } catch (error) {
    void refreshOutfits(userId);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The tally: how often each set of garments was worn (DESIGN.md "שלב 5.2": the same garments are the same outfit)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The worn-wear tally by garment set, its own slice beside the list, so nothing that waits for the saved list (Today's
 * first suggestion, the bookmark, the tiles) waits for the whole wear history. Requested only by the collection and the
 * outfit screen (and their focus), never by Today. `index` is the last GOOD answer: `loading` before the first one
 * (null), `ready` after it, `error` after a failed read (the last good index is kept, null if there never was one).
 * The screens show a count whenever `index` is not null, and an empty line otherwise.
 */
export type TallyState = { status: "loading" | "ready" | "error"; index: WornIndex | null };

const TALLY_EMPTY: TallyState = { status: "loading", index: null };
let tally: TallyState = TALLY_EMPTY;
// Bumped by every tally read and every optimistic patch: a read that started before a patch must not overwrite it.
let tallyVersion = 0;

function emitTally(next: TallyState): void {
  tally = next;
  for (const l of listeners) l();
}

/** The tally for `userId`, re-rendering on every change. */
export function useWornTally(userId: string): TallyState {
  own(userId);
  return useSyncExternalStore(subscribe, () => (owner === userId ? tally : TALLY_EMPTY));
}

/** The tally right now, outside React (like `listNow`); the empty `loading` state for another user. */
export function tallyNow(userId: string): TallyState {
  return owner === userId ? tally : TALLY_EMPTY;
}

/**
 * The tally of one outfit's garments in a tally state, or null when there is nothing to say (no good answer yet or
 * ever): `wornMeta(null)` is the empty line. Never the row's own count.
 */
export function tallyFor(state: TallyState, itemIds: readonly string[]): WornTally | null {
  return state.index === null ? null : wornTallyOf(state.index, itemIds);
}

/**
 * Reads the tally again. The last good index stays while it runs; a failed read (network, permission, or more wears than
 * the pager reads) keeps it and only sets `error`; with nothing good to keep, the screens show no count. A read that
 * overlaps an optimistic patch is dropped (the patch's own refresh follows). Never throws.
 */
export async function refreshTally(userId: string): Promise<void> {
  own(userId);
  const at = ++tallyVersion;
  if (tally.status === "error") emitTally({ status: "loading", index: tally.index });
  try {
    const index = await fetchWornTally();
    if (owner === userId && at === tallyVersion) emitTally({ status: "ready", index });
  } catch (error) {
    console.error("Worn tally read failed", error);
    if (owner === userId && at === tallyVersion) emitTally({ status: "error", index: tally.index });
  }
}

/**
 * A wear recorded (+1) or undone (-1) anywhere (Today now, the outfit screen's "לובש היום" later), keyed by the SET of
 * garments, not by row: the tally moves at once (count by one; the date only forward on a wear), and the list's own
 * counts for the pointed-at row move too (`withWornChange`, what removal and editing decide by). Then the tally is read
 * again in the background so the date after an undo, and a wear on an unsaved row of a saved set, come right; that
 * refresh is skipped when no screen ever asked for the tally (nothing shows it, and the next focus reads it anyway).
 * Only `worn` feedback is passed here.
 * @param record - the row the wear points at, its garment ids (any order) and its date (yyyy-mm-dd).
 */
export function recordWornChange(userId: string, record: { outfitId: string; itemIds: readonly string[]; date: string }, delta: 1 | -1): void {
  patchOutfits(userId, (list) => withWornChange(list, record.outfitId, delta, record.date));
  if (owner !== userId || tally.index === null) return;
  tallyVersion += 1;
  emitTally({ status: tally.status, index: withTallyChange(tally.index, record.itemIds, delta, record.date) });
  void refreshTally(userId);
}

import { useSyncExternalStore } from "react";
import { fetchSavedOutfit, fetchSavedOutfits, removeSavedOutfit, renameOutfit, setOutfitFavorite } from "../../data/outfits";
import type { SavedOutfit } from "../../data/savedOutfit";
import { withFavorite, withName, withOutfit, withoutOutfit } from "./collection";

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
  state = EMPTY;
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

import { useCallback, useEffect, useRef, useState } from "react";
import { markOutfitSaved, removeSavedOutfit, saveOutfit } from "../../data/outfits";
import { SavedOutfitError } from "../../data/savedOutfit";
import { withOutfit, withoutOutfit } from "../outfits/collection";
import { patchOutfits, refreshOutfits, useSavedOutfits } from "../outfits/store";
import type { BookmarkFailureInfo, BookmarkIntent, SavedLookup } from "./bookmark";

/** A bookmark that can be pressed: `hidden` is never pressed. */
export type PressableIntent = Exclude<BookmarkIntent, { kind: "hidden" }>;

/** What the last press did, for the screen reader: the screen turns it into "saved to the outfits" / "removed". */
export type BookmarkAnnouncement = { kind: "saved" | "removed"; n: number };

/**
 * A press that failed: the garment set, the day and what the user wanted. It is data, not an action: "try again" is
 * recomputed from the state at the moment of the retry (bookmarkFailureAction), never replayed.
 */
export type BookmarkFailure = BookmarkFailureInfo & {
  /** The data layer refused the outfit itself (`invalid_outfit`: a garment was deleted), so no retry could pass. */
  unsaveable: boolean;
};

export type BookmarkApi = {
  /** The saved outfits have been read: until then the bookmark is drawn "not saved" but cannot be pressed. */
  ready: boolean;
  /** The read failed (and nothing was read before): the bookmark says why it is disabled. Retried once after 5 s. */
  unavailable: boolean;
  /** The saved outfits, for "is the shown outfit saved" and "which row does this wear point at". Empty until `ready`. */
  saved: SavedLookup;
  /** The state a press has already drawn and not yet confirmed, by garment set (see `shownSaved`). */
  pending: { key: string; saved: boolean } | null;
  failure: BookmarkFailure | null;
  announcement: BookmarkAnnouncement | null;
  /** Saves or removes optimistically; a second press while one is on its way is ignored. `date` is the tab's date. */
  press: (intent: PressableIntent, date: string) => Promise<void>;
  /**
   * Resolves when no press is on its way (never rejects). A feedback write waits for it: a save that has not answered
   * yet is not in the list, and a wear recorded meanwhile would get a row of its own instead of the saved outfit's.
   */
  settled: () => Promise<void>;
  /** The failure belongs to the press that made it: the screen clears it when the user starts something else. */
  dismissFailure: () => void;
};

/**
 * Saving the outfit shown on Today to the collection (DESIGN.md "שלב 5.2" item 6). The saved outfits come from the
 * store the collection and the outfit screen share, so a save made here is on the "לוקים" tab without a reload; the
 * read that fills it is started by the caller after the outfit is on screen (it is not part of the first paint).
 *
 * A press shows its result at once (`pending`) and rolls back by dropping it when the write fails (`failure` then
 * carries the press for "try again"). On success the store is patched with what the data layer returned, so the
 * collection's wear count and date are the server's. Failure modes: every error from the data layer
 * (SavedOutfitError, network and permission errors, PreviewReadOnlyError in the design preview) is logged and shown as
 * `failure`; nothing is thrown to the caller.
 */
export function useBookmark(userId: string): BookmarkApi {
  const outfits = useSavedOutfits(userId);
  const [pending, setPending] = useState<{ key: string; saved: boolean } | null>(null);
  const [failure, setFailure] = useState<BookmarkFailure | null>(null);
  const [announcement, setAnnouncement] = useState<BookmarkAnnouncement | null>(null);
  // don't touch / a ref, not state: two presses in the same frame both read `pending` as null, and the second would
  // start a second write (a second save of the same set before the first has answered).
  const busy = useRef(false);
  const count = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const run = useCallback(
    async (intent: PressableIntent, date: string) => {
      busy.current = true;
      setFailure(null);
      setPending({ key: intent.key, saved: intent.kind !== "saved" });
      try {
        if (intent.kind === "saved") {
          await removeSavedOutfit(intent.savedId);
          patchOutfits(userId, (list) => withoutOutfit(list, intent.savedId));
        } else {
          const w = intent.write;
          const result =
            w.op === "save"
              ? await saveOutfit({ userId, date: w.date, contextType: w.contextType, source: w.source, pieces: w.pieces })
              : await markOutfitSaved(w.outfitId);
          patchOutfits(userId, (list) => withOutfit(list, result.outfit));
        }
        count.current += 1;
        setAnnouncement({ kind: intent.kind === "saved" ? "removed" : "saved", n: count.current });
      } catch (error) {
        console.error("Bookmark write failed", error);
        setFailure({ key: intent.key, date, wantSaved: intent.kind !== "saved", unsaveable: error instanceof SavedOutfitError && error.code === "invalid_outfit" });
      } finally {
        // Cleared with the store already patched (success) or not (failure): either way the next render is the truth.
        setPending(null);
        busy.current = false;
      }
    },
    [userId]
  );
  const press = useCallback(
    (intent: PressableIntent, date: string) => {
      if (busy.current) return Promise.resolve();
      const started = run(intent, date);
      inFlight.current = started;
      return started;
    },
    [run]
  );
  const settled = useCallback(() => inFlight.current ?? Promise.resolve(), []);
  // A failed read recovers by itself once, after 5 s, instead of only when the user leaves and returns.
  const failedRead = outfits.status === "error";
  const retried = useRef(false);
  const answered = outfits.status === "ready";
  useEffect(() => {
    // Re-armed only by a good read: the retry itself passes through `loading`, which must not re-arm it.
    if (answered) retried.current = false;
    if (!failedRead || retried.current) return;
    const timer = setTimeout(() => {
      retried.current = true;
      void refreshOutfits(userId);
    }, 5000);
    return () => clearTimeout(timer);
  }, [failedRead, answered, userId]);

  const dismissFailure = useCallback(() => setFailure(null), []);
  const saved: SavedLookup = outfits.status === "ready" ? outfits.outfits : [];
  return { ready: outfits.status === "ready", unavailable: failedRead, saved, pending, failure, announcement, press, settled, dismissFailure };
}

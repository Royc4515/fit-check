import { applyPairUpdates, dueForLaundry, feedbackUpdates, NO_ADJUSTMENT, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Availability, CandidateOutfit, ContextType, Item, WearFeedback } from "@fit-check/schema";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { WardrobeData } from "./wardrobe";
import type { DayType } from "./dayContext";
import {
  changeFeedback,
  deleteFeedback,
  EMPTY_HISTORY,
  fetchFeedback,
  fetchWearCounts,
  recordFeedback,
  recordWearOfSaved,
  savePairWeights,
  setAvailabilityMany,
  type FeedbackHistory,
  type TodayRecord,
} from "./feedback";
import { keepHomeLaundry, laundryAfterCorrection, type CorrectionStage } from "./correction";
import { announceWears, laundryNow, onOtherWears, setLaundry, subscribeLaundry, type Laundered } from "./feedbackSync";

export type { Laundered } from "./feedbackSync";

/**
 * A saved outfit worn from its own screen (DESIGN.md "שלב 5.2" item 4): the row the wear points at and its garments
 * (`outfit_items`). No engine scored it, so there is no candidate: the wear is one `wears` row on that outfit.
 */
export type SavedWear = { outfitId: string; itemIds: readonly string[] };

/**
 * The day an answer is for, when it is not today: a planned day after today's candle lighting (DESIGN.md "שלב 4.1").
 * Its date goes into `outfits.created_for_date` and `wears.worn_on`, its day type into `outfits.context_type`.
 */
export type FeedbackTarget = { date: string; dayType: ContextType };

export type FeedbackActions = {
  wear: (outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment, target?: FeedbackTarget) => Promise<void>;
  skip: (outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment, target?: FeedbackTarget) => Promise<void>;
  dislike: (record: TodayRecord) => Promise<void>;
  undo: (record: TodayRecord) => Promise<void>;
  /**
   * "Wore something else?" (DESIGN.md "שלב 5.1" item 1): replaces a recorded wear by the corrected outfit, as one
   * action. The corrected wear is recorded FIRST; only then is the earlier one deleted, unlearned and its laundry
   * move undone for the garments that changed. A failure is published as `correction` (see there); the generic
   * failure line is not used. `target` defaults to the record's own date, in today's day type.
   */
  correct: (record: TodayRecord, outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment, target?: FeedbackTarget) => Promise<void>;
  /**
   * "לובש היום" on a saved outfit's screen: records the wear on that saved row (recordWearOfSaved) for `target`, the
   * day in force (features/today/dayInForce.ts: today, or Shabbat / the holiday after its eve's cut-off, as Today
   * records), then learns and moves to the laundry exactly as `wear` does. The wear's adjustment sample is none:
   * nothing was nudged. A failure is published as `failedOn` (the target's date), like `wear`. `target` defaults to today.
   */
  wearSaved: (saved: SavedWear, target?: FeedbackTarget) => Promise<void>;
  /**
   * The same from the saved outfit's screen when today already has another wear: `correct`'s path and order (this
   * wear first, then the laundry, then the earlier wear deleted, then unlearned), the new wear on the saved row.
   * A failure is published as `correction`.
   */
  correctToSaved: (record: TodayRecord, saved: SavedWear) => Promise<void>;
  /** Overrides the automatic laundry move: the items stay home and keep their wear count. */
  keepHome: (itemIds: string[]) => Promise<void>;
  /**
   * Clears the failure line. A failure belongs to the action that produced it: the screen calls this when the user
   * starts something else (opens a sheet), so the line does not outlive its action. Starting a write clears it too.
   */
  dismissFailure: () => void;
};

export type FeedbackState = {
  /** null until the first load lands; Today waits for it so a worn outfit never flashes as a fresh suggestion. */
  history: FeedbackHistory | null;
  busy: boolean;
  /**
   * The date of the day whose last action failed (today's date when the history load failed), else null. The screen
   * shows the failure line on that day's tab only: a failure belongs to the action that produced it.
   */
  failedOn: string | null;
  laundered: Laundered | null;
  /**
   * A correction that did not complete: "record" (nothing changed, the earlier wear stands; retry repeats it) or
   * "delete" (the corrected wear is stored and shown, the earlier one was not deleted; retry deletes only).
   */
  correction: { date: string; stage: CorrectionStage; retry: () => void } | null;
  actions: FeedbackActions;
};

const sameItems = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Today's feedback loop: loads recent wears, and records wear / skip / dislike / undo, keeping the learned pair
 * weights in step (engine feedbackUpdates, PRD 4). Writes go to the DB first and the screen changes only after
 * they succeed: a "worn" that silently failed would teach the engine nothing while the user believes it did.
 *
 * One hook for today and every planned day after it, not one instance per day: the planned days are 0 to 3 (a
 * variable count of hooks is not allowed), they share one history read (`date..until`), one learned weights map
 * and one laundry line, and a write for one day changes what the next day is offered. A wear or skip for a planned
 * day passes its `target`; without one it is today's, exactly as before. A planned wear moves garments to the
 * laundry at press time like any wear (DESIGN.md "שלב 4.1" item 6), so the wash count of migration 0003, which
 * compares `wears.created_at` with `washed_at`, counts it from the moment it is pressed.
 *
 * A failed history load is not fatal: Today still works, just without freshness (logged, shown as `failedOn`).
 */
export function useFeedback(args: {
  userId: string;
  date: string;
  dayType: DayType;
  /** The last planned day (the chain's end); defaults to `date`. Wears up to it are read back. */
  until?: string;
  items: Item[];
  pairWeights: PairWeights;
  patch: (fn: (data: WardrobeData) => WardrobeData) => void;
  /**
   * The outfit row an answer to these garments is recorded on, decided at write time from a settled saved list: the
   * saved outfit's id, or undefined for a new unsaved row (features/today/bookmark.ts resolveWearRow). Every write of
   * feedback (worn, skipped, the corrected wear) asks it first. It rejects when the saved list cannot be read: the
   * write then fails like any failed write, rather than recording a copy of a saved outfit.
   */
  resolveRow: (itemIds: string[]) => Promise<string | undefined>;
  /** A worn record was stored (+1) or deleted (-1): lets the shared outfits store follow at once (count and date). */
  onWornChange?: (record: TodayRecord, delta: 1 | -1) => void;
}): FeedbackState {
  const { userId, date, dayType, until = date, items, pairWeights, patch, resolveRow, onWornChange } = args;
  // Shared by every mounted hook (data/feedbackSync.ts): a wear made on the outfit screen is undone on Today with
  // its laundry, and the other way round.
  const { laundered } = useSyncExternalStore(subscribeLaundry, laundryNow);
  // This hook's token: it hears the other hooks' wear writes, not its own.
  const [token] = useState<symbol>(() => Symbol("feedback"));
  const [reread, setReread] = useState(0);
  useEffect(() => onOtherWears(token, () => setReread((n) => n + 1)), [token]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Stored with the range it belongs to, so a new day reads as "not loaded" without resetting state in an effect.
  const range = `${date}..${until}`;
  const [loaded, setLoaded] = useState<{ range: string; history: FeedbackHistory } | null>(null);
  const history = loaded?.range === range ? loaded.history : null;
  const setHistory = useCallback(
    (fn: (h: FeedbackHistory | null) => FeedbackHistory | null) =>
      setLoaded((cur) => {
        const next = fn(cur?.range === range ? cur.history : null);
        return next ? { range, history: next } : cur;
      }),
    [range]
  );
  const [busy, setBusy] = useState(false);
  const [failedOn, setFailedOn] = useState<string | null>(null);
  const [correction, setCorrection] = useState<FeedbackState["correction"]>(null);
  // don't touch / actions read weights through a ref: closing over `pairWeights` would compute updates from the
  // weights of the render the button was drawn in, and two quick actions would each start from the same old map.
  const weights = useRef(pairWeights);
  useEffect(() => {
    weights.current = pairWeights;
  }, [pairWeights]);

  useEffect(() => {
    let active = true;
    fetchFeedback(date, until)
      .then((h) => {
        if (active) setLoaded({ range: `${date}..${until}`, history: h });
      })
      .catch((error: unknown) => {
        console.error("Wear history load failed", error);
        if (active) {
          setLoaded({ range: `${date}..${until}`, history: EMPTY_HISTORY });
          setFailedOn(date);
        }
      });
    return () => {
      active = false;
    };
  }, [date, until]);

  // Another screen wrote a wear (the outfit screen's "לובש היום", or Today's): read the history again so this screen
  // shows the day as it now is. The history on screen stays until the read lands, so nothing flashes; a failed re-read
  // keeps it (logged), it does not empty it the way a failed first load does.
  useEffect(() => {
    if (reread === 0) return;
    let active = true;
    fetchFeedback(date, until).then(
      (h) => {
        if (active) setLoaded({ range: `${date}..${until}`, history: h });
      },
      (error: unknown) => console.error("Wear history re-read failed", error)
    );
    return () => {
      active = false;
    };
  }, [reread, date, until]);

  const learn = useCallback(
    async (itemIds: string[], feedback: WearFeedback, sign: 1 | -1) => {
      const updates = feedbackUpdates(itemIds, feedback, weights.current, sign);
      if (updates.length === 0) return;
      await savePairWeights(userId, updates);
      weights.current = applyPairUpdates(weights.current, updates);
      patch((d) => ({ ...d, pairWeights: applyPairUpdates(d.pairWeights, updates) }));
    },
    [userId, patch]
  );

  const move = useCallback(
    async (ids: string[], next: Availability) => {
      if (ids.length === 0) return;
      await setAvailabilityMany(ids, next);
      const set = new Set(ids);
      patch((d) => ({ ...d, items: d.items.map((i) => (set.has(i.id) ? { ...i, availability: next } : i)) }));
    },
    [patch]
  );

  // The day of the wear the laundry line belongs to (shared: data/feedbackSync.ts), so a failed "keep out of the
  // laundry" shows on that day's tab.

  /** After a wear: whatever reached its wash count goes to the laundry (engine dueForLaundry, config per kind). */
  const launder = useCallback(
    async (record: TodayRecord) => {
      const counts = await fetchWearCounts(record.itemIds);
      const worn = itemsRef.current.filter((i) => record.itemIds.includes(i.id));
      const due = dueForLaundry(worn, counts).map((i) => i.id);
      await move(due, "laundry");
      setLaundry(() => (due.length > 0 ? { wearId: record.wearId, itemIds: due, keptHome: [] } : null), record.date);
    },
    [move]
  );

  const run = useCallback(
    async (on: string, fn: () => Promise<void>) => {
      setBusy(true);
      setFailedOn(null);
      try {
        await fn();
      } catch (error) {
        console.error("Feedback write failed", error);
        setFailedOn(on);
      } finally {
        setBusy(false);
        announceWears(token);
      }
    },
    [token]
  );

  const actions = useMemo<FeedbackActions>(() => {
    /** Puts a stored worn record into the history (today's or a planned day's). */
    const addWorn = (record: TodayRecord, target: FeedbackTarget, adjustment: DayAdjustment) => {
      const ahead = record.date !== date;
      setHistory((h) => ({
        // A planned day's wear is not "recent" for today; the planning counts it on its own date.
        recent: ahead
          ? (h?.recent ?? [])
          : [{ date, item_ids: record.itemIds, context_key: null, context_type: target.dayType }, ...(h?.recent ?? [])],
        today: ahead ? (h?.today ?? []) : [...(h?.today ?? []), record],
        ahead: ahead ? [...(h?.ahead ?? []), record] : (h?.ahead ?? []),
        samples: [{ wearId: record.wearId, adjustment }, ...(h?.samples ?? [])],
      }));
    };
    /** Stores a worn record for `target`: an engine candidate on its row (resolveRow), or a saved outfit's own row. */
    type WearWrite = (target: FeedbackTarget) => Promise<TodayRecord>;
    const candidateWrite =
      (outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment): WearWrite =>
      async (target) => {
        const savedOutfitId = await resolveRow(outfit.items.map((i) => i.id));
        return recordFeedback({ ...target, userId, outfit, source, feedback: "worn", adjustment, savedOutfitId });
      };
    const savedWrite =
      (saved: SavedWear): WearWrite =>
      (target) =>
        recordWearOfSaved({ userId, date: target.date, itemIds: saved.itemIds, feedback: "worn", savedOutfitId: saved.outfitId });
    /** Records a worn outfit for `target`, then learns from it and moves what is due to the laundry. */
    const wearNow = async (write: WearWrite, adjustment: DayAdjustment, target: FeedbackTarget) => {
      const record = await write(target);
      addWorn(record, target, adjustment);
      onWornChange?.(record, 1);
      // The wear is stored even if learning fails; the weights are a derived signal, the wear is the fact. So a
      // failed weights write is logged and swallowed here: letting it reach run() would show "didn't save" for a
      // wear that was saved, and the user would press "wearing it" again and wear the day twice.
      await learn(record.itemIds, "worn", 1).catch((error: unknown) => console.error("Pair weights update failed", error));
      // A failed laundry move is logged, not shown: the wear itself succeeded and the user can move items by hand.
      await launder(record).catch((error: unknown) => console.error("Automatic laundry failed", error));
    };
    /** Takes a deleted record out of the history. */
    const dropRecord = (record: TodayRecord) =>
      setHistory((h) => {
        if (!h) return h;
        const idx = h.recent.findIndex((w) => w.date === record.date && sameItems(w.item_ids, record.itemIds));
        return {
          recent: record.feedback === "worn" && idx >= 0 ? h.recent.filter((_, i) => i !== idx) : h.recent,
          today: h.today.filter((r) => r.wearId !== record.wearId),
          ahead: h.ahead.filter((r) => r.wearId !== record.wearId),
          samples: h.samples.filter((x) => x.wearId !== record.wearId),
        };
      });
    /** Removes a recorded answer, unlearns it, and brings back what its wear sent to the laundry. */
    const undoNow = async (record: TodayRecord) => {
      await deleteFeedback(record);
      dropRecord(record);
      if (record.feedback === "worn") onWornChange?.(record, -1);
      if (record.feedback !== "skipped") await learn(record.itemIds, record.feedback, -1);
      // Undoing the wear undoes its laundry move too; the wash count is right again because the wear is gone. Read at
      // the moment of the undo, not from the render: the wear may have been made on another screen.
      const day = laundryNow().laundered;
      if (day?.wearId === record.wearId) {
        await move(day.itemIds, "home");
        setLaundry(() => null);
      }
    };
    /**
     * After the corrected wear is stored: delete the earlier one, then unlearn it and bring home the garments its
     * laundry move took that the corrected outfit does not hold, then the corrected outfit's own laundry pass (counted
     * without the earlier wear). Throws only if the delete fails; the steps after it are logged, never shown.
     */
    const retireEarlier = async (earlier: TodayRecord) => {
      await deleteFeedback(earlier);
      dropRecord(earlier);
      if (earlier.feedback === "worn") onWornChange?.(earlier, -1);
      await learn(earlier.itemIds, "worn", -1).catch((error: unknown) => console.error("Pair weights update failed", error));
    };
    /**
     * The laundry after a correction (data/correction.ts laundryAfterCorrection): L's garments not in the corrected
     * outfit go home, the corrected outfit's due garments not already in L go to the laundry, and L becomes their
     * union, kept under the corrected wear so its status line names all of it and its undo brings all of it home.
     * Runs BEFORE the earlier wear is deleted, so a failed delete leaves the laundry already matching the outfit shown.
     */
    const relaunder = async (earlier: TodayRecord, corrected: TodayRecord) => {
      const cur = laundryNow().laundered;
      const day = cur?.wearId === earlier.wearId ? { moved: cur.itemIds, keptHome: cur.keptHome } : { moved: [], keptHome: [] };
      const counts = await fetchWearCounts(corrected.itemIds);
      const items = itemsRef.current.filter((i) => corrected.itemIds.includes(i.id));
      const next = laundryAfterCorrection({ day, earlier: earlier.itemIds, corrected: items, counts });
      await move(next.home, "home");
      await move(next.laundry, "laundry");
      setLaundry(() => ({ wearId: corrected.wearId, itemIds: next.day.moved, keptHome: next.day.keptHome }), corrected.date);
    };
    /** The earlier wear could not be deleted: retried alone, the corrected wear already stands. */
    const retryRetire = async (earlier: TodayRecord) => {
      setBusy(true);
      setCorrection(null);
      try {
        await retireEarlier(earlier);
      } catch (error) {
        console.error("Deleting the earlier wear failed", error);
        setCorrection({ date: earlier.date, stage: "delete", retry: () => void retryRetire(earlier) });
      } finally {
        setBusy(false);
        announceWears(token);
      }
    };
    // don't touch / record first, delete second (independent verification, 19.11): the reverse order lost the day's
    // only record when the second write failed. Not through run(): its failure line is generic, a correction says
    // which step failed and what stands.
    const correctNow = async (earlier: TodayRecord, write: WearWrite, adjustment: DayAdjustment, target: FeedbackTarget): Promise<void> => {
      setBusy(true);
      setFailedOn(null);
      setCorrection(null);
      try {
        let corrected: TodayRecord;
        try {
          // The corrected set may itself be a saved outfit: its wear then goes on that row. A saved list that cannot be
          // read fails this step like a failed write: the earlier wear stands and "try again" repeats it.
          corrected = await write(target);
        } catch (error) {
          console.error("Recording the corrected wear failed; the earlier one stands", error);
          setCorrection({ date: earlier.date, stage: "record", retry: () => void correctNow(earlier, write, adjustment, target) });
          return;
        }
        addWorn(corrected, target, adjustment);
        onWornChange?.(corrected, 1);
        await learn(corrected.itemIds, "worn", 1).catch((error: unknown) => console.error("Pair weights update failed", error));
        // A failed laundry move is logged, not shown, as for any wear: the record is right, garments can be moved by hand.
        await relaunder(earlier, corrected).catch((error: unknown) => console.error("Laundry after the correction failed", error));
        try {
          await retireEarlier(earlier);
        } catch (error) {
          console.error("Deleting the earlier wear failed", error);
          // The retry only deletes and unlearns: the laundry has already been moved and is never moved twice.
          setCorrection({ date: earlier.date, stage: "delete", retry: () => void retryRetire(earlier) });
        }
      } finally {
        setBusy(false);
        announceWears(token);
      }
    };
    return {
      wear: (outfit, source, adjustment, target = { date, dayType }) =>
        run(target.date, () => wearNow(candidateWrite(outfit, source, adjustment), adjustment, target)),
      // The day in force, decided by the caller with Today's rule. The day type goes into no row: the saved outfit
      // keeps its own "למתי".
      wearSaved: (saved, target = { date, dayType }) => run(target.date, () => wearNow(savedWrite(saved), NO_ADJUSTMENT, target)),
      correctToSaved: (record, saved) => correctNow(record, savedWrite(saved), NO_ADJUSTMENT, { date: record.date, dayType }),
      skip: (outfit, source, adjustment, target = { date, dayType }) =>
        run(target.date, async () => {
          // A skip of a saved outfit is recorded on its row too: any answer to a saved set points at the saved row.
          const savedOutfitId = await resolveRow(outfit.items.map((i) => i.id));
          const record = await recordFeedback({ ...target, userId, outfit, source, feedback: "skipped", adjustment, savedOutfitId });
          const ahead = record.date !== date;
          setHistory((h) => ({
            recent: h?.recent ?? [],
            today: ahead ? (h?.today ?? []) : [...(h?.today ?? []), record],
            ahead: ahead ? [...(h?.ahead ?? []), record] : (h?.ahead ?? []),
            samples: h?.samples ?? [],
          }));
        }),
      dislike: (record) =>
        run(record.date, async () => {
          await changeFeedback(record.wearId, "disliked");
          const mark = (r: TodayRecord): TodayRecord => (r.wearId === record.wearId ? { ...r, feedback: "disliked" } : r);
          setHistory((h) => h && { ...h, today: h.today.map(mark), ahead: h.ahead.map(mark) });
          await learn(record.itemIds, "disliked", 1);
        }),
      undo: (record) => run(record.date, () => undoNow(record)),
      correct: (record, outfit, source, adjustment, target = { date: record.date, dayType }) =>
        correctNow(record, candidateWrite(outfit, source, adjustment), adjustment, target),
      keepHome: (itemIds) =>
        run(laundryNow().laundered ? (laundryNow().date ?? date) : date, async () => {
          await move(itemIds, "home");
          // Kept home: out of L for good today (a correction will not send them back), the rest stays in L.
          setLaundry((cur) => {
            if (!cur) return cur;
            const day = keepHomeLaundry({ moved: cur.itemIds, keptHome: cur.keptHome }, itemIds);
            return { wearId: cur.wearId, itemIds: day.moved, keptHome: day.keptHome };
          });
        }),
      dismissFailure: () => setFailedOn(null),
    };
  }, [run, learn, launder, move, setHistory, userId, date, dayType, resolveRow, onWornChange, token]);

  return { history, busy, failedOn, laundered, correction, actions };
}

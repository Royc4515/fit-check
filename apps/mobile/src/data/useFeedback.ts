import { applyPairUpdates, dueForLaundry, feedbackUpdates, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Availability, CandidateOutfit, ContextType, Item, WearFeedback } from "@fit-check/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WardrobeData } from "./wardrobe";
import type { DayType } from "./dayContext";
import {
  changeFeedback,
  deleteFeedback,
  EMPTY_HISTORY,
  fetchFeedback,
  fetchWearCounts,
  recordFeedback,
  savePairWeights,
  setAvailabilityMany,
  type FeedbackHistory,
  type TodayRecord,
} from "./feedback";
import { itemsBackHome, type CorrectionStage } from "./correction";

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
  /** Overrides the automatic laundry move: the items stay home and keep their wear count. */
  keepHome: (itemIds: string[]) => Promise<void>;
  /**
   * Clears the failure line. A failure belongs to the action that produced it: the screen calls this when the user
   * starts something else (opens a sheet), so the line does not outlive its action. Starting a write clears it too.
   */
  dismissFailure: () => void;
};

/** Items the last "wearing" sent to the laundry, so Today can name them and offer to keep them home. */
export type Laundered = { wearId: string; itemIds: string[] };

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
}): FeedbackState {
  const { userId, date, dayType, until = date, items, pairWeights, patch } = args;
  const [laundered, setLaundered] = useState<Laundered | null>(null);
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

  // The day of the wear the laundry line belongs to, so a failed "keep out of the laundry" shows on that day's tab.
  const laundryDate = useRef(date);

  /** After a wear: whatever reached its wash count goes to the laundry (engine dueForLaundry, config per kind). */
  const launder = useCallback(
    async (record: TodayRecord) => {
      const counts = await fetchWearCounts(record.itemIds);
      const worn = itemsRef.current.filter((i) => record.itemIds.includes(i.id));
      const due = dueForLaundry(worn, counts).map((i) => i.id);
      await move(due, "laundry");
      laundryDate.current = record.date;
      setLaundered(due.length > 0 ? { wearId: record.wearId, itemIds: due } : null);
    },
    [move]
  );

  const run = useCallback(async (on: string, fn: () => Promise<void>) => {
    setBusy(true);
    setFailedOn(null);
    try {
      await fn();
    } catch (error) {
      console.error("Feedback write failed", error);
      setFailedOn(on);
    } finally {
      setBusy(false);
    }
  }, []);

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
    /** Records a worn outfit for `target`, then learns from it and moves what is due to the laundry. */
    const wearNow = async (outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment, target: FeedbackTarget) => {
      const record = await recordFeedback({ ...target, userId, outfit, source, feedback: "worn", adjustment });
      addWorn(record, target, adjustment);
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
      if (record.feedback !== "skipped") await learn(record.itemIds, record.feedback, -1);
      // Undoing the wear undoes its laundry move too; the wash count is right again because the wear is gone.
      if (laundered?.wearId === record.wearId) {
        await move(laundered.itemIds, "home");
        setLaundered(null);
      }
    };
    /**
     * After the corrected wear is stored: delete the earlier one, then unlearn it and bring home the garments its
     * laundry move took that the corrected outfit does not hold, then the corrected outfit's own laundry pass (counted
     * without the earlier wear). Throws only if the delete fails; the steps after it are logged, never shown.
     */
    const retireEarlier = async (earlier: TodayRecord, corrected: TodayRecord) => {
      await deleteFeedback(earlier);
      dropRecord(earlier);
      await learn(earlier.itemIds, "worn", -1).catch((error: unknown) => console.error("Pair weights update failed", error));
      const back = itemsBackHome(laundered?.wearId === earlier.wearId ? laundered.itemIds : null, corrected.itemIds);
      await move(back, "home").catch((error: unknown) => console.error("Laundry move back failed", error));
      await launder(corrected).catch((error: unknown) => console.error("Automatic laundry failed", error));
    };
    /** The earlier wear could not be deleted: retried alone, the corrected wear already stands. */
    const retryRetire = async (earlier: TodayRecord, corrected: TodayRecord) => {
      setBusy(true);
      setCorrection(null);
      try {
        await retireEarlier(earlier, corrected);
      } catch (error) {
        console.error("Deleting the earlier wear failed", error);
        setCorrection({ date: earlier.date, stage: "delete", retry: () => void retryRetire(earlier, corrected) });
      } finally {
        setBusy(false);
      }
    };
    // don't touch / record first, delete second (independent verification, 19.11): the reverse order lost the day's
    // only record when the second write failed. Not through run(): its failure line is generic, a correction says
    // which step failed and what stands.
    const correctNow = async (
      earlier: TodayRecord,
      outfit: CandidateOutfit,
      source: "daily" | "swap",
      adjustment: DayAdjustment,
      target: FeedbackTarget
    ): Promise<void> => {
      setBusy(true);
      setFailedOn(null);
      setCorrection(null);
      try {
        let corrected: TodayRecord;
        try {
          corrected = await recordFeedback({ ...target, userId, outfit, source, feedback: "worn", adjustment });
        } catch (error) {
          console.error("Recording the corrected wear failed; the earlier one stands", error);
          setCorrection({ date: earlier.date, stage: "record", retry: () => void correctNow(earlier, outfit, source, adjustment, target) });
          return;
        }
        addWorn(corrected, target, adjustment);
        await learn(corrected.itemIds, "worn", 1).catch((error: unknown) => console.error("Pair weights update failed", error));
        try {
          await retireEarlier(earlier, corrected);
        } catch (error) {
          console.error("Deleting the earlier wear failed", error);
          setCorrection({ date: earlier.date, stage: "delete", retry: () => void retryRetire(earlier, corrected) });
        }
      } finally {
        setBusy(false);
      }
    };
    return {
      wear: (outfit, source, adjustment, target = { date, dayType }) => run(target.date, () => wearNow(outfit, source, adjustment, target)),
      skip: (outfit, source, adjustment, target = { date, dayType }) =>
        run(target.date, async () => {
          const record = await recordFeedback({ ...target, userId, outfit, source, feedback: "skipped", adjustment });
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
      correct: (record, outfit, source, adjustment, target = { date: record.date, dayType }) => correctNow(record, outfit, source, adjustment, target),
      keepHome: (itemIds) =>
        run(laundered ? laundryDate.current : date, async () => {
          await move(itemIds, "home");
          setLaundered(null);
        }),
      dismissFailure: () => setFailedOn(null),
    };
  }, [run, learn, launder, move, laundered, setHistory, userId, date, dayType]);

  return { history, busy, failedOn, laundered, correction, actions };
}

import { applyPairUpdates, dueForLaundry, feedbackUpdates, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Availability, CandidateOutfit, Item, WearFeedback } from "@fit-check/schema";
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

export type FeedbackActions = {
  wear: (outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment) => Promise<void>;
  skip: (outfit: CandidateOutfit, source: "daily" | "swap", adjustment: DayAdjustment) => Promise<void>;
  dislike: (record: TodayRecord) => Promise<void>;
  undo: (record: TodayRecord) => Promise<void>;
  /** Overrides the automatic laundry move: the items stay home and keep their wear count. */
  keepHome: (itemIds: string[]) => Promise<void>;
};

/** Items the last "wearing" sent to the laundry, so Today can name them and offer to keep them home. */
export type Laundered = { wearId: string; itemIds: string[] };

export type FeedbackState = {
  /** null until the first load lands; Today waits for it so a worn outfit never flashes as a fresh suggestion. */
  history: FeedbackHistory | null;
  busy: boolean;
  /** The last action failed; the screen says so and nothing changed. */
  failed: boolean;
  laundered: Laundered | null;
  actions: FeedbackActions;
};

const sameItems = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Today's feedback loop: loads recent wears, and records wear / skip / dislike / undo, keeping the learned pair
 * weights in step (engine feedbackUpdates, PRD 4). Writes go to the DB first and the screen changes only after
 * they succeed: a "worn" that silently failed would teach the engine nothing while the user believes it did.
 *
 * A failed history load is not fatal: Today still works, just without freshness (logged, shown as `failed`).
 */
export function useFeedback(args: {
  userId: string;
  date: string;
  dayType: DayType;
  items: Item[];
  pairWeights: PairWeights;
  patch: (fn: (data: WardrobeData) => WardrobeData) => void;
}): FeedbackState {
  const { userId, date, dayType, items, pairWeights, patch } = args;
  const [laundered, setLaundered] = useState<Laundered | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Stored with the date it belongs to, so a new day reads as "not loaded" without resetting state in an effect.
  const [loaded, setLoaded] = useState<{ date: string; history: FeedbackHistory } | null>(null);
  const history = loaded?.date === date ? loaded.history : null;
  const setHistory = useCallback(
    (fn: (h: FeedbackHistory | null) => FeedbackHistory | null) =>
      setLoaded((cur) => {
        const next = fn(cur?.date === date ? cur.history : null);
        return next ? { date, history: next } : cur;
      }),
    [date]
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // don't touch / actions read weights through a ref: closing over `pairWeights` would compute updates from the
  // weights of the render the button was drawn in, and two quick actions would each start from the same old map.
  const weights = useRef(pairWeights);
  useEffect(() => {
    weights.current = pairWeights;
  }, [pairWeights]);

  useEffect(() => {
    let active = true;
    fetchFeedback(date)
      .then((h) => {
        if (active) setLoaded({ date, history: h });
      })
      .catch((error: unknown) => {
        console.error("Wear history load failed", error);
        if (active) {
          setLoaded({ date, history: EMPTY_HISTORY });
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [date]);

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

  /** After a wear: whatever reached its wash count goes to the laundry (engine dueForLaundry, config per kind). */
  const launder = useCallback(
    async (record: TodayRecord) => {
      const counts = await fetchWearCounts(record.itemIds);
      const worn = itemsRef.current.filter((i) => record.itemIds.includes(i.id));
      const due = dueForLaundry(worn, counts).map((i) => i.id);
      await move(due, "laundry");
      setLaundered(due.length > 0 ? { wearId: record.wearId, itemIds: due } : null);
    },
    [move]
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
    } catch (error) {
      console.error("Feedback write failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const actions = useMemo<FeedbackActions>(
    () => ({
      wear: (outfit, source, adjustment) =>
        run(async () => {
          const record = await recordFeedback({ userId, date, dayType, outfit, source, feedback: "worn", adjustment });
          setHistory((h) => ({
            recent: [{ date, item_ids: record.itemIds, context_key: null }, ...(h?.recent ?? [])],
            today: [...(h?.today ?? []), record],
            samples: [{ wearId: record.wearId, adjustment }, ...(h?.samples ?? [])],
          }));
          // The wear is stored even if learning fails; the weights are a derived signal, the wear is the fact.
          await learn(record.itemIds, "worn", 1);
          // A failed laundry move is logged, not shown: the wear itself succeeded and the user can move items by hand.
          await launder(record).catch((error: unknown) => console.error("Automatic laundry failed", error));
        }),
      skip: (outfit, source, adjustment) =>
        run(async () => {
          const record = await recordFeedback({ userId, date, dayType, outfit, source, feedback: "skipped", adjustment });
          setHistory((h) => ({ recent: h?.recent ?? [], today: [...(h?.today ?? []), record], samples: h?.samples ?? [] }));
        }),
      dislike: (record) =>
        run(async () => {
          await changeFeedback(record.wearId, "disliked");
          setHistory((h) => h && { ...h, today: h.today.map((r) => (r.wearId === record.wearId ? { ...r, feedback: "disliked" } : r)) });
          await learn(record.itemIds, "disliked", 1);
        }),
      undo: (record) =>
        run(async () => {
          await deleteFeedback(record);
          setHistory((h) => {
            if (!h) return h;
            const idx = h.recent.findIndex((w) => w.date === date && sameItems(w.item_ids, record.itemIds));
            return {
              recent: record.feedback === "worn" && idx >= 0 ? h.recent.filter((_, i) => i !== idx) : h.recent,
              today: h.today.filter((r) => r.wearId !== record.wearId),
              samples: h.samples.filter((x) => x.wearId !== record.wearId),
            };
          });
          if (record.feedback !== "skipped") await learn(record.itemIds, record.feedback, -1);
          // Undoing the wear undoes its laundry move too; the wash count is right again because the wear is gone.
          if (laundered?.wearId === record.wearId) {
            await move(laundered.itemIds, "home");
            setLaundered(null);
          }
        }),
      keepHome: (itemIds) =>
        run(async () => {
          await move(itemIds, "home");
          setLaundered(null);
        }),
    }),
    [run, learn, launder, move, laundered, setHistory, userId, date, dayType]
  );

  return { history, busy, failed, laundered, actions };
}

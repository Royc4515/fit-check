import { applyPairUpdates, feedbackUpdates, type PairWeights } from "@fit-check/engine";
import type { CandidateOutfit, WearFeedback } from "@fit-check/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WardrobeData } from "./wardrobe";
import type { DayType } from "./dayContext";
import {
  changeFeedback,
  deleteFeedback,
  EMPTY_HISTORY,
  fetchFeedback,
  recordFeedback,
  savePairWeights,
  type FeedbackHistory,
  type TodayRecord,
} from "./feedback";

export type FeedbackActions = {
  wear: (outfit: CandidateOutfit, source: "daily" | "swap") => Promise<void>;
  skip: (outfit: CandidateOutfit, source: "daily" | "swap") => Promise<void>;
  dislike: (record: TodayRecord) => Promise<void>;
  undo: (record: TodayRecord) => Promise<void>;
};

export type FeedbackState = {
  /** null until the first load lands; Today waits for it so a worn outfit never flashes as a fresh suggestion. */
  history: FeedbackHistory | null;
  busy: boolean;
  /** The last action failed; the screen says so and nothing changed. */
  failed: boolean;
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
  pairWeights: PairWeights;
  patch: (fn: (data: WardrobeData) => WardrobeData) => void;
}): FeedbackState {
  const { userId, date, dayType, pairWeights, patch } = args;
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
      wear: (outfit, source) =>
        run(async () => {
          const record = await recordFeedback({ userId, date, dayType, outfit, source, feedback: "worn" });
          setHistory((h) => ({
            recent: [{ date, item_ids: record.itemIds, context_key: null }, ...(h?.recent ?? [])],
            today: [...(h?.today ?? []), record],
          }));
          // The wear is stored even if learning fails; the weights are a derived signal, the wear is the fact.
          await learn(record.itemIds, "worn", 1);
        }),
      skip: (outfit, source) =>
        run(async () => {
          const record = await recordFeedback({ userId, date, dayType, outfit, source, feedback: "skipped" });
          setHistory((h) => ({ recent: h?.recent ?? [], today: [...(h?.today ?? []), record] }));
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
            };
          });
          if (record.feedback !== "skipped") await learn(record.itemIds, record.feedback, -1);
        }),
    }),
    [run, learn, setHistory, userId, date, dayType]
  );

  return { history, busy, failed, actions };
}

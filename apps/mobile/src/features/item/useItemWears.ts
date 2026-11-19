import { useCallback, useEffect, useState } from "react";
import { fetchItemWears, type ItemWearHistory } from "../../data/feedback";

/** What the "לבישות" section shows: the reserved line, the retry line, or the history. */
export type WearState = { status: "loading" } | { status: "failed" } | { status: "ready"; history: ItemWearHistory };

type Settled = { key: string; state: WearState };

/**
 * The item's wear history (data/feedback fetchItemWears), read when the screen opens and again on retry. Keyed by
 * item and attempt: a result that belongs to an earlier item or attempt is ignored, so the screen reads "loading"
 * until its own answer arrives (no state is set inside the effect itself).
 */
export function useItemWears(itemId: string): { state: WearState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = `${itemId}:${attempt}`;

  useEffect(() => {
    let live = true;
    fetchItemWears(itemId).then(
      (history) => live && setSettled({ key, state: { status: "ready", history } }),
      (error: unknown) => {
        console.error("Item wear history failed", error);
        if (live) setSettled({ key, state: { status: "failed" } });
      }
    );
    return () => {
      live = false;
    };
  }, [itemId, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state: settled?.key === key ? settled.state : { status: "loading" }, retry };
}

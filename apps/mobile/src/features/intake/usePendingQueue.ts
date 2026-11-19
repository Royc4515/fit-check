import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { listPendingForClaude, type PendingPhoto } from "../../data/intake";

/** The queue as the screen shows it. `ready` with an empty list renders nothing. */
export type PendingQueueState = { status: "loading" } | { status: "ready"; photos: PendingPhoto[] } | { status: "failed"; reason: string };

/**
 * The photos waiting for Claude, read on every focus of the screen and on `reload()` (after a "send to Claude" batch).
 * No polling: Claude clears the queue from the chat, and coming back to the screen is when Roy looks again.
 * A refresh keeps the list on screen until the answer arrives (no skeleton flash); only the first load shows skeletons.
 * A failed refresh replaces the list with the error, since the old list may no longer be true.
 * `checkedAt` is when the current answer arrived: the captions ("3 hours ago") are relative to it, so they are as
 * fresh as the list itself and the render stays pure.
 */
export function usePendingQueue(userId: string): { state: PendingQueueState; checkedAt: number; reload: () => void } {
  const [answer, setAnswer] = useState<{ state: PendingQueueState; checkedAt: number }>({ state: { status: "loading" }, checkedAt: 0 });
  // Two refreshes can overlap (focus, then a batch ends); only the latest answer may land.
  const latest = useRef(0);

  const reload = useCallback(() => {
    const call = ++latest.current;
    setAnswer((a) => (a.state.status === "failed" ? { ...a, state: { status: "loading" } } : a));
    void listPendingForClaude(userId).then((result) => {
      if (call !== latest.current) return;
      setAnswer({
        state: result.ok ? { status: "ready", photos: result.photos } : { status: "failed", reason: result.reason },
        checkedAt: Date.now(),
      });
    });
  }, [userId]);

  useFocusEffect(reload);
  return { ...answer, reload };
}

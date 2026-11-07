import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readWardrobeCache, writeWardrobeCache } from "./cache";
import { fetchWardrobe } from "./wardrobe";

export type WardrobeState =
  | { status: "loading" }
  | { status: "error"; reload: () => void }
  /** `stale` is true while the cached copy is shown and the network refresh has not landed yet. */
  | { status: "ready"; items: Item[]; pairWeights: PairWeights; stale: boolean; reload: () => void };

const WardrobeContext = createContext<WardrobeState>({ status: "loading" });

/**
 * One wardrobe load shared by every screen, so Today, Wardrobe and Item never disagree and never refetch on
 * navigation. Stale-while-revalidate: show the per-user cache immediately, then replace it with the network
 * result. If the network fails and there is a cache, the cache stays on screen; with neither, the state is `error`.
 * Remounted per user (key) by the caller, so a new user never briefly sees the previous one's data.
 */
export function WardrobeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState<WardrobeState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readWardrobeCache(userId);
      if (active && cached) setState({ status: "ready", ...cached, stale: true, reload });
      try {
        const fresh = await fetchWardrobe();
        void writeWardrobeCache(userId, fresh);
        if (active) setState({ status: "ready", ...fresh, stale: false, reload });
      } catch (error) {
        console.error("Wardrobe load failed", error);
        if (active) setState((prev) => (prev.status === "ready" ? prev : { status: "error", reload }));
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, attempt, reload]);

  const value = useMemo(() => state, [state]);
  return <WardrobeContext.Provider value={value}>{children}</WardrobeContext.Provider>;
}

export function useWardrobe(): WardrobeState {
  return useContext(WardrobeContext);
}

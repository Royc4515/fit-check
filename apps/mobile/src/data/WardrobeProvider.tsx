import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readWardrobeCache, writeWardrobeCache } from "./cache";
import { archiveItem, restoreItem } from "./items";
import { archivedOf, fetchWardrobe, type WardrobeData } from "./wardrobe";

export type WardrobeState =
  | { status: "loading" }
  | { status: "error"; reload: () => void }
  /** `stale` is true while the cached copy is shown and the network refresh has not landed yet. */
  | {
      status: "ready";
      items: Item[];
      pairWeights: PairWeights;
      stale: boolean;
      reload: () => void;
      /** Optimistic local change (availability, learned weights). Also written to the cache; the DB write is the caller's. */
      patch: (fn: (data: WardrobeData) => WardrobeData) => void;
    };

const WardrobeContext = createContext<WardrobeState>({ status: "loading" });

/** The item just removed (long-press sheet or item screen), offered back on the wardrobe until the next action there. */
export type LastRemoved = { id: string; name: string; failed: boolean };
type RemovedSlot = readonly [LastRemoved | null, (next: LastRemoved | null) => void];
const RemovedContext = createContext<RemovedSlot>([null, () => {}]);

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
  const patch = useCallback(
    (fn: (data: WardrobeData) => WardrobeData) =>
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const next = fn({ items: prev.items, pairWeights: prev.pairWeights });
        void writeWardrobeCache(userId, next);
        return { ...prev, ...next };
      }),
    [userId]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readWardrobeCache(userId);
      if (active && cached) setState({ status: "ready", ...cached, stale: true, reload, patch });
      try {
        const fresh = await fetchWardrobe();
        void writeWardrobeCache(userId, fresh);
        if (active) setState({ status: "ready", ...fresh, stale: false, reload, patch });
      } catch (error) {
        console.error("Wardrobe load failed", error);
        if (active) setState((prev) => (prev.status === "ready" ? prev : { status: "error", reload }));
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, attempt, reload, patch]);

  const value = useMemo(() => state, [state]);
  // Here, not in the wardrobe screen: a removal from the item screen must leave the same undo line (DESIGN.md "ארכיון").
  const [removed, setRemoved] = useState<LastRemoved | null>(null);
  const removedSlot = useMemo<RemovedSlot>(() => [removed, setRemoved], [removed]);
  return (
    <WardrobeContext.Provider value={value}>
      <RemovedContext.Provider value={removedSlot}>{children}</RemovedContext.Provider>
    </WardrobeContext.Provider>
  );
}

/** The last removed item and its setter (null = no undo offer). Shared by the wardrobe and the item screen. */
export function useLastRemoved(): RemovedSlot {
  return useContext(RemovedContext);
}

export function useWardrobe(): WardrobeState {
  return useContext(WardrobeContext);
}

/**
 * The archived items (removed from the wardrobe, restorable), or null while the wardrobe has not loaded (loading or
 * failed). Derived from the shared load, so an archive or restore anywhere shows here at once.
 */
export function useArchivedItems(): Item[] | null {
  const state = useWardrobe();
  const items = state.status === "ready" ? state.items : null;
  return useMemo(() => (items ? archivedOf(items) : null), [items]);
}

/** How many items are archived (the profile's "ארכיון" row), or null while the wardrobe has not loaded. */
export function useArchivedCount(): number | null {
  return useArchivedItems()?.length ?? null;
}

/**
 * Sets one item's status optimistically: the shared wardrobe changes at once (a tile leaves the archive, or comes
 * back to the wardrobe), then the write runs. On a failed write the item goes back to the status it had and the
 * returned promise rejects, so the screen can say so. Rejects without changing anything when the wardrobe is not loaded.
 */
export function useSetItemStatus(): (itemId: string, next: "active" | "archived") => Promise<void> {
  const state = useWardrobe();
  const patch = state.status === "ready" ? state.patch : null;
  const items = state.status === "ready" ? state.items : null;
  return useCallback(
    async (itemId, next) => {
      // don't touch / the status to roll back to is read here, not inside the patch updater: React may run an
      // updater later (or twice in strict mode), after a fast failure has already tried to roll back.
      const prev = items?.find((i) => i.id === itemId)?.status;
      if (!patch || prev === undefined) throw new Error("wardrobe not loaded");
      const set = (status: Item["status"]) =>
        patch((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, status } : i)) }));
      set(next);
      try {
        await (next === "active" ? restoreItem(itemId) : archiveItem(itemId));
      } catch (error) {
        set(prev);
        throw error;
      }
    },
    [patch, items]
  );
}

import { OCCASION_TYPES, type OccasionType } from "@fit-check/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { cacheGet, cacheSet } from "./kv";
import { manualPayload, occasionsFromRows, otherOccasionTypes, type OccasionRow } from "./occasionRows";
import { isPreview, PreviewReadOnlyError } from "./preview";

/**
 * What is on a date (DESIGN.md "שלב 4.5", PRD 7.1): the occasion rows of `contexts`, which the app writes by hand and
 * the user's AI assistant writes through the MCP server. Signed-in client: RLS scopes every row to the user, and the
 * writes pass `user_id` because RLS checks it but does not fill it in.
 */

const CACHE_MS = 30 * 24 * 3600 * 1000;
const cacheKey = (date: string) => `fitcheck:occasion:v1:${date}`;

/**
 * The occasion in effect for each date, newest row wins. Throws on a network or permission error (the hook falls back
 * to the copy cached on the device). In design preview the read goes out like any read (anonymous: RLS returns no rows).
 */
export async function fetchOccasions(dates: readonly string[]): Promise<Record<string, OccasionRow | null>> {
  const { data, error } = await supabase
    .from("contexts")
    .select("date,type,source,payload,created_at")
    .in("date", [...dates])
    .in("type", [...OCCASION_TYPES])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return occasionsFromRows(data ?? [], dates);
}

/**
 * Stores `type` by hand for `date`: the row FIRST (upsert on the unique user/date/type), THEN the other occasion types
 * are deleted, in the server's order (supabase/functions/mcp/context.ts): a failure between the two leaves two rows,
 * never none, and every reader takes the newest. Throws on failure; preview throws its read-only error.
 */
export async function storeOccasion(userId: string, date: string, type: OccasionType, existing: OccasionRow | null): Promise<OccasionRow> {
  if (isPreview()) throw new PreviewReadOnlyError("storeOccasion");
  const createdAt = new Date().toISOString();
  const payload = manualPayload(existing, type);
  const up = await supabase
    .from("contexts")
    .upsert({ user_id: userId, date, type, source: "manual", payload, created_at: createdAt }, { onConflict: "user_id,date,type" });
  if (up.error) throw up.error;
  const del = await supabase.from("contexts").delete().eq("date", date).in("type", otherOccasionTypes(type));
  // don't touch / the new row is stored and newest: it is the one in effect even if the cleanup failed, so this is
  // logged, not thrown (a retry of the same choice finishes it, as on the server).
  if (del.error) console.warn("Occasion cleanup failed", del.error.message);
  return { type, source: "manual", date, payload, createdAt };
}

/** Removes the occasion of `date` (every occasion type; calendar day types are never touched). Throws on failure. */
export async function clearOccasion(date: string): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("clearOccasion");
  const { error } = await supabase.from("contexts").delete().eq("date", date).in("type", [...OCCASION_TYPES]);
  if (error) throw error;
}

export type OccasionsState = {
  /** date -> occasion; a date not loaded yet is absent (the screen plans by the calendar meanwhile). */
  byDate: Readonly<Record<string, OccasionRow | null>>;
  /** The date whose last write failed, and how to try it again; null otherwise. */
  failed: { date: string; retry: () => void } | null;
  /** Sets (or with null clears) the occasion of a date, at once on screen; rolled back if the write fails. */
  choose: (date: string, type: OccasionType | null) => void;
};

/**
 * The occasions of the dates on screen (today and the planned days): the copy cached on the device first, so the
 * screen works offline (item 4), then the server's answer, which is cached per date. Writes are optimistic with
 * rollback, and one at a time so a quick second tap cannot interleave with the first write.
 */
export function useOccasions(userId: string, dates: readonly string[]): OccasionsState {
  const key = dates.join(",");
  const [byDate, setByDate] = useState<Readonly<Record<string, OccasionRow | null>>>({});
  const [failure, setFailure] = useState<{ date: string; type: OccasionType | null } | null>(null);
  const current = useRef(byDate);
  useEffect(() => {
    current.current = byDate;
  }, [byDate]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    const list = key.split(",");
    void (async () => {
      const cached = await Promise.all(list.map(async (d) => [d, await cacheGet<OccasionRow | null>(cacheKey(d), CACHE_MS)] as const));
      if (active) setByDate((cur) => ({ ...Object.fromEntries(cached.filter(([, v]) => v !== null)), ...cur }));
      try {
        const fresh = await fetchOccasions(list);
        if (!active) return;
        setByDate((cur) => ({ ...cur, ...fresh }));
        for (const [d, v] of Object.entries(fresh)) void cacheSet(cacheKey(d), v);
      } catch (error) {
        console.warn("Occasions unavailable, using the device copy", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [key]);

  const choose = useCallback(
    (date: string, type: OccasionType | null) => {
      const before = current.current[date] ?? null;
      if ((before?.type ?? null) === type) return;
      setFailure(null);
      // Optimistic: the chip and the outfit change now (item 4).
      setByDate((cur) => ({ ...cur, [date]: type ? { type, source: "manual", date, payload: {}, createdAt: new Date().toISOString() } : null }));
      queue.current = queue.current.then(async () => {
        try {
          const stored = type ? await storeOccasion(userId, date, type, before) : null;
          if (!type) await clearOccasion(date);
          setByDate((cur) => ({ ...cur, [date]: stored }));
          void cacheSet(cacheKey(date), stored);
        } catch (error) {
          console.error("Occasion write failed", error);
          setByDate((cur) => ({ ...cur, [date]: before }));
          setFailure({ date, type });
        }
      });
    },
    [userId]
  );

  const failed = failure ? { date: failure.date, retry: () => choose(failure.date, failure.type) } : null;
  return { byDate, failed, choose };
}

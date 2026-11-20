import { slotOf } from "@fit-check/engine";
import { SLOTS, type Item, type Slot } from "@fit-check/schema";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { readAllPages } from "../features/insights/pagedRead";
import { localDate as dateInZone } from "./dayContext";
import { daysBefore } from "./feedback";
import { resolveLocation } from "./location";
import { getSnapshot, isPreview } from "./preview";

/**
 * Reads for the Insights screen: what was worn in the last 30 days and this month's AI spend. Read-only. The arithmetic is in pure functions (summarizeWears,
 * summarizeSpend) so the screen, the gallery fixtures and the checks all share one definition of each number.
 */

/** Days in the wear window, today included (DESIGN.md "שלב 2": "30 הימים האחרונים"). */
export const WEAR_WINDOW_DAYS = 30;

/**
 * The monthly Google cap, in USD.
 * don't touch / must equal MONTHLY_GOOGLE_BUDGET_USD in supabase/functions/_shared/ai/budget.ts (the server enforces
 * it there; this copy only draws the bar). The app cannot import Deno code, so the number is repeated on purpose.
 */
export const GOOGLE_MONTHLY_CAP_USD = 8;

/** From this share of the cap on, the spend line warns (DESIGN brief: "within 20% of it"). */
export const CAP_WARN_SHARE = 0.8;

/**
 * "Today" for Insights: the date in the saved location's time zone, the same one the Today screen uses and the one a
 * wear is written with (dayContext.localDate with the location's zone). The device's own date is wrong around
 * midnight whenever the device and the location are in different zones, and would hide a wear dated "tomorrow".
 * Falls back to the default location (Israel) when the setting is unreadable, like Today does.
 */
export async function wearsToday(now: Date = new Date()): Promise<string> {
  const { tz } = await resolveLocation();
  return dateInZone(tz, now).date;
}

// ---------------------------------------------------------------------------------------------------------------
// Wears
// ---------------------------------------------------------------------------------------------------------------

/**
 * One worn outfit: the wear's date, the `outfits` row it points at (what saving it from Insights marks) and its
 * garments (with the slot when the row says it).
 */
export type WornOutfit = { wearId: string; outfitId: string; date: string; pieces: { itemId: string; slot: Slot | null }[] };

/**
 * Wear rows as both read paths return them: the live query below (with `slot`) and the preview snapshot's
 * WEAR_READ_COLUMNS shape (without). Lenient on the rest, like feedback.ts: one bad row is skipped, not fatal.
 */
const WornRowSchema = z.object({
  id: z.string(),
  worn_on: z.string().date(),
  feedback: z.string(),
  // Null when the outfit row was deleted: such a wear has no garments and is dropped below.
  outfit_id: z.string().nullable(),
  outfits: z
    .object({ outfit_items: z.array(z.object({ item_id: z.string(), slot: z.enum(SLOTS).optional() })) })
    .nullable(),
});

const WORN_COLUMNS = "id,worn_on,feedback,outfit_id,outfits(outfit_items(item_id,slot))";

/** First day of the window that ends on `today`. */
export function windowStart(today: string, days = WEAR_WINDOW_DAYS): string {
  return daysBefore(today, days - 1);
}

/**
 * Worn outfits of the last 30 days up to `today`, newest first. Only feedback `worn` (a skip or dislike is not a
 * wear); a wear whose outfit was deleted has no garments and is dropped. Throws on a network or permission error.
 */
export async function fetchWornOutfits(today: string): Promise<WornOutfit[]> {
  const from = windowStart(today);
  // Design preview (web only, temporary): the snapshot holds the last 31 days, newest first; trimmed below.
  if (isPreview()) return wornFromRows((await getSnapshot()).wears, from, today);
  const { data, error } = await supabase
    .from("wears")
    .select(WORN_COLUMNS)
    .eq("feedback", "worn")
    .gte("worn_on", from)
    .lte("worn_on", today)
    .order("worn_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return wornFromRows(data ?? [], from, today);
}

/** Rows (newest first) to worn outfits; the window check repeats the query's, since the snapshot is cut in UTC. */
export function wornFromRows(rows: readonly unknown[], from: string, today: string): WornOutfit[] {
  const out: WornOutfit[] = [];
  for (const raw of rows) {
    const parsed = WornRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Skipping malformed wear row", parsed.error);
      continue;
    }
    const row = parsed.data;
    if (row.feedback !== "worn" || row.worn_on < from || row.worn_on > today || !row.outfits || row.outfit_id === null) continue;
    const pieces = row.outfits.outfit_items.map((i) => ({ itemId: i.item_id, slot: i.slot ?? null }));
    if (pieces.length === 0) continue;
    out.push({ wearId: row.id, outfitId: row.outfit_id, date: row.worn_on, pieces });
  }
  return out;
}

export type WearSummary = {
  /** Distinct days with at least one worn outfit. */
  daysWorn: number;
  /** Distinct garments across those outfits. */
  distinctItems: number;
  /** Most worn garment the wardrobe knows (ties: see {@link summarizeWears}); null when nothing was worn. */
  mostWorn: { item: Item; count: number } | null;
  /** One entry per day, oldest first, so the newest lands at the end side of the strip. */
  days: { date: string; worn: boolean }[];
  /**
   * Worn outfits newest first. `pieces` are the garments placed in a flat-lay slot (what the picture draws); `items`
   * are all the outfit's garments the wardrobe knows, accessories and a second garment for a taken slot included (what
   * the row's name and sheet list).
   */
  outfits: {
    wearId: string;
    /** The `outfits` row of the wear: several wears can share one, and one set of garments can sit on several rows. */
    outfitId: string;
    date: string;
    pieces: { slot: Slot; item: Item }[];
    items: Item[];
    /** Every garment id of the outfit row, known to the wardrobe or not: what "the same garments" compares. */
    itemIds: string[];
    /**
     * The garments with the slot the outfit row gives them (the engine's slot when the row has none, as in the preview
     * snapshot): what a save is checked against. A garment with no slot at all is left out, so the check fails
     * closed (the outfit then misses a required slot and is not offered for saving).
     */
    savePieces: { item_id: string; slot: Slot }[];
  }[];
};

/**
 * The wear numbers of DESIGN.md "שלב 2" ("תובנות"). Pure: the date and the data come in as arguments.
 * Most worn garment, deterministic: the highest wear count in the window; on a tie the one worn most recently (latest
 * wear date); on a further tie the item name in `localeCompare` order. Input order never decides.
 * @param worn - newest first, as fetchWornOutfits returns them.
 * @param items - the loaded wardrobe (archived items included, so an outfit with a since-archived garment still draws).
 */
export function summarizeWears(worn: readonly WornOutfit[], items: readonly Item[], today: string, days = WEAR_WINDOW_DAYS): WearSummary {
  const byId = new Map(items.map((i) => [i.id, i]));
  const from = windowStart(today, days);
  const inWindow = worn.filter((w) => w.date >= from && w.date <= today);
  const wornDates = new Set(inWindow.map((w) => w.date));
  const counts = new Map<string, number>();
  const lastWorn = new Map<string, string>();
  for (const w of inWindow) {
    for (const p of w.pieces) {
      counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
      if ((lastWorn.get(p.itemId) ?? "") < w.date) lastWorn.set(p.itemId, w.date);
    }
  }
  const ranked: { item: Item; count: number; last: string }[] = [];
  for (const [id, count] of counts) {
    const item = byId.get(id);
    if (item) ranked.push({ item, count, last: lastWorn.get(id) ?? "" });
  }
  ranked.sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || a.item.name.localeCompare(b.item.name));
  const top = ranked[0];
  const mostWorn: WearSummary["mostWorn"] = top ? { item: top.item, count: top.count } : null;
  const strip = Array.from({ length: days }, (_, n) => {
    const date = daysBefore(today, days - 1 - n);
    return { date, worn: wornDates.has(date) };
  });
  const outfits = inWindow.map((w) => ({
    wearId: w.wearId,
    outfitId: w.outfitId,
    date: w.date,
    pieces: placePieces(w.pieces, byId),
    items: w.pieces.flatMap((p) => byId.get(p.itemId) ?? []),
    itemIds: w.pieces.map((p) => p.itemId),
    savePieces: w.pieces.flatMap((p) => {
      const item = byId.get(p.itemId);
      const slot = p.slot ?? (item ? slotOf(item) : null);
      return slot ? [{ item_id: p.itemId, slot }] : [];
    }),
  }));
  return { daysWorn: wornDates.size, distinctItems: counts.size, mostWorn, days: strip, outfits };
}

/**
 * Garments to flat-lay slots: the row's slot when it has one, else the engine's (the preview rows carry none). A
 * second garment for a slot that is taken, or one with no slot (an accessory), is left out of the picture.
 */
function placePieces(pieces: WornOutfit["pieces"], byId: ReadonlyMap<string, Item>): { slot: Slot; item: Item }[] {
  const out: { slot: Slot; item: Item }[] = [];
  for (const p of pieces) {
    const item = byId.get(p.itemId);
    if (!item) continue;
    const slot = p.slot ?? slotOf(item);
    if (!slot || out.some((o) => o.slot === slot)) continue;
    out.push({ slot, item });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// AI spend
// ---------------------------------------------------------------------------------------------------------------

const AiCallRowSchema = z.object({
  provider: z.string(),
  task: z.string(),
  // numeric(8,5): a number, or a string when PostgREST cannot represent it exactly.
  cost_usd: z.union([z.number(), z.string()]).nullable(),
});
export type AiCallRow = { provider: string; task: string; cost_usd: number | null };

export type SpendSummary = {
  totalUsd: number;
  googleUsd: number;
  capUsd: number;
  /** Tasks by cost, highest first (ties: more calls first, then by name, so the order is stable). */
  byTask: { task: string; calls: number; usd: number }[];
};

/** The 1st of the current month, 00:00 UTC: the same month boundary budget.ts uses for the cap. */
export function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * `unavailable` in the design preview: its snapshot has no ai_calls, and numbers must not be invented.
 * Reads every row of the month by paging (see readAllPages); `partial` is true when the page cap was hit, and the
 * screen then says the total is partial. Throws on a network or permission error.
 */
export async function fetchMonthSpend(
  now: Date
): Promise<{ kind: "rows"; rows: AiCallRow[]; partial: boolean } | { kind: "unavailable" }> {
  if (isPreview()) return { kind: "unavailable" };
  const monthStart = monthStartUtc(now);
  const { rows: raw, partial } = await readAllPages(async (from, to) => {
    // RLS ("read own ai calls") scopes this to the user; no user_id filter, so a broken policy would show, not hide.
    const { data, error } = await supabase
      .from("ai_calls")
      .select("provider,task,cost_usd")
      .gte("created_at", monthStart)
      // don't touch / a total order (id breaks created_at ties): range paging over an unstable order repeats or skips rows.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });
  const rows: AiCallRow[] = [];
  for (const r of raw) {
    const parsed = AiCallRowSchema.safeParse(r);
    if (!parsed.success) continue;
    const { provider, task, cost_usd } = parsed.data;
    rows.push({ provider, task, cost_usd: cost_usd === null ? null : Number(cost_usd) });
  }
  return { kind: "rows", rows, partial };
}

/**
 * This month's rows to the screen's numbers. Google spend mirrors the mcp `spend_summary` tool (provider = google,
 * this calendar month in UTC, a missing cost counts as 0); budget.ts sums the same Google models across all users
 * with the service role, which for a single user is the same number, and a client can only read its own rows.
 */
export function summarizeSpend(rows: readonly AiCallRow[], capUsd = GOOGLE_MONTHLY_CAP_USD): SpendSummary {
  const byTask = new Map<string, { calls: number; usd: number }>();
  let total = 0;
  let google = 0;
  for (const r of rows) {
    const usd = Number.isFinite(r.cost_usd) ? (r.cost_usd ?? 0) : 0;
    total += usd;
    if (r.provider === "google") google += usd;
    const cur = byTask.get(r.task) ?? { calls: 0, usd: 0 };
    cur.calls += 1;
    cur.usd += usd;
    byTask.set(r.task, cur);
  }
  const tasks = [...byTask].map(([task, v]) => ({ task, ...v }));
  tasks.sort((a, b) => b.usd - a.usd || b.calls - a.calls || a.task.localeCompare(b.task));
  return { totalUsd: total, googleUsd: google, capUsd, byTask: tasks };
}

/** "over" past the cap, "near" from 80% of it, else "ok". */
export function capLevel(spent: number, cap: number): "ok" | "near" | "over" {
  if (spent >= cap) return "over";
  return spent >= cap * CAP_WARN_SHARE ? "near" : "ok";
}

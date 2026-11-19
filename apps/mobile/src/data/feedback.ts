import { RECENT_WEARS_DAYS, type DayAdjustment, type PairUpdate } from "@fit-check/engine";
import { WEAR_READ_COLUMNS, WearRowSchema, type Availability, type CandidateOutfit, type StylingRequest, type WearFeedback } from "@fit-check/schema";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import type { DayType } from "./dayContext";
import { getSnapshot, isPreview, PreviewReadOnlyError } from "./preview";

export type RecentWear = StylingRequest["recent_wears"][number];

/**
 * A piece of feedback for one day, kept so it can be shown and undone. `date` is the day it is for (`wears.worn_on`):
 * today, or a planned day after today's candle lighting.
 */
export type TodayRecord = { wearId: string; outfitId: string; feedback: WearFeedback; itemIds: string[]; date: string };

/** The adjustment one worn outfit was chosen under (engine learnedAdjustment's samples). */
export type AdjustmentSample = { wearId: string; adjustment: DayAdjustment };

/**
 * `recent`: worn outfits up to today, most recent first (the engine's recent_wears). `today`: today's records, oldest
 * first. `ahead`: records for days after today (outfits planned on the eve of Shabbat or a holiday), oldest first.
 * `samples`: the adjustment of every recent worn outfit, planned ones included, for learning the standing lean.
 */
export type FeedbackHistory = { recent: RecentWear[]; today: TodayRecord[]; ahead: TodayRecord[]; samples: AdjustmentSample[] };

/**
 * No wears at all: what Today plans with when the history could not be read (useFeedback logs the failure and shows
 * it), so the screen still offers an outfit, only without freshness. Also the starting value of a fresh history.
 */
export const EMPTY_HISTORY: FeedbackHistory = { recent: [], today: [], ahead: [], samples: [] };

/** yyyy-mm-dd minus `days`, in calendar days. UTC arithmetic so no local timezone can shift the date. */
export function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Wears of the last RECENT_WEARS_DAYS days, up to and including `until` (default `today`; the last planned day on the
 * eve of Shabbat or a holiday, so outfits already recorded for those days are read back). Dates are the user's local
 * ones, not UTC: a wear logged at 01:00 in Israel belongs to that Israeli day. Rows that fail the schema are skipped and
 * logged, like items: one bad row must not hide the rest. Throws on a network or permission error.
 */
export async function fetchFeedback(today: string, until: string = today): Promise<FeedbackHistory> {
  const from = daysBefore(today, RECENT_WEARS_DAYS);
  const last = until > today ? until : today;
  // Design preview (web only, temporary): the snapshot's wears, in the same order, trimmed to the same window below.
  if (isPreview()) return historyFromRows((await getSnapshot()).wears, from, today, last);
  const { data, error } = await supabase
    .from("wears")
    .select(WEAR_READ_COLUMNS)
    .gte("worn_on", from)
    .lte("worn_on", last)
    .order("worn_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return historyFromRows(data ?? [], from, today, last);
}

/**
 * Wear rows, newest first, to history. The window check repeats the query's filter: the preview snapshot is cut on
 * the server's UTC date, which can be a day off the user's local one.
 */
function historyFromRows(rows: readonly unknown[], from: string, today: string, until: string): FeedbackHistory {
  const history: FeedbackHistory = { recent: [], today: [], ahead: [], samples: [] };
  for (const raw of rows) {
    const parsed = WearRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Skipping malformed wear row", parsed.error);
      continue;
    }
    const row = parsed.data;
    if (row.worn_on < from || row.worn_on > until) continue;
    if (!row.outfits || !row.outfit_id) continue;
    const itemIds = row.outfits.outfit_items.map((i) => i.item_id);
    const record: TodayRecord = { wearId: row.id, outfitId: row.outfit_id, feedback: row.feedback, itemIds, date: row.worn_on };
    if (row.feedback === "worn") {
      // A planned day's wear has not happened yet: it is not "recent" for today (the planning adds it per day).
      if (row.worn_on <= today) history.recent.push({ date: row.worn_on, item_ids: itemIds, context_key: null });
      const adjustment = row.outfits.breakdown?.adjustment ?? { temp_steps: 0, formality_steps: 0 };
      history.samples.push({ wearId: row.id, adjustment });
    }
    if (row.worn_on === today) history.today.unshift(record);
    // Rows come newest date first, so unshift leaves the planned days in date order.
    else if (row.worn_on > today) history.ahead.unshift(record);
  }
  return history;
}

/**
 * Stores one outfit and the user's answer to it: an `outfits` row, its `outfit_items`, and a `wears` row.
 * Three inserts, not a transaction (that would need an RPC, i.e. a migration); if a later insert fails the outfit
 * is deleted again (outfit_items cascade), so a failure leaves nothing behind except in a crash mid-way.
 *
 * `user_id` is passed explicitly: RLS checks it equals auth.uid() but does not fill it in.
 */
export async function recordFeedback(args: {
  userId: string;
  date: string;
  dayType: DayType;
  outfit: CandidateOutfit;
  source: "daily" | "swap";
  feedback: WearFeedback;
  /** The total adjustment (learned + today's taps) the outfit was chosen under; learning reads it back. */
  adjustment: DayAdjustment;
}): Promise<TodayRecord> {
  // Design preview: nothing is saved. Today's feedback hook reports the failure and changes nothing on screen.
  if (isPreview()) throw new PreviewReadOnlyError("recordFeedback");
  const { userId, date, dayType, outfit, source, feedback, adjustment } = args;
  const created = await supabase
    .from("outfits")
    .insert({
      user_id: userId,
      context_type: dayType,
      created_for_date: date,
      score: Math.round(outfit.score * 1000) / 1000,
      breakdown: { ...outfit.breakdown, adjustment },
      source,
    })
    .select("id")
    .single();
  if (created.error) throw created.error;
  const outfitId = String(created.data.id);

  try {
    const items = await supabase
      .from("outfit_items")
      .insert(outfit.items.map((i) => ({ outfit_id: outfitId, item_id: i.id, slot: i.slot })));
    if (items.error) throw items.error;
    const wear = await supabase
      .from("wears")
      .insert({ user_id: userId, outfit_id: outfitId, worn_on: date, feedback })
      .select("id")
      .single();
    if (wear.error) throw wear.error;
    return { wearId: String(wear.data.id), outfitId, feedback, itemIds: outfit.items.map((i) => i.id), date };
  } catch (error) {
    await supabase.from("outfits").delete().eq("id", outfitId);
    throw error;
  }
}

/** Turns a skip into a dislike (or back). Only the `wears` row changes; the outfit stays as it was. */
export async function changeFeedback(wearId: string, feedback: WearFeedback): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("changeFeedback");
  const { error } = await supabase.from("wears").update({ feedback }).eq("id", wearId);
  if (error) throw error;
}

/**
 * Undo. The wear goes first: deleting the outfit first would leave the wear behind with outfit_id null
 * (`on delete set null`), an orphan that still says "worn".
 */
export async function deleteFeedback(record: TodayRecord): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("deleteFeedback");
  const wear = await supabase.from("wears").delete().eq("id", record.wearId);
  if (wear.error) throw wear.error;
  const outfit = await supabase.from("outfits").delete().eq("id", record.outfitId);
  if (outfit.error) throw outfit.error;
}

/** Writes learned pair weights. Upsert on the primary key, so a pair seen for the first time is inserted. */
export async function savePairWeights(userId: string, updates: readonly PairUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  if (isPreview()) throw new PreviewReadOnlyError("savePairWeights");
  const now = new Date().toISOString();
  const { error } = await supabase.from("pair_weights").upsert(
    updates.map((u) => ({ user_id: userId, item_a: u.a, item_b: u.b, weight: u.weight, updated_at: now })),
    { onConflict: "user_id,item_a,item_b" }
  );
  if (error) throw error;
}

/**
 * `washed`: the item came back clean, so its wear count restarts (items.washed_at). Not set when the user only
 * overrides an automatic laundry move ("אל תעביר לכביסה"): that garment was not washed and its count must keep going.
 */
type MoveOptions = { washed?: boolean };

const moveRow = (availability: Availability, { washed = false }: MoveOptions) =>
  washed ? { availability, washed_at: new Date().toISOString() } : { availability };

/** Home, laundry, away (reserve duty) or lent. Only `home` items are ever suggested. */
export async function setAvailability(itemId: string, availability: Availability, options: MoveOptions = {}): Promise<void> {
  // Design preview: the item screen moves the control back and says the change did not save.
  if (isPreview()) throw new PreviewReadOnlyError("setAvailability");
  const { error } = await supabase.from("items").update(moveRow(availability, options)).eq("id", itemId);
  if (error) throw error;
}

/** Worn wears per item since its last wash (SQL function wear_counts_since_wash, migration 0003; RLS applies). */
export async function fetchWearCounts(itemIds: readonly string[]): Promise<Map<string, number>> {
  // Design preview: only read after a wear was stored, which preview never does; an RPC as anon would see nothing.
  if (isPreview()) return new Map();
  const { data, error } = await supabase.rpc("wear_counts_since_wash", { p_item_ids: [...itemIds] });
  if (error) throw error;
  const parsed = z.array(z.object({ item_id: z.string(), wears: z.number().int() })).parse(data ?? []);
  return new Map(parsed.map((r) => [r.item_id, r.wears]));
}

/**
 * Moves several items at once (packing for reserve duty, coming back). One request, so the move is all or nothing
 * from the user's side: either every packed item reads "away" or the screen reports the failure.
 */
export async function setAvailabilityMany(itemIds: readonly string[], availability: Availability, options: MoveOptions = {}): Promise<void> {
  if (itemIds.length === 0) return;
  // Design preview: the wardrobe screen puts every item back and reports the failure.
  if (isPreview()) throw new PreviewReadOnlyError("setAvailabilityMany");
  const { error } = await supabase.from("items").update(moveRow(availability, options)).in("id", [...itemIds]);
  if (error) throw error;
}

/** One worn outfit that contained a given item: the day and every item of that outfit (the item itself included). */
export type ItemWear = { wearId: string; date: string; itemIds: string[] };

/** `total`: every worn wear of the item; `wears`: the newest of them, at most ITEM_WEARS_LIMIT, newest first. */
export type ItemWearHistory = { total: number; wears: ItemWear[] };

/** The item screen lists five and expands to the rest; more rows than this is a log, not a screen. */
export const ITEM_WEARS_LIMIT = 50;

// The outfit's items are embedded twice: `outfit_items` lists the whole outfit (for "worn with"), the aliased inner
// copy `mine` exists only to be filtered on this item. Filtering `outfit_items` itself would cut the list down to the
// one item. Checked against the live PostgREST on 2026-11-19 (valid: 200; an unknown alias answers 400).
const ITEM_WEAR_COLUMNS = "id,worn_on,feedback,outfit_id,outfits!inner(breakdown,outfit_items(item_id),mine:outfit_items!inner(item_id))";

/**
 * The wear history of one item for the item screen: wears with feedback `worn` whose outfit contains the item, all
 * time, newest first, at most ITEM_WEARS_LIMIT rows; `total` is exact even past the limit. RLS scopes the rows to
 * the signed-in user. Design preview: derived from the snapshot, which holds only the last RECENT_WEARS_DAYS + 1
 * days, so the preview shows that window, not all time. Rows that fail the schema are skipped and logged.
 * Throws on a network or permission error (the screen shows a retry).
 * @param itemId - the item's uuid.
 */
export async function fetchItemWears(itemId: string): Promise<ItemWearHistory> {
  if (isPreview()) {
    const all = wearsOfItem((await getSnapshot()).wears, itemId);
    return { total: all.length, wears: all.slice(0, ITEM_WEARS_LIMIT) };
  }
  const { data, error, count } = await supabase
    .from("wears")
    .select(ITEM_WEAR_COLUMNS, { count: "exact" })
    .eq("feedback", "worn")
    .eq("outfits.mine.item_id", itemId)
    .order("worn_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ITEM_WEARS_LIMIT);
  if (error) throw error;
  const wears = wearsOfItem(data ?? [], itemId);
  return { total: Math.max(count ?? 0, wears.length), wears };
}

/** Wear rows, newest first, to the worn wears whose outfit holds `itemId` (the query filters too; the snapshot does not). */
function wearsOfItem(rows: readonly unknown[], itemId: string): ItemWear[] {
  const out: ItemWear[] = [];
  for (const raw of rows) {
    const parsed = WearRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Skipping malformed wear row", parsed.error);
      continue;
    }
    const row = parsed.data;
    if (row.feedback !== "worn" || !row.outfits) continue;
    const itemIds = row.outfits.outfit_items.map((i) => i.item_id);
    if (!itemIds.includes(itemId)) continue;
    out.push({ wearId: row.id, date: row.worn_on, itemIds });
  }
  return out;
}

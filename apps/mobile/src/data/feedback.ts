import { RECENT_WEARS_DAYS, type DayAdjustment, type PairUpdate } from "@fit-check/engine";
import { WEAR_READ_COLUMNS, WearRowSchema, type Availability, type CandidateOutfit, type StylingRequest, type WearFeedback } from "@fit-check/schema";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import type { DayType } from "./dayContext";

export type RecentWear = StylingRequest["recent_wears"][number];

/** A piece of feedback given today, kept so it can be shown and undone. */
export type TodayRecord = { wearId: string; outfitId: string; feedback: WearFeedback; itemIds: string[] };

/** The adjustment one worn outfit was chosen under (engine learnedAdjustment's samples). */
export type AdjustmentSample = { wearId: string; adjustment: DayAdjustment };

/**
 * `recent`: worn outfits, most recent first (the engine's recent_wears). `today`: today's records, oldest first.
 * `samples`: the adjustment of every recent worn outfit, for learning the user's standing lean.
 */
export type FeedbackHistory = { recent: RecentWear[]; today: TodayRecord[]; samples: AdjustmentSample[] };

export const EMPTY_HISTORY: FeedbackHistory = { recent: [], today: [], samples: [] };

/** yyyy-mm-dd minus `days`, in calendar days. UTC arithmetic so no local timezone can shift the date. */
export function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Wears of the last RECENT_WEARS_DAYS days, up to and including `today` (the user's local date, not UTC: a wear
 * logged at 01:00 in Israel belongs to that Israeli day). Rows that fail the schema are skipped and logged, like
 * items: one bad row must not hide the rest. Throws on a network or permission error.
 */
export async function fetchFeedback(today: string): Promise<FeedbackHistory> {
  const { data, error } = await supabase
    .from("wears")
    .select(WEAR_READ_COLUMNS)
    .gte("worn_on", daysBefore(today, RECENT_WEARS_DAYS))
    .lte("worn_on", today)
    .order("worn_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const history: FeedbackHistory = { recent: [], today: [], samples: [] };
  for (const raw of data ?? []) {
    const parsed = WearRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Skipping malformed wear row", parsed.error);
      continue;
    }
    const row = parsed.data;
    if (!row.outfits || !row.outfit_id) continue;
    const itemIds = row.outfits.outfit_items.map((i) => i.item_id);
    if (row.feedback === "worn") {
      history.recent.push({ date: row.worn_on, item_ids: itemIds, context_key: null });
      const adjustment = row.outfits.breakdown?.adjustment ?? { temp_steps: 0, formality_steps: 0 };
      history.samples.push({ wearId: row.id, adjustment });
    }
    if (row.worn_on === today) history.today.unshift({ wearId: row.id, outfitId: row.outfit_id, feedback: row.feedback, itemIds });
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
    return { wearId: String(wear.data.id), outfitId, feedback, itemIds: outfit.items.map((i) => i.id) };
  } catch (error) {
    await supabase.from("outfits").delete().eq("id", outfitId);
    throw error;
  }
}

/** Turns a skip into a dislike (or back). Only the `wears` row changes; the outfit stays as it was. */
export async function changeFeedback(wearId: string, feedback: WearFeedback): Promise<void> {
  const { error } = await supabase.from("wears").update({ feedback }).eq("id", wearId);
  if (error) throw error;
}

/**
 * Undo. The wear goes first: deleting the outfit first would leave the wear behind with outfit_id null
 * (`on delete set null`), an orphan that still says "worn".
 */
export async function deleteFeedback(record: TodayRecord): Promise<void> {
  const wear = await supabase.from("wears").delete().eq("id", record.wearId);
  if (wear.error) throw wear.error;
  const outfit = await supabase.from("outfits").delete().eq("id", record.outfitId);
  if (outfit.error) throw outfit.error;
}

/** Writes learned pair weights. Upsert on the primary key, so a pair seen for the first time is inserted. */
export async function savePairWeights(userId: string, updates: readonly PairUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("pair_weights").upsert(
    updates.map((u) => ({ user_id: userId, item_a: u.a, item_b: u.b, weight: u.weight, updated_at: now })),
    { onConflict: "user_id,item_a,item_b" }
  );
  if (error) throw error;
}

/**
 * `washed`: the item came back clean, so its wear count restarts (items.washed_at). Not set when the user only
 * overrides an automatic laundry move ("השאר בבית"): that garment was not washed and its count must keep going.
 */
type MoveOptions = { washed?: boolean };

const moveRow = (availability: Availability, { washed = false }: MoveOptions) =>
  washed ? { availability, washed_at: new Date().toISOString() } : { availability };

/** Home, laundry, away (reserve duty) or lent. Only `home` items are ever suggested. */
export async function setAvailability(itemId: string, availability: Availability, options: MoveOptions = {}): Promise<void> {
  const { error } = await supabase.from("items").update(moveRow(availability, options)).eq("id", itemId);
  if (error) throw error;
}

/** Worn wears per item since its last wash (SQL function wear_counts_since_wash, migration 0003; RLS applies). */
export async function fetchWearCounts(itemIds: readonly string[]): Promise<Map<string, number>> {
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
  const { error } = await supabase.from("items").update(moveRow(availability, options)).in("id", [...itemIds]);
  if (error) throw error;
}

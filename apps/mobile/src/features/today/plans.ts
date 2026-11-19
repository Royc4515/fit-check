import { FESTIVE_FORMALITY_STEPS, NO_ADJUSTMENT, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Item, OccasionType } from "@fit-check/schema";
import type { FeedbackHistory, RecentWear, TodayRecord } from "../../data/feedback";
import { contextTypeOf, planToday, type DayInput, type Swaps, type TodayPlan } from "./outfit";

/** One day's plan on Today: today first, then each planned phone-free day (DESIGN.md "שלב 4.1"). */
export type DayPlan = {
  day: DayInput;
  /** What the day's tab shows: the engine's pick, the stylist's preference and the user's swaps applied. */
  plan: TodayPlan;
  /** The same day in the engine's own order (no swaps, no preference): the stylist chooses among its candidates. */
  base: TodayPlan;
  /** The garments this day may offer (swap options come from here too): reserved ones are left out. */
  pool: Item[];
  /** The history this day was planned with (its own records as `today`, earlier days' looks as recent wears). */
  history: FeedbackHistory;
};

/**
 * The taps a day starts with before the user touches the adjust sheet: one "dressier" step on a holiday planned by the
 * weekday rules (the observance switch off, DESIGN.md "שלב 4.1" item 10), none otherwise. A starting value of the
 * day's taps, not a hidden term: the sheet and the "adjusted for today" line show it, and reset or "more casual"
 * take it back.
 */
export function defaultAdjustment(day: Pick<DayInput, "festive" | "occasion">): DayAdjustment {
  // An occasion is chosen outright and brings its own rules: no festive step on top (as the shared planDay rules).
  return day.festive && !day.occasion ? { temp_steps: 0, formality_steps: FESTIVE_FORMALITY_STEPS } : NO_ADJUSTMENT;
}

/**
 * Whether a day's occasion (date, interview, event) may decide its look (DESIGN.md "שלב 4.5" item 3, corrected
 * 19.11): on a weekday, yes; on Shabbat or a holiday for someone who keeps them, only after that date's havdalah
 * (a date on Saturday night gets a date look; the Shabbat look itself stays Shabbat's), and never on a date without
 * a havdalah (the first day of a two-day holiday). A planned day's tab ("for Shabbat", "for the holiday") never.
 * With the observance switch off, Shabbat and holidays already reach here as weekdays, so the occasion always wins.
 * Pure: the time comes in as data.
 *
 * @param args.tab "today", or "planned" for a tab after it.
 * @param args.dayType The calendar's day type for that date, after the observance switch (dayTypeFor).
 * @param args.havdalahToday That date's havdalah `HH:MM` when it falls on that date (shabbatTimes `end`), else null.
 * @param args.now The local time `HH:MM`.
 */
export function occasionMayApply(args: { tab: "today" | "planned"; dayType: DayInput["dayType"]; havdalahToday: string | null; now: string }): boolean {
  if (args.tab === "planned") return false;
  if (args.dayType === "weekday") return true;
  // Zero-padded `HH:MM` strings compare in time order.
  return args.havdalahToday !== null && args.now >= args.havdalahToday;
}

/** The occasion that decides a day's look: the stored one when it may apply (occasionMayApply), else none. */
export function occasionInEffect(
  occasion: OccasionType | null | undefined,
  args: Parameters<typeof occasionMayApply>[0]
): OccasionType | undefined {
  return occasion && occasionMayApply(args) ? occasion : undefined;
}

/** The look a day stands for in the planning of the days after it: recorded if worn, else the one shown. */
function lookOf(plan: TodayPlan): string[] | null {
  if (plan.kind === "worn") return plan.record.itemIds;
  if (plan.kind === "suggestion") return plan.items.map((i) => i.id);
  return null;
}

const lastWorn = (records: readonly TodayRecord[]) => [...records].reverse().find((r) => r.feedback === "worn") ?? null;

/**
 * Plans today and every planned day after it, in date order. Pure: the days, the history and the session's
 * nudges, swaps and stylist picks all come in as arguments, so the screen and the tests agree.
 *
 * - Each day is `planToday` for its own date, context and forecast, with its own records (`history.today` for today,
 *   `history.ahead` filtered by date for a planned day).
 * - A later day sees every earlier day's look as worn on that day's date (recorded if recorded, otherwise the one
 *   currently shown), so the engine's existing recency rule varies them (DESIGN.md "שלב 4.1" item 8). Today's
 *   recorded wear is already in `history.recent` and is not added twice.
 * - A garment in an outfit recorded as worn for a later day is not offered on an earlier one (item 5: it is kept
 *   for Shabbat), unless it is in that earlier day's own recorded outfit.
 *
 * @param args.days Today first, then the chain in order; one day gives exactly `planToday` for today.
 * @param args.adjustments The effective adjustment (learned + the day's taps) per day, same order as `days`.
 * @param args.swaps Per day, same order; a missing entry means none.
 * @param args.prefer The stylist's pick for day `k`, given that day's engine-order plan (whose candidates the stylist
 * was shown): a lookup, called in order, because a day's candidates depend on the looks chosen before it.
 */
export function planDays(args: {
  items: Item[];
  pairWeights: PairWeights;
  days: readonly DayInput[];
  history: FeedbackHistory;
  adjustments: readonly DayAdjustment[];
  swaps?: readonly (Swaps | undefined)[];
  prefer?: (k: number, base: TodayPlan) => string | null;
}): DayPlan[] {
  const { items, pairWeights, days, history, adjustments, swaps = [], prefer } = args;
  const recordsOf = (k: number): TodayRecord[] => (k === 0 ? history.today : history.ahead.filter((r) => r.date === days[k]!.date));
  const out: DayPlan[] = [];
  for (let k = 0; k < days.length; k++) {
    const day = days[k]!;
    const records = recordsOf(k);
    const own = new Set(lastWorn(records)?.itemIds ?? []);
    const reserved = new Set<string>();
    for (let j = k + 1; j < days.length; j++) for (const id of lastWorn(recordsOf(j))?.itemIds ?? []) if (!own.has(id)) reserved.add(id);
    const pool = reserved.size === 0 ? items : items.filter((i) => !reserved.has(i.id));

    // Earlier days, newest first, ahead of the real history (all of which is on or before today).
    const earlier: RecentWear[] = [];
    for (let j = k - 1; j >= 0; j--) {
      const prev = out[j]!;
      if (j === 0 && prev.plan.kind === "worn") continue;
      const look = lookOf(prev.plan);
      if (look) earlier.push({ date: prev.day.date, item_ids: look, context_key: null, context_type: contextTypeOf(prev.day) });
    }
    const dayHistory: FeedbackHistory = { recent: [...earlier, ...history.recent], today: records, ahead: [], samples: history.samples };
    const adjustment = adjustments[k];
    const base = planToday({ items: pool, pairWeights, day, history: dayHistory, adjustment });
    const plan = planToday({ items: pool, pairWeights, day, history: dayHistory, adjustment, swaps: swaps[k] ?? {}, preferredId: prefer?.(k, base) ?? null });
    out.push({ day, plan, base, pool, history: dayHistory });
  }
  return out;
}

import { FESTIVE_FORMALITY_STEPS, NO_ADJUSTMENT, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import type { FeedbackHistory, RecentWear, TodayRecord } from "../../data/feedback";
import { planToday, type DayInput, type Swaps, type TodayPlan } from "./outfit";

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
export function defaultAdjustment(day: Pick<DayInput, "festive">): DayAdjustment {
  return day.festive ? { temp_steps: 0, formality_steps: FESTIVE_FORMALITY_STEPS } : NO_ADJUSTMENT;
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
      if (look) earlier.push({ date: prev.day.date, item_ids: look, context_key: null });
    }
    const dayHistory: FeedbackHistory = { recent: [...earlier, ...history.recent], today: records, ahead: [], samples: history.samples };
    const adjustment = adjustments[k];
    const base = planToday({ items: pool, pairWeights, day, history: dayHistory, adjustment });
    const plan = planToday({ items: pool, pairWeights, day, history: dayHistory, adjustment, swaps: swaps[k] ?? {}, preferredId: prefer?.(k, base) ?? null });
    out.push({ day, plan, base, pool, history: dayHistory });
  }
  return out;
}

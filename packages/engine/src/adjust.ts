import type { StylingRequest } from "@fit-check/schema";
import { ADJUST_STEP, PERSONAL_ADJUSTMENT } from "./config";

/**
 * Today's manual nudges, in taps. Positive temp = "warmer clothes", positive formality = "dressier".
 * Session-only for now: persisting a personal offset ("I run cold") needs a profile column (see docs/PLAN.md A6).
 */
export type DayAdjustment = { temp_steps: number; formality_steps: number };

export const NO_ADJUSTMENT: DayAdjustment = { temp_steps: 0, formality_steps: 0 };

/**
 * Applies the nudges to a request. Warmer clothes are asked for by making the day colder, so every weather rule
 * (layer threshold, warm-day-only items, per-slot ranges) responds without a second code path.
 * The formality band keeps its width and is pushed back inside 1..10 instead of being squashed at the edge.
 */
export function adjustRequest(req: StylingRequest, adj: DayAdjustment): StylingRequest {
  if (adj.temp_steps === 0 && adj.formality_steps === 0) return req;
  const dt = -adj.temp_steps * ADJUST_STEP.temp_c;
  const [lo, hi] = req.context.formality_range;
  const width = hi - lo;
  const newLo = Math.max(1, Math.min(10 - width, lo + adj.formality_steps * ADJUST_STEP.formality));
  return {
    ...req,
    weather: { ...req.weather, temp_min_c: req.weather.temp_min_c + dt, temp_max_c: req.weather.temp_max_c + dt },
    context: { ...req.context, formality_range: [newLo, newLo + width] },
  };
}

/** Adds two adjustments (today's taps on top of the learned lean). */
export function combineAdjustments(a: DayAdjustment, b: DayAdjustment): DayAdjustment {
  return { temp_steps: a.temp_steps + b.temp_steps, formality_steps: a.formality_steps + b.formality_steps };
}

function lean(values: readonly number[]): number {
  const { min_samples, majority, max_steps } = PERSONAL_ADJUSTMENT;
  if (values.length < min_samples) return 0;
  const up = values.filter((v) => v > 0).length / values.length;
  const down = values.filter((v) => v < 0).length / values.length;
  if (up > majority) return max_steps;
  if (down > majority) return -max_steps;
  return 0;
}

/**
 * The user's standing lean, learned from the adjustments their recent worn outfits were chosen under.
 *
 * don't touch / samples must be the TOTAL adjustment each outfit was worn under (learned + today's taps), not the
 * taps alone. With taps alone, a learned +1 that is right would be followed by untapped wears, which read as 0,
 * which would switch the lean off again: the suggestions would oscillate. With totals, agreeing with the lean
 * keeps it, and tapping against it erodes it.
 */
export function learnedAdjustment(samples: readonly DayAdjustment[]): DayAdjustment {
  return {
    temp_steps: lean(samples.map((s) => s.temp_steps)),
    formality_steps: lean(samples.map((s) => s.formality_steps)),
  };
}

import type { StylingRequest } from "@fit-check/schema";
import { ADJUST_STEP } from "./config";

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

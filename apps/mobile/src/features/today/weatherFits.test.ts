import { NO_ADJUSTMENT, slotOf } from "@fit-check/engine";
import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import type { FeedbackHistory } from "../../data/feedback";
import { planToday, weatherStillFits, type DayInput } from "./outfit";

// Not imported from data/feedback: that module talks to Supabase, and this runner never loads React Native.
const EMPTY_HISTORY: FeedbackHistory = { recent: [], today: [], ahead: [], samples: [] };
const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));

const WARM = { temp_min_c: 22, temp_max_c: 30, rain_probability: 0 };
const COLD_RAIN = { temp_min_c: 7, temp_max_c: 12, rain_probability: 0.9 };
const day = (weather: DayInput["weather"]): DayInput => ({ date: "2026-11-20", weather, dayType: "weekday" });

/** The garments Today would show for that weather. */
function shown(weather: DayInput["weather"], adjustment = NO_ADJUSTMENT): Item[] {
  const plan = planToday({ items: wardrobe, pairWeights: new Map(), day: day(weather), history: EMPTY_HISTORY, adjustment });
  if (plan.kind !== "suggestion") throw new Error("no suggestion");
  return plan.items;
}

describe("weatherStillFits: does a late forecast make the outfit on screen wrong?", () => {
  it("the same forecast: yes it fits", () => {
    expect(weatherStillFits({ outfit: shown(WARM), pool: wardrobe, day: day(WARM), adjustment: NO_ADJUSTMENT })).toBe(true);
  });

  it("a warm forecast's outfit on a day that turned cold and rainy does not fit", () => {
    expect(weatherStillFits({ outfit: shown(WARM), pool: wardrobe, day: day(COLD_RAIN), adjustment: NO_ADJUSTMENT })).toBe(false);
  });

  it("an outfit planned without a forecast (the mild fallback, with a layer) still fits a much colder day", () => {
    const outfit = shown(null);
    expect(outfit.some((i) => slotOf(i) === "layer")).toBe(true);
    expect(weatherStillFits({ outfit, pool: wardrobe, day: day(COLD_RAIN), adjustment: NO_ADJUSTMENT })).toBe(true);
  });

  it("a cold day's layered outfit does not fit a day that turned warm", () => {
    expect(weatherStillFits({ outfit: shown(COLD_RAIN), pool: wardrobe, day: day(WARM), adjustment: NO_ADJUSTMENT })).toBe(false);
  });

  it("judges with the day's nudges, as the outfit was planned", () => {
    // "Warmer" on a warm day asks for colder-day clothes; the same nudge keeps them valid under the same forecast.
    const warmer = { temp_steps: 1, formality_steps: 0 };
    const outfit = shown(WARM, warmer);
    expect(weatherStillFits({ outfit, pool: wardrobe, day: day(WARM), adjustment: warmer })).toBe(true);
  });
});

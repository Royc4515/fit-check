import { NO_ADJUSTMENT, slotOf } from "@fit-check/engine";
import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import type { FeedbackHistory } from "../../data/feedback";
import { initialWeatherInForce, nextWeatherInForce, weatherInForceFor } from "./learning";
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

describe("skip and undo after a late forecast (the independent check's replay)", () => {
  // Stored forecast 17 to 30 in force when the screen opened; a fresh 18 to 24 answers later and leaves the outfit valid.
  const STORED = { temp_min_c: 17, temp_max_c: 30, rain_probability: 0 };
  const FRESH = { temp_min_c: 18, temp_max_c: 24, rain_probability: 0 };
  const TODAY = "2026-11-20";
  const triggers = (skips: number) => ({ skips, adjustments: NO_ADJUSTMENT, occasion: null, refresh: 0, tab: TODAY, today: TODAY });
  const ids = (history: FeedbackHistory, w: DayInput["weather"]) => {
    const plan = planToday({ items: wardrobe, pairWeights: new Map(), day: day(w), history });
    if (plan.kind !== "suggestion") throw new Error("no suggestion");
    return plan.items.map((i) => i.id);
  };

  it("undo shows the skipped outfit exactly as it was, planned with the stored forecast", () => {
    let live: DayInput["weather"] = STORED;
    const liveOf = () => live;
    let state = initialWeatherInForce(triggers(0), liveOf);
    const first = ids(EMPTY_HISTORY, weatherInForceFor(state, TODAY, liveOf));
    // The fresh forecast arrives: the outfit on screen is still valid under it, and is kept.
    live = FRESH;
    state = nextWeatherInForce(state, triggers(0), liveOf);
    expect(ids(EMPTY_HISTORY, weatherInForceFor(state, TODAY, liveOf))).toEqual(first);
    expect(weatherStillFits({ outfit: first.map((id) => wardrobe.find((i) => i.id === id)!), pool: wardrobe, day: day(FRESH), adjustment: NO_ADJUSTMENT })).toBe(true);
    // Skip: the next outfit is planned with the fresh forecast.
    const skipped: FeedbackHistory = { ...EMPTY_HISTORY, today: [{ wearId: "s1", outfitId: "o1", feedback: "skipped", itemIds: first, date: TODAY }] };
    state = nextWeatherInForce(state, triggers(1), liveOf);
    expect(weatherInForceFor(state, TODAY, liveOf)).toBe(FRESH);
    const next = ids(skipped, weatherInForceFor(state, TODAY, liveOf));
    expect(next).not.toEqual(first);
    // Undo: the stored forecast comes back with the skipped outfit.
    state = nextWeatherInForce(state, triggers(0), liveOf);
    expect(weatherInForceFor(state, TODAY, liveOf)).toBe(STORED);
    expect(ids(EMPTY_HISTORY, weatherInForceFor(state, TODAY, liveOf))).toEqual(first);
  });
});

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

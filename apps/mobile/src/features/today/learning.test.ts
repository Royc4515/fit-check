import type { SavedOutfitSignal } from "@fit-check/engine";
import { describe, expect, it } from "vitest";
import type { TodayRecord } from "../../data/feedback";
import {
  firstGeneration,
  firstSuggestion,
  firstWeather,
  initialLearn,
  learnedFrom,
  nextLearn,
  nextWeatherInForce,
  SAVED_LIST_GRACE_MS,
  skipCount,
  WEATHER_GRACE_MS,
} from "./learning";

const A: readonly SavedOutfitSignal[] = [{ itemIds: ["1", "2", "3"], isFavorite: false }];
const B: readonly SavedOutfitSignal[] = [...A, { itemIds: ["4", "5", "6"], isFavorite: true }];
const rec = (feedback: TodayRecord["feedback"], date = "2026-11-20"): TodayRecord => ({
  wearId: `${feedback}-${date}`,
  outfitId: "o",
  feedback,
  itemIds: ["1"],
  date,
});

describe("skipCount", () => {
  it("counts every answer that is not a wear, today and ahead", () => {
    expect(skipCount({ today: [rec("worn"), rec("skipped"), rec("disliked")], ahead: [rec("skipped", "2026-11-21"), rec("worn", "2026-11-21")] })).toBe(3);
    expect(skipCount({ today: [], ahead: [] })).toBe(0);
  });
});

describe("the saved outfits Today learns from", () => {
  const taps = {};

  it("opens with the list when it was already read, with none while it loads", () => {
    expect(learnedFrom(initialLearn(0, taps, A))).toBe(A);
    expect(learnedFrom(initialLearn(0, taps, null))).toEqual([]);
  });

  it("a list that arrives later changes nothing on screen: the same state, by identity", () => {
    const opened = initialLearn(0, taps, null);
    expect(nextLearn(opened, 0, taps, A)).toBe(opened);
    expect(nextLearn(opened, 0, taps, B)).toBe(opened);
  });

  it("a new skip takes in the latest list; an undo goes back to the list before it", () => {
    const opened = initialLearn(0, taps, null);
    const skipped = nextLearn(opened, 1, taps, A);
    expect(learnedFrom(skipped)).toBe(A);
    const undone = nextLearn(skipped, 0, taps, B);
    expect(learnedFrom(undone)).toEqual([]);
    const again = nextLearn(undone, 1, taps, B);
    expect(learnedFrom(again)).toBe(B);
  });

  it("a nudge takes in the latest list", () => {
    const opened = initialLearn(0, taps, null);
    const nudged = nextLearn(opened, 0, { "2026-11-20": { temp_steps: 1, formality_steps: 0 } }, A);
    expect(learnedFrom(nudged)).toBe(A);
  });

  it("a regeneration while the list is still not read keeps the list in force", () => {
    const opened = initialLearn(0, taps, A);
    expect(learnedFrom(nextLearn(opened, 1, taps, null))).toBe(A);
  });

  it("undoing a skip recorded before the screen opened takes the latest list", () => {
    const opened = initialLearn(2, taps, null);
    expect(learnedFrom(nextLearn(opened, 1, taps, A))).toBe(A);
  });
});

describe("the first generation and the saved list", () => {
  it("waits while the other inputs are not ready, whatever the list", () => {
    expect(firstGeneration({ othersReady: false, saved: "ready", waitedMs: 0 })).toBe("wait");
    expect(firstGeneration({ othersReady: false, saved: "error", waitedMs: 9999 })).toBe("wait");
  });

  it("goes with the list as soon as it has answered, without it as soon as it failed", () => {
    expect(firstGeneration({ othersReady: true, saved: "ready", waitedMs: 0 })).toBe("with");
    expect(firstGeneration({ othersReady: true, saved: "ready", waitedMs: 5000 })).toBe("with");
    expect(firstGeneration({ othersReady: true, saved: "error", waitedMs: 0 })).toBe("without");
  });

  it("waits for a loading list for the grace period only", () => {
    expect(firstGeneration({ othersReady: true, saved: "loading", waitedMs: 0 })).toBe("wait");
    expect(firstGeneration({ othersReady: true, saved: "loading", waitedMs: SAVED_LIST_GRACE_MS - 1 })).toBe("wait");
    expect(firstGeneration({ othersReady: true, saved: "loading", waitedMs: SAVED_LIST_GRACE_MS })).toBe("without");
  });
});

describe("the first suggestion's weather", () => {
  const ready = { othersReady: true, cached: false, waitedMs: 0 };

  it("waits for the other inputs whatever the forecast does", () => {
    expect(firstWeather({ ...ready, othersReady: false, forecast: "fresh" })).toBe("wait");
  });

  it("an answered forecast is used at once", () => {
    expect(firstWeather({ ...ready, forecast: "fresh" })).toBe("fresh");
    expect(firstWeather({ ...ready, forecast: "fresh", cached: true, waitedMs: WEATHER_GRACE_MS * 4 })).toBe("fresh");
  });

  it("a loading forecast is waited for until the bound, then the cache or nothing", () => {
    expect(firstWeather({ ...ready, forecast: "loading", waitedMs: WEATHER_GRACE_MS - 1 })).toBe("wait");
    expect(firstWeather({ ...ready, forecast: "loading", waitedMs: WEATHER_GRACE_MS })).toBe("without");
    expect(firstWeather({ ...ready, forecast: "loading", cached: true, waitedMs: WEATHER_GRACE_MS })).toBe("cached");
  });

  it("a failed forecast is not waited for", () => {
    expect(firstWeather({ ...ready, forecast: "failed" })).toBe("without");
    expect(firstWeather({ ...ready, forecast: "failed", cached: true })).toBe("cached");
  });

  it("the bound is short: 2.5 s", () => {
    expect(WEATHER_GRACE_MS).toBe(2500);
  });
});

describe("the two bounded waits together", () => {
  const base = { othersReady: true, saved: "ready" as const, savedWaitedMs: 0, forecast: "fresh" as const, cached: false, forecastWaitedMs: 0 };

  it("goes when both have answered", () => {
    expect(firstSuggestion(base)).toEqual({ saved: "with", weather: "fresh" });
  });

  it("waits while either waits", () => {
    expect(firstSuggestion({ ...base, saved: "loading" })).toBe("wait");
    expect(firstSuggestion({ ...base, forecast: "loading" })).toBe("wait");
    expect(firstSuggestion({ ...base, othersReady: false })).toBe("wait");
  });

  it("never waits beyond the later of the two bounds, each from its own start", () => {
    // Timeline in ms from opening: the forecast request starts at 100, the other inputs are ready at 1800, and nothing
    // answers. The saved wait ends at 1800 + 1500 = 3300, the weather wait at 100 + 2500 = 2600: drawn at 3300, not at
    // the 5800 that adding the two bounds would give.
    const forecastStart = 100;
    const othersAt = 1800;
    const at = (t: number) =>
      firstSuggestion({
        othersReady: t >= othersAt,
        saved: "loading",
        savedWaitedMs: Math.max(0, t - othersAt),
        forecast: "loading",
        cached: true,
        forecastWaitedMs: t - forecastStart,
      });
    expect(at(2600)).toBe("wait");
    expect(at(3299)).toBe("wait");
    expect(at(3300)).toEqual({ saved: "without", weather: "cached" });
  });

  it("with the other inputs ready early, the weather bound decides", () => {
    const at = (t: number) =>
      firstSuggestion({ othersReady: true, saved: "ready", savedWaitedMs: t, forecast: "loading", cached: false, forecastWaitedMs: t });
    expect(at(2499)).toBe("wait");
    expect(at(2500)).toEqual({ saved: "with", weather: "without" });
  });
});

describe("the forecast in force", () => {
  const taps = {};
  const same = { skips: 0, adjustments: taps, tab: "2026-11-20", occasion: null, refresh: 0 };
  const opened = { ...same, weather: "cached" };

  it("a forecast that answers later changes nothing: the same state, by identity", () => {
    expect(nextWeatherInForce(opened, same, "fresh")).toBe(opened);
  });

  it("a skip, a nudge, a tab change, an occasion or 'update' takes the latest forecast in", () => {
    expect(nextWeatherInForce(opened, { ...same, skips: 1 }, "fresh").weather).toBe("fresh");
    expect(nextWeatherInForce(opened, { ...same, adjustments: {} }, "fresh").weather).toBe("fresh");
    expect(nextWeatherInForce(opened, { ...same, tab: "2026-11-21" }, "fresh").weather).toBe("fresh");
    expect(nextWeatherInForce(opened, { ...same, occasion: "date" }, "fresh").weather).toBe("fresh");
    expect(nextWeatherInForce(opened, { ...same, refresh: 1 }, "fresh").weather).toBe("fresh");
  });

  it("an undo keeps the forecast the outfit was planned with, and the next skip still counts", () => {
    const skipped = nextWeatherInForce(opened, { ...same, skips: 1 }, "A");
    const undone = nextWeatherInForce(skipped, same, "B");
    expect(undone.weather).toBe("A");
    expect(nextWeatherInForce(undone, { ...same, skips: 1 }, "C").weather).toBe("C");
  });
});

import type { SavedOutfitSignal } from "@fit-check/engine";
import { describe, expect, it } from "vitest";
import type { TodayRecord } from "../../data/feedback";
import {
  firstGeneration,
  CALENDAR_GRACE_MS,
  firstCalendar,
  firstSuggestion,
  firstWeather,
  initialLearn,
  initialWeatherInForce,
  learnedFrom,
  nextLearn,
  nextWeatherInForce,
  SAVED_LIST_GRACE_MS,
  skipCount,
  WEATHER_GRACE_MS,
  weatherInForceFor,
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

describe("the bounded waits together", () => {
  const base = {
    othersReady: true,
    saved: "ready" as const,
    savedWaitedMs: 0,
    forecast: "fresh" as const,
    cached: false,
    forecastWaitedMs: 0,
    observes: true,
    calendar: "known" as const,
    calendarWaitedMs: 0,
  };

  it("goes when all have answered", () => {
    expect(firstSuggestion(base)).toEqual({ saved: "with", weather: "fresh", calendar: "known" });
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
        observes: true,
        calendar: "known",
        calendarWaitedMs: t - forecastStart,
      });
    expect(at(2600)).toBe("wait");
    expect(at(3299)).toBe("wait");
    expect(at(3300)).toEqual({ saved: "without", weather: "cached", calendar: "known" });
  });

  it("with the other inputs ready early, the weather bound decides", () => {
    const at = (t: number) =>
      firstSuggestion({ ...base, savedWaitedMs: t, forecast: "loading", cached: false, forecastWaitedMs: t, calendarWaitedMs: t });
    expect(at(2499)).toBe("wait");
    expect(at(2500)).toEqual({ saved: "with", weather: "without", calendar: "known" });
  });

  it("the calendar and the forecast start together and their bounds end together, never one after the other", () => {
    // Timeline in ms from opening: the location is read at 40 and both requests start then; the wardrobe and the
    // records are in at 900; neither service answers. Drawn at 40 + 2500 = 2540, not at 40 + 2500 + 2500.
    const start = 40;
    const at = (t: number) =>
      firstSuggestion({
        ...base,
        othersReady: t >= 900,
        forecast: "loading",
        forecastWaitedMs: t - start,
        calendar: "loading",
        calendarWaitedMs: t - start,
      });
    expect(at(2539)).toBe("wait");
    expect(at(2540)).toEqual({ saved: "with", weather: "without", calendar: "civil" });
  });

  it("waits for the calendar while only it is missing", () => {
    expect(firstSuggestion({ ...base, calendar: "loading", calendarWaitedMs: 300 })).toBe("wait");
    expect(firstSuggestion({ ...base, calendar: "loading", calendarWaitedMs: 300, observes: false })).toEqual({ saved: "with", weather: "fresh", calendar: "unused" });
  });
});

describe("the first generation's calendar", () => {
  const ready = { othersReady: true, observes: true, calendar: "loading" as const, waitedMs: 0 };

  it("waits for the other inputs first", () => {
    expect(firstCalendar({ ...ready, othersReady: false, calendar: "known" })).toBe("wait");
  });

  it("a known calendar, stored or answered, is used at once", () => {
    expect(firstCalendar({ ...ready, calendar: "known" })).toBe("known");
  });

  it("waits at most CALENDAR_GRACE_MS from the request's start, then plans by the civil calendar", () => {
    expect(firstCalendar({ ...ready, waitedMs: CALENDAR_GRACE_MS - 1 })).toBe("wait");
    expect(firstCalendar({ ...ready, waitedMs: CALENDAR_GRACE_MS })).toBe("civil");
  });

  it("a failed request is not waited for", () => {
    expect(firstCalendar({ ...ready, calendar: "failed" })).toBe("civil");
  });

  it("with the observance switch off the calendar does not decide the outfit: no wait", () => {
    expect(firstCalendar({ ...ready, observes: false })).toBe("unused");
    expect(firstCalendar({ ...ready, observes: false, calendar: "failed" })).toBe("unused");
  });

  it("the bound is 2.5 s, as the weather's", () => {
    expect(CALENDAR_GRACE_MS).toBe(2500);
    expect(CALENDAR_GRACE_MS).toBe(WEATHER_GRACE_MS);
  });
});

describe("the forecast in force", () => {
  const taps = {};
  const TODAY = "2026-11-20";
  const SHABBAT = "2026-11-21";
  const same = { skips: 0, adjustments: taps, tab: TODAY, today: TODAY, occasion: null, refresh: 0 };
  /** The live forecast per date, as a label: what the network has said by now. */
  const liveIs = (label: string) => (date: string) => `${label}@${date}`;
  const opened = initialWeatherInForce(same, liveIs("cached"));
  const forTab = (s: typeof opened, date: string, label: string) => weatherInForceFor(s, date, liveIs(label));

  it("a forecast that answers later changes nothing: the same state, by identity", () => {
    expect(nextWeatherInForce(opened, same, liveIs("fresh"))).toBe(opened);
    expect(forTab(opened, TODAY, "fresh")).toBe(`cached@${TODAY}`);
  });

  it("a skip, a nudge or 'update' takes the latest forecast in for the shown tab", () => {
    expect(forTab(nextWeatherInForce(opened, { ...same, skips: 1 }, liveIs("fresh")), TODAY, "x")).toBe(`fresh@${TODAY}`);
    expect(forTab(nextWeatherInForce(opened, { ...same, adjustments: {} }, liveIs("fresh")), TODAY, "x")).toBe(`fresh@${TODAY}`);
    expect(forTab(nextWeatherInForce(opened, { ...same, refresh: 1 }, liveIs("fresh")), TODAY, "x")).toBe(`fresh@${TODAY}`);
  });

  it("an occasion takes the latest forecast in for today, from any tab", () => {
    const onShabbat = nextWeatherInForce(opened, { ...same, tab: SHABBAT }, liveIs("cached"));
    const s = nextWeatherInForce(onShabbat, { ...same, tab: SHABBAT, occasion: "date" }, liveIs("fresh"));
    expect(forTab(s, TODAY, "x")).toBe(`fresh@${TODAY}`);
    expect(forTab(s, SHABBAT, "x")).toBe(`cached@${SHABBAT}`);
  });

  it("a tab change is not a trigger: a round trip keeps today's forecast; a tab never shown takes the freshest", () => {
    const toShabbat = nextWeatherInForce(opened, { ...same, tab: SHABBAT }, liveIs("fresh"));
    expect(forTab(toShabbat, SHABBAT, "x")).toBe(`fresh@${SHABBAT}`);
    const back = nextWeatherInForce(toShabbat, same, liveIs("fresher"));
    expect(forTab(back, TODAY, "x")).toBe(`cached@${TODAY}`);
    expect(nextWeatherInForce(back, { ...same, tab: SHABBAT }, liveIs("newest"))).toBe(back);
    expect(forTab(nextWeatherInForce(back, { ...same, tab: SHABBAT }, liveIs("newest")), SHABBAT, "x")).toBe(`fresh@${SHABBAT}`);
  });

  it("a day not generated yet is planned with the live forecast", () => {
    expect(forTab(opened, SHABBAT, "fresh")).toBe(`fresh@${SHABBAT}`);
  });

  it("an undo brings back the forecast in force before the skip; the next skip takes the latest again", () => {
    const skipped = nextWeatherInForce(opened, { ...same, skips: 1 }, liveIs("A"));
    expect(forTab(skipped, TODAY, "x")).toBe(`A@${TODAY}`);
    const undone = nextWeatherInForce(skipped, same, liveIs("B"));
    expect(forTab(undone, TODAY, "x")).toBe(`cached@${TODAY}`);
    expect(forTab(nextWeatherInForce(undone, { ...same, skips: 1 }, liveIs("C")), TODAY, "x")).toBe(`C@${TODAY}`);
  });

  it("an undo keeps a tab first shown after the skip as it was shown", () => {
    const skipped = nextWeatherInForce(opened, { ...same, skips: 1 }, liveIs("A"));
    const shabbat = nextWeatherInForce(skipped, { ...same, skips: 1, tab: SHABBAT }, liveIs("A"));
    const undone = nextWeatherInForce(shabbat, { ...same, tab: SHABBAT }, liveIs("B"));
    expect(forTab(undone, SHABBAT, "x")).toBe(`A@${SHABBAT}`);
    expect(forTab(undone, TODAY, "x")).toBe(`cached@${TODAY}`);
  });
});

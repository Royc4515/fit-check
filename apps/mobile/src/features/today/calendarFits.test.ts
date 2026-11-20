import { NO_ADJUSTMENT } from "@fit-check/engine";
import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import type { FeedbackHistory } from "../../data/feedback";
import { initialWeatherInForce, nextWeatherInForce, weatherInForceFor } from "./learning";
import { planToday, rulesStillFit, type DayInput } from "./outfit";

// The calendar that arrives after the outfit was drawn (DESIGN.md "היום" item 1, "כשהלוח העברי מתעכב"): the day's
// rules are held in force with the forecast, so a late calendar never re-ranks the outfit on screen, and a line offers
// the update only when that outfit breaks the rules the calendar now gives the day.

const EMPTY_HISTORY: FeedbackHistory = { recent: [], today: [], ahead: [], samples: [] };
const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const MILD = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0 };
const TODAY = "2026-09-21";

type Rules = Pick<DayInput, "dayType" | "yomKippur" | "festive">;
const WEEKDAY: Rules = { dayType: "weekday", yomKippur: false, festive: false };
const YOM_KIPPUR: Rules = { dayType: "holiday", yomKippur: true, festive: false };
const HOLIDAY: Rules = { dayType: "holiday", yomKippur: false, festive: false };
const day = (rules: Rules): DayInput => ({ date: TODAY, weather: MILD, ...rules });

function shown(rules: Rules): Item[] {
  const plan = planToday({ items: wardrobe, pairWeights: new Map(), day: day(rules), history: EMPTY_HISTORY });
  if (plan.kind !== "suggestion") throw new Error("no suggestion");
  return plan.items;
}

describe("rulesStillFit", () => {
  it("an outfit planned for the day's own rules fits them", () => {
    expect(rulesStillFit({ outfit: shown(WEEKDAY), day: day(WEEKDAY), adjustment: NO_ADJUSTMENT })).toBe(true);
    expect(rulesStillFit({ outfit: shown(HOLIDAY), day: day(HOLIDAY), adjustment: NO_ADJUSTMENT })).toBe(true);
    expect(rulesStillFit({ outfit: shown(YOM_KIPPUR), day: day(YOM_KIPPUR), adjustment: NO_ADJUSTMENT })).toBe(true);
  });

  it("the weekday outfit, judged by the holiday's rules the calendar brought, does not", () => {
    expect(rulesStillFit({ outfit: shown(WEEKDAY), day: day(HOLIDAY), adjustment: NO_ADJUSTMENT })).toBe(false);
  });

  it("a holiday outfit with leather shoes, judged by Yom Kippur's rules, fails on the shoes alone", () => {
    const leather = wardrobe.find(
      (i) => i.status === "active" && i.tags.category === "shoes" && /leather|suede/.test(i.tags.material) && rulesStillFit({ outfit: [i], day: day(HOLIDAY), adjustment: NO_ADJUSTMENT })
    );
    if (!leather) throw new Error("the fixture has no leather holiday shoe");
    const outfit = [...shown(HOLIDAY).filter((i) => i.tags.category !== "shoes"), leather];
    expect(rulesStillFit({ outfit, day: day(HOLIDAY), adjustment: NO_ADJUSTMENT })).toBe(true);
    expect(rulesStillFit({ outfit, day: day(YOM_KIPPUR), adjustment: NO_ADJUSTMENT })).toBe(false);
  });

  it("an empty outfit breaks nothing (nothing on screen to keep)", () => {
    expect(rulesStillFit({ outfit: [], day: day(HOLIDAY), adjustment: NO_ADJUSTMENT })).toBe(true);
  });
});

describe("the day's rules in force, with the forecast's mechanism", () => {
  type Conditions = { weather: DayInput["weather"]; rules: Rules };
  const triggers = (over: Partial<{ skips: number; refresh: number }> = {}) => ({
    skips: 0,
    adjustments: NO_ADJUSTMENT,
    occasion: null,
    refresh: 0,
    tab: TODAY,
    today: TODAY,
    ...over,
  });

  it("a calendar that arrives later changes nothing on screen until the user asks for another outfit", () => {
    let live: Conditions = { weather: MILD, rules: WEEKDAY };
    const liveOf = () => live;
    const opened = initialWeatherInForce<Conditions>(triggers(), liveOf);
    const first = shown(weatherInForceFor(opened, TODAY, liveOf).rules).map((i) => i.id);
    // The calendar answers: today is a holiday.
    live = { weather: MILD, rules: HOLIDAY };
    const after = nextWeatherInForce(opened, triggers(), liveOf);
    expect(after).toBe(opened);
    expect(shown(weatherInForceFor(after, TODAY, liveOf).rules).map((i) => i.id)).toEqual(first);
    // "Update the suggestion" takes the holiday in.
    const updated = nextWeatherInForce(after, triggers({ refresh: 1 }), liveOf);
    expect(weatherInForceFor(updated, TODAY, liveOf).rules).toEqual(HOLIDAY);
    expect(rulesStillFit({ outfit: shown(HOLIDAY), day: day(HOLIDAY), adjustment: NO_ADJUSTMENT })).toBe(true);
  });
});

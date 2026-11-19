import { FESTIVE_FORMALITY_STEPS, NO_ADJUSTMENT } from "@fit-check/engine";
import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../packages/engine/__fixtures__/wardrobe.json";
import { defaultAdjustment, planDays } from "../features/today/plans";
import type { FeedbackHistory } from "./feedback";
import { dayTypeFor, isFestiveWeekday, NO_CALENDAR, parseObservance, storedObservance } from "./observance";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const EMPTY: FeedbackHistory = { recent: [], today: [], ahead: [], samples: [] };

describe("the observance setting", () => {
  it("is on unless explicitly off", () => {
    expect(parseObservance(null)).toBe(true);
    expect(parseObservance("yes")).toBe(true);
    expect(parseObservance("garbage")).toBe(true);
    expect(parseObservance(storedObservance(false))).toBe(false);
    expect(parseObservance(storedObservance(true))).toBe(true);
  });
});

describe("dayTypeFor", () => {
  it("on: Saturday is Shabbat, Yom Tov is a holiday, the rest are weekdays", () => {
    expect(dayTypeFor(6, false, true)).toBe("shabbat");
    expect(dayTypeFor(4, true, true)).toBe("holiday");
    expect(dayTypeFor(6, true, true)).toBe("holiday");
    expect(dayTypeFor(5, false, true)).toBe("weekday");
  });
  it("off: every day is a weekday", () => {
    for (let wd = 0; wd < 7; wd++) {
      expect(dayTypeFor(wd, false, false)).toBe("weekday");
      expect(dayTypeFor(wd, true, false)).toBe("weekday");
    }
  });
});

describe("a holiday with the switch off", () => {
  it("is festive only when off and Yom Tov", () => {
    expect(isFestiveWeekday(true, false)).toBe(true);
    expect(isFestiveWeekday(false, false)).toBe(false);
    expect(isFestiveWeekday(true, true)).toBe(false);
  });
  it("off + Yom Tov: one dressier step by default; off + Saturday: none; on: none", () => {
    expect(defaultAdjustment({ festive: isFestiveWeekday(true, false) })).toEqual({ temp_steps: 0, formality_steps: FESTIVE_FORMALITY_STEPS });
    expect(FESTIVE_FORMALITY_STEPS).toBe(1);
    expect(defaultAdjustment({ festive: isFestiveWeekday(false, false) })).toEqual({ temp_steps: 0, formality_steps: 0 });
    expect(defaultAdjustment({ festive: isFestiveWeekday(true, true) })).toEqual({ temp_steps: 0, formality_steps: 0 });
  });
  it("is planned by the weekday rules, a step dressier", () => {
    const weather = { temp_min_c: 14, temp_max_c: 22, rain_probability: 0 };
    const day = { date: "2027-04-22", weather, dayType: dayTypeFor(4, true, false), festive: isFestiveWeekday(true, false) };
    const [plain] = planDays({ items: wardrobe, pairWeights: new Map(), days: [{ ...day, festive: false }], history: EMPTY, adjustments: [NO_ADJUSTMENT] });
    const [festive] = planDays({ items: wardrobe, pairWeights: new Map(), days: [day], history: EMPTY, adjustments: [defaultAdjustment(day)] });
    expect(festive!.plan.req.context.type).toBe("weekday");
    const [lo] = festive!.plan.req.context.formality_range;
    expect(lo).toBe(plain!.plan.req.context.formality_range[0] + 1);
  });
});

describe("off", () => {
  it("there are no times and no planned days (the calendar is still read for the holiday)", () => {
    expect(NO_CALENDAR).toEqual({ holiday: null, candles: null, end: null, yomtov: false, yomKippur: false, chain: [] });
  });
  it("Saturday is planned by the weekday rules", () => {
    const day = { date: "2026-11-21", weather: { temp_min_c: 14, temp_max_c: 22, rain_probability: 0 }, dayType: dayTypeFor(6, false, false) };
    const [sat] = planDays({ items: wardrobe, pairWeights: new Map(), days: [day], history: EMPTY, adjustments: [NO_ADJUSTMENT] });
    expect(sat!.plan.req.context.type).toBe("weekday");
    const on = planDays({ items: wardrobe, pairWeights: new Map(), days: [{ ...day, dayType: dayTypeFor(6, false, true) }], history: EMPTY, adjustments: [NO_ADJUSTMENT] });
    expect(on[0]!.plan.req.context.type).toBe("shabbat");
  });
});

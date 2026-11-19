import { NO_ADJUSTMENT } from "@fit-check/engine";
import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../packages/engine/__fixtures__/wardrobe.json";
import { planDays } from "../features/today/plans";
import type { FeedbackHistory } from "./feedback";
import { dayTypeFor, NO_CALENDAR, parseObservance, storedObservance } from "./observance";

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

describe("off", () => {
  it("there are no times and no planned days", () => {
    expect(NO_CALENDAR).toEqual({ holiday: null, candles: null, end: null, yomtov: false, chain: [] });
  });
  it("Saturday is planned by the weekday rules", () => {
    const day = { date: "2026-11-21", weather: { temp_min_c: 14, temp_max_c: 22, rain_probability: 0 }, dayType: dayTypeFor(6, false, false) };
    const [sat] = planDays({ items: wardrobe, pairWeights: new Map(), days: [day], history: EMPTY, adjustments: [NO_ADJUSTMENT] });
    expect(sat!.plan.req.context.type).toBe("weekday");
    const on = planDays({ items: wardrobe, pairWeights: new Map(), days: [{ ...day, dayType: dayTypeFor(6, false, true) }], history: EMPTY, adjustments: [NO_ADJUSTMENT] });
    expect(on[0]!.plan.req.context.type).toBe("shabbat");
  });
});

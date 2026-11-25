import { describe, expect, it } from "vitest";
import {
  CALENDAR_UNAVAILABLE_MESSAGE,
  CALENDAR_UNAVAILABLE_SHABBAT_MESSAGE,
  clockOnDate,
  hebcalDayFacts,
  occasionMayApply,
  planDay,
  ruleSetOf,
  type HebrewDayFacts,
  type RuleSet,
} from "./day-context";

/*
 * The shared "which context decides this date" rule (app Today and server outfit_today), table-driven over the days the
 * corrected precedence is about (DESIGN.md "שלב 4.5" item 3). Facts are as Hebcal gives them for Israel (the dates in
 * the comments are the real ones from the app's fixtures, apps/mobile/src/data/__fixtures__/window-tishrei-5787.json).
 */

const plain: HebrewDayFacts = { yomtov: false, yomKippur: false, havdalahToday: null };

type Row = {
  name: string;
  weekday: number;
  facts: HebrewDayFacts;
  now: string;
  /** Observance on: the rules without an occasion, and with a "date" occasion stored. */
  on: [RuleSet, RuleSet];
  /** Observance off: likewise, and whether the look starts one step dressier without an occasion. */
  off: [RuleSet, RuleSet];
  festiveOff: boolean;
};

const rows: Row[] = [
  { name: "a weekday (Tuesday)", weekday: 2, facts: plain, now: "12:00", on: ["weekday", "date"], off: ["weekday", "date"], festiveOff: false },
  // Friday 2026-11-20, candles 16:18. The Friday itself is a weekday in the app (its own tab); Shabbat is the next tab.
  { name: "Friday before candle lighting", weekday: 5, facts: plain, now: "12:00", on: ["weekday", "date"], off: ["weekday", "date"], festiveOff: false },
  { name: "Friday after candle lighting", weekday: 5, facts: plain, now: "17:00", on: ["weekday", "date"], off: ["weekday", "date"], festiveOff: false },
  // Saturday 2026-11-21, havdalah 17:17.
  { name: "Shabbat before havdalah", weekday: 6, facts: { ...plain, havdalahToday: "17:17" }, now: "12:00", on: ["shabbat", "shabbat"], off: ["weekday", "date"], festiveOff: false },
  { name: "Shabbat at havdalah", weekday: 6, facts: { ...plain, havdalahToday: "17:17" }, now: "17:17", on: ["shabbat", "date"], off: ["weekday", "date"], festiveOff: false },
  { name: "Shabbat after havdalah", weekday: 6, facts: { ...plain, havdalahToday: "17:17" }, now: "20:30", on: ["shabbat", "date"], off: ["weekday", "date"], festiveOff: false },
  // Sunday 2026-09-20, Erev Yom Kippur: no Yom Tov flag on the eve.
  { name: "a holiday eve", weekday: 0, facts: plain, now: "15:00", on: ["weekday", "date"], off: ["weekday", "date"], festiveOff: false },
  // A one-day Yom Tov on a weekday (Shavuot in Israel), its havdalah that evening.
  { name: "a holiday before havdalah", weekday: 3, facts: { yomtov: true, yomKippur: false, havdalahToday: "19:40" }, now: "10:00", on: ["holiday", "holiday"], off: ["weekday", "date"], festiveOff: true },
  { name: "a holiday after havdalah", weekday: 3, facts: { yomtov: true, yomKippur: false, havdalahToday: "19:40" }, now: "21:00", on: ["holiday", "date"], off: ["weekday", "date"], festiveOff: true },
  // Rosh Hashana 5787: Saturday 2026-09-12 (day 1, no havdalah: the holiday goes on), Sunday 2026-09-13 (havdalah 19:26).
  { name: "two-day chain, day 1 (late evening, no havdalah)", weekday: 6, facts: { yomtov: true, yomKippur: false, havdalahToday: null }, now: "23:00", on: ["holiday", "holiday"], off: ["weekday", "date"], festiveOff: true },
  { name: "two-day chain, day 2 before havdalah", weekday: 0, facts: { yomtov: true, yomKippur: false, havdalahToday: "19:26" }, now: "11:00", on: ["holiday", "holiday"], off: ["weekday", "date"], festiveOff: true },
  { name: "two-day chain, day 2 after havdalah", weekday: 0, facts: { yomtov: true, yomKippur: false, havdalahToday: "19:26" }, now: "19:30", on: ["holiday", "date"], off: ["weekday", "date"], festiveOff: true },
  // Yom Kippur, Monday 2026-09-21, the fast ends 19:15.
  { name: "Yom Kippur before the fast ends", weekday: 1, facts: { yomtov: true, yomKippur: true, havdalahToday: "19:15" }, now: "13:00", on: ["yom_kippur", "yom_kippur"], off: ["weekday", "date"], festiveOff: true },
  { name: "Yom Kippur after the fast ends", weekday: 1, facts: { yomtov: true, yomKippur: true, havdalahToday: "19:15" }, now: "19:16", on: ["yom_kippur", "date"], off: ["weekday", "date"], festiveOff: true },
];

const occasion = { type: "date", source: "calendar" } as const;

describe("planDay: the shared precedence rule", () => {
  for (const r of rows) {
    for (const observes of [true, false]) {
      for (const withOccasion of [false, true]) {
        const expected = (observes ? r.on : r.off)[withOccasion ? 1 : 0];
        it(`${r.name}, observance ${observes ? "on" : "off"}, ${withOccasion ? "a date set" : "no occasion"} -> ${expected}`, () => {
          const plan = planDay({
            weekday: r.weekday,
            calendar: r.facts,
            observesShabbat: observes,
            occasion: withOccasion ? occasion : null,
            dayTypeForced: null,
            now: r.now,
          });
          expect(plan.rules).toBe(expected);
          expect(plan.calendarKnown).toBe(true);
          expect(plan.warning).toBeNull();
          // A wear records the occasion only when it decided the look; Yom Kippur is recorded as a holiday.
          expect(plan.contextType).toBe(expected === "yom_kippur" ? "holiday" : expected);
          expect(plan.festive).toBe(!observes && !withOccasion && r.festiveOff);
          if (withOccasion) expect(plan.occasion?.applied).toBe(expected === "date");
          else expect(plan.occasion).toBeNull();
          // The same answer as the app's own question (occasionMayApply), by construction.
          expect(occasionMayApply({ tab: "today", dayType: plan.dayType, havdalahToday: r.facts.havdalahToday, now: r.now })).toBe(
            plan.dayType === "weekday" || r.facts.havdalahToday !== null && r.now >= r.facts.havdalahToday
          );
        });
      }
    }
  }

  it("a planned day's tab never takes the occasion, on any day", () => {
    for (const r of rows) {
      expect(occasionMayApply({ tab: "planned", dayType: "shabbat", havdalahToday: r.facts.havdalahToday, now: "23:59" })).toBe(false);
    }
  });

  it("says why an occasion waits, with the havdalah time", () => {
    const plan = planDay({ weekday: 6, calendar: { ...plain, havdalahToday: "17:17" }, observesShabbat: true, occasion: { type: "date", label: "evening out", source: "manual" }, dayTypeForced: null, now: "09:00" });
    expect(plan.occasion).toMatchObject({ type: "date", label: "evening out", source: "manual", applied: false });
    expect(plan.occasion?.why).toContain("17:17");
    expect(plan.reason).toContain("shabbat");
    const after = planDay({ weekday: 6, calendar: { ...plain, havdalahToday: "17:17" }, observesShabbat: true, occasion: { type: "date", label: "evening out", source: "manual" }, dayTypeForced: null, now: "18:00" });
    expect(after.reason).toBe('date ("evening out"), set by hand (after havdalah at 17:17)');
  });
});

describe("planDay: an explicit day type", () => {
  it("wins over the occasion, the calendar and the setting", () => {
    const plan = planDay({ weekday: 2, calendar: plain, observesShabbat: false, occasion: { type: "date", source: "manual" }, dayTypeForced: "shabbat", now: "12:00" });
    expect(plan).toMatchObject({ rules: "shabbat", dayType: "shabbat", contextType: "shabbat", festive: false, warning: null });
    expect(plan.occasion?.applied).toBe(false);
  });
});

describe("planDay: without the Hebrew calendar", () => {
  const base = { calendar: null, occasion: null, dayTypeForced: null, now: "12:00" } as const;

  it("a Wednesday: weekday rules and the typed warning", () => {
    const plan = planDay({ ...base, weekday: 3, observesShabbat: true });
    expect(plan.rules).toBe("weekday");
    expect(plan.calendarKnown).toBe(false);
    expect(plan.warning).toEqual({ code: "hebrew_calendar_unavailable", message: CALENDAR_UNAVAILABLE_MESSAGE });
  });

  it("a Saturday: Shabbat from the weekday, and an occasion does not apply (its havdalah is unknown)", () => {
    const plan = planDay({ ...base, weekday: 6, observesShabbat: true, occasion: { type: "date", source: "calendar" }, now: "23:00" });
    expect(plan.rules).toBe("shabbat");
    expect(plan.occasion?.applied).toBe(false);
    expect(plan.warning).toEqual({ code: "hebrew_calendar_unavailable", message: CALENDAR_UNAVAILABLE_SHABBAT_MESSAGE });
  });

  it("a Friday: its own look by the weekday rules, and the warning never claims it is Shabbat", () => {
    const plan = planDay({ ...base, weekday: 5, observesShabbat: true });
    expect(plan.rules).toBe("weekday");
    expect(plan.warning?.message).toBe(CALENDAR_UNAVAILABLE_MESSAGE);
    expect(plan.warning?.message).not.toMatch(/shabbat/i);
  });

  it("observance off: no warning (the calendar does not decide the look), never a guessed holiday", () => {
    const plan = planDay({ ...base, weekday: 6, observesShabbat: false });
    expect(plan).toMatchObject({ rules: "weekday", festive: false, warning: null, calendarKnown: false });
  });
});

describe("clockOnDate", () => {
  it("is the real clock today, before every havdalah on a later date, after every one on an earlier date", () => {
    expect(clockOnDate("2026-11-21", "2026-11-21", "14:05")).toBe("14:05");
    expect(clockOnDate("2026-11-22", "2026-11-21", "14:05")).toBe("00:00");
    expect(clockOnDate("2026-11-20", "2026-11-21", "14:05")).toBe("24:00");
    expect("24:00" >= "23:59").toBe(true);
  });
});

describe("ruleSetOf", () => {
  it("occasion first, then Yom Kippur's own rules, then the day type", () => {
    expect(ruleSetOf({ dayType: "holiday", yomKippur: true, occasion: "event" })).toBe("event");
    expect(ruleSetOf({ dayType: "holiday", yomKippur: true })).toBe("yom_kippur");
    expect(ruleSetOf({ dayType: "weekday", yomKippur: true })).toBe("weekday");
    expect(ruleSetOf({ dayType: "shabbat" })).toBe("shabbat");
  });
});

describe("hebcalDayFacts", () => {
  const items = [
    { date: "2026-09-20T18:20:00+03:00", category: "candles" },
    { date: "2026-09-20", category: "holiday", title_orig: "Erev Yom Kippur" },
    { date: "2026-09-21", category: "holiday", title_orig: "Yom Kippur", yomtov: true },
    { date: "2026-09-21T19:15:00+03:00", category: "havdalah" },
  ];
  it("reads only the date's own events", () => {
    expect(hebcalDayFacts(items, "2026-09-20")).toEqual({ yomtov: false, yomKippur: false, havdalahToday: null });
    expect(hebcalDayFacts(items, "2026-09-21")).toEqual({ yomtov: true, yomKippur: true, havdalahToday: "19:15" });
    expect(hebcalDayFacts(items, "2026-09-22")).toEqual({ yomtov: false, yomKippur: false, havdalahToday: null });
  });
});

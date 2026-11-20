import { HebcalItemsSchema } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import tishrei from "./__fixtures__/window-tishrei-5787.json";
import { addDays, calendarAnswerUsable, calendarOn, civilCalendar, hebrewDateOn, hebrewDatesUsable, windowCovers } from "./calendarWindow";
import { NO_CALENDAR } from "./observance";

// A real 61-day Hebcal window (geonameid 294981 Giv'at Shmuel, i=on, lg=he, 2026-09-01..2026-10-31, saved 2026-11-20).
// The expected values were read by hand from the response, not produced by the code under test.
const items = HebcalItemsSchema.parse(tishrei).items;

describe("addDays", () => {
  it("crosses a month and gives the weekday in UTC", () => expect(addDays("2026-09-30", 3)).toEqual({ iso: "2026-10-03", weekday: 6 }));
  it("an unreadable date comes back as itself with weekday -1", () => expect(addDays("30-09-2026", 1)).toEqual({ iso: "30-09-2026", weekday: -1 }));
});

describe("windowCovers", () => {
  const w = { start: "2026-09-01", end: "2026-10-31" };
  it("a date whose planned days fall inside", () => expect(windowCovers(w, "2026-10-28")).toBe(true));
  it("not when the three days after it run past the end", () => expect(windowCovers(w, "2026-10-29")).toBe(false));
  it("not before the start", () => expect(windowCovers(w, "2026-08-31")).toBe(false));
  it("not for an unreadable date", () => expect(windowCovers(w, "x")).toBe(false));
});

describe("calendarOn: many dates out of one stored window", () => {
  it("an ordinary Wednesday: nothing", () => expect(calendarOn(items, "2026-10-14")).toEqual(NO_CALENDAR));
  it("Friday, erev Rosh Hashana: Shabbat candles, a chain of Shabbat (day 1) and day 2", () => {
    const c = calendarOn(items, "2026-09-11");
    expect(c.candles).toEqual({ time: "18:32", kind: "shabbat" });
    expect(c.yomtov).toBe(false);
    expect(c.chain.map((d) => [d.date, d.kind])).toEqual([
      ["2026-09-12", "shabbat"],
      ["2026-09-13", "holiday"],
    ]);
  });
  it("Sunday, erev Yom Kippur: candles, the fast ends tomorrow, one Yom Kippur day", () => {
    const c = calendarOn(items, "2026-09-20");
    expect(c.candles).toEqual({ time: "18:20", kind: "other" });
    expect(c.end).toEqual({ time: "19:15", kind: "fast", day: "tomorrow" });
    expect(c.chain.map((d) => [d.date, d.kind])).toEqual([["2026-09-21", "yom_kippur"]]);
  });
  it("Monday, Yom Kippur itself: a Yom Tov, Yom Kippur, the fast ends today", () => {
    const c = calendarOn(items, "2026-09-21");
    expect(c.yomtov).toBe(true);
    expect(c.yomKippur).toBe(true);
    expect(c.holiday?.en).toBe("Yom Kippur");
    expect(c.end).toEqual({ time: "19:15", kind: "fast", day: "today" });
    expect(c.chain).toEqual([]);
  });
  it("an ordinary Friday later in the window reads the same window", () =>
    expect(calendarOn(items, "2026-10-16")).toMatchObject({ candles: { time: "17:47", kind: "shabbat" }, chain: [{ date: "2026-10-17", kind: "shabbat" }] }));
});

describe("civilCalendar: what is known without Hebcal", () => {
  it("a Friday with the switch on plans Saturday as Shabbat, with no times, holiday or Yom Tov", () =>
    expect(civilCalendar("2026-11-20", 5, true)).toEqual({ ...NO_CALENDAR, chain: [{ date: "2026-11-21", kind: "shabbat", holiday: null }] }));
  it("a Friday with the switch off: nothing", () => expect(civilCalendar("2026-11-20", 5, false)).toEqual(NO_CALENDAR));
  it("a Thursday: nothing (a holiday eve cannot be known)", () => expect(civilCalendar("2026-11-19", 4, true)).toEqual(NO_CALENDAR));
  it("a Saturday: nothing here (its day type comes from the weekday)", () => expect(civilCalendar("2026-11-21", 6, true)).toEqual(NO_CALENDAR));
  it("a weekday that does not match the date gives nothing rather than a wrong Saturday", () =>
    expect(civilCalendar("2026-11-19", 5, true)).toEqual(NO_CALENDAR));
});

describe("hebrewDateOn", () => {
  const w = { start: "2026-11-20", end: "2026-11-21", dates: { "2026-11-20": { he: "י׳ בכסלו תשפ״ז", en: "10 Kislev 5787" } } };
  it("the stored date", () => expect(hebrewDateOn(w, "2026-11-20")).toEqual({ he: "י׳ בכסלו תשפ״ז", en: "10 Kislev 5787" }));
  it("null for a date it does not hold", () => expect(hebrewDateOn(w, "2026-11-22")).toBeNull());
});

describe("an answer that passes the schema but is not a calendar", () => {
  it("a real 61-day window has candle lighting: usable", () => expect(calendarAnswerUsable(items, "2026-09-01", "2026-10-31")).toBe(true));
  it("an empty 60-day answer is a failed request", () => expect(calendarAnswerUsable([], "2026-11-20", "2027-01-19")).toBe(false));
  it("seven days with only holidays and no candle lighting is a failed request", () =>
    expect(calendarAnswerUsable([{ category: "holiday" }, { category: "havdalah" }], "2026-11-20", "2026-11-26")).toBe(false));
  it("a window shorter than a week is left to the schema", () => expect(calendarAnswerUsable([], "2026-11-20", "2026-11-25")).toBe(true));
  it("the converter's answer must hold the date asked for", () => {
    expect(hebrewDatesUsable({}, "2026-11-20")).toBe(false);
    expect(hebrewDatesUsable({ "2026-11-20": { he: "x", en: "y" } }, "2026-11-20")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { FeedbackHistory, TodayRecord } from "../../data/feedback";
import { localDate } from "../../data/localDate";
import { dayInForce, dayTabKeys, plannedKeys, type DayInForceInput } from "./dayInForce";

// Friday 20.11.2026 in Jerusalem: candles 16:18, Shabbat (21.11) ends 17:17. The day context as loadDayContext gives
// it with the observance switch on and off (off: no times, no planned days).
const FRI_ON: DayInForceInput = { date: "2026-11-20", candles: { time: "16:18" }, chain: [{ date: "2026-11-21" }] };
const FRI_OFF: DayInForceInput = { date: "2026-11-20", candles: null, chain: [] };
// Saturday: no candles of its own (havdalah is not a candle lighting), so no planned day, before or after havdalah.
const SAT: DayInForceInput = { date: "2026-11-21", candles: null, chain: [] };
// A holiday eve on a weekday (candles "other"), opening one holiday day.
const EVE_ON: DayInForceInput = { date: "2026-09-21", candles: { time: "18:30" }, chain: [{ date: "2026-09-22" }] };
const EVE_OFF: DayInForceInput = { date: "2026-09-21", candles: null, chain: [] };
const WED: DayInForceInput = { date: "2026-11-18", candles: null, chain: [] };
const THU: DayInForceInput = { date: "2026-11-19", candles: null, chain: [] };

const none: Pick<FeedbackHistory, "today" | "ahead"> = { today: [], ahead: [] };
const worn = (date: string): TodayRecord => ({ wearId: `w-${date}`, outfitId: "o", feedback: "worn", itemIds: ["a"], date });
const at = (iso: string) => localDate("Asia/Jerusalem", new Date(iso)).date;

describe("dayInForce", () => {
  it("Friday: today until three hours before candles, then Shabbat; observance off: today all day", () => {
    expect(dayInForce({ day: FRI_ON, now: "13:17", history: none })).toBe("2026-11-20");
    expect(dayInForce({ day: FRI_ON, now: "13:18", history: none })).toBe("2026-11-21");
    expect(dayInForce({ day: FRI_ON, now: "16:17", history: none })).toBe("2026-11-21");
    expect(dayInForce({ day: FRI_ON, now: "16:19", history: none })).toBe("2026-11-21");
    expect(dayInForce({ day: FRI_ON, now: "23:59", history: none })).toBe("2026-11-21");
    for (const now of ["13:17", "16:17", "16:19", "23:59"]) expect(dayInForce({ day: FRI_OFF, now, history: none })).toBe("2026-11-20");
  });

  it("Friday morning with today already worn opens on Shabbat, as Today does; a recorded Shabbat stays the day in force", () => {
    expect(dayInForce({ day: FRI_ON, now: "09:00", history: { today: [worn("2026-11-20")], ahead: [] } })).toBe("2026-11-21");
    expect(dayInForce({ day: FRI_ON, now: "17:30", history: { today: [], ahead: [worn("2026-11-21")] } })).toBe("2026-11-21");
    expect(dayInForce({ day: FRI_OFF, now: "09:00", history: { today: [worn("2026-11-20")], ahead: [] } })).toBe("2026-11-20");
  });

  it("Saturday before and after havdalah is its own civil date, observance on or off", () => {
    // 23:59 on Friday is still Friday's civil date; 00:01 is Saturday's.
    expect(at("2026-11-20T21:59:00Z")).toBe("2026-11-20");
    expect(at("2026-11-20T22:01:00Z")).toBe("2026-11-21");
    for (const now of ["10:00", "17:16", "17:18", "23:59"]) expect(dayInForce({ day: SAT, now, history: none })).toBe("2026-11-21");
  });

  it("an ordinary weekday at 23:59 and 00:01 is the civil date, with or without observance", () => {
    expect(at("2026-11-18T21:59:00Z")).toBe("2026-11-18");
    expect(dayInForce({ day: WED, now: "23:59", history: none })).toBe("2026-11-18");
    expect(at("2026-11-18T22:01:00Z")).toBe("2026-11-19");
    expect(dayInForce({ day: THU, now: "00:01", history: none })).toBe("2026-11-19");
  });

  it("a holiday eve is treated like Friday", () => {
    expect(dayInForce({ day: EVE_ON, now: "15:29", history: none })).toBe("2026-09-21");
    expect(dayInForce({ day: EVE_ON, now: "15:30", history: none })).toBe("2026-09-22");
    expect(dayInForce({ day: EVE_ON, now: "23:59", history: none })).toBe("2026-09-22");
    expect(dayInForce({ day: EVE_OFF, now: "23:59", history: none })).toBe("2026-09-21");
  });

  it("lists the day tabs only when there is a planned day, labelled as Today labels them", () => {
    expect(dayTabKeys({ date: "2026-11-18", chain: [] })).toEqual([]);
    expect(dayTabKeys({ date: "2026-11-20", chain: [{ date: "2026-11-21", kind: "shabbat" }] })).toEqual([
      { key: "2026-11-20", labelKey: "today.tabs.today" },
      { key: "2026-11-21", labelKey: "today.tabs.shabbat" },
    ]);
    expect(
      dayTabKeys({ date: "2026-09-11", chain: [{ date: "2026-09-12", kind: "holiday" }, { date: "2026-09-13", kind: "holiday" }] }).map((k) => k.labelKey)
    ).toEqual(["today.tabs.today", "today.tabs.holidayDay1", "today.tabs.holidayDay2"]);
    expect(dayTabKeys({ date: "2026-09-20", chain: [{ date: "2026-09-21", kind: "yom_kippur" }] })[1]!.labelKey).toBe("today.tabs.yomKippur");
  });

  it("words a planned day's wear and its recorded line as Today does", () => {
    expect(plannedKeys("shabbat")).toEqual({ wear: "today.wearOnShabbat", worn: "today.status.wornShabbat" });
    expect(plannedKeys("holiday").wear).toBe("today.wearOnHoliday");
    expect(plannedKeys("yom_kippur").worn).toBe("today.status.wornYomKippur");
  });
});

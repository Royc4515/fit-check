import { HebcalItemsSchema } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import chanukahFriday from "./__fixtures__/chanukah-friday.json";
import chanukahWeekday from "./__fixtures__/chanukah-weekday.json";
import erevPesach from "./__fixtures__/erev-pesach.json";
import erevShavuot from "./__fixtures__/erev-shavuot.json";
import friday from "./__fixtures__/friday.json";
import pesachDay1 from "./__fixtures__/pesach-day1.json";
import rhDay1 from "./__fixtures__/rh-day1.json";
import rhDay2 from "./__fixtures__/rh-day2.json";
import rhEve from "./__fixtures__/rh-eve.json";
import saturday from "./__fixtures__/saturday.json";
import shavuotDay from "./__fixtures__/shavuot-day.json";
import weekday from "./__fixtures__/weekday.json";
import yomKippurDay from "./__fixtures__/yom-kippur-day.json";
import yomKippurEve from "./__fixtures__/yom-kippur-eve.json";
import chainErevPesach from "./__fixtures__/chain-erev-pesach.json";
import chainErevShavuot from "./__fixtures__/chain-erev-shavuot.json";
import chainFriday from "./__fixtures__/chain-friday.json";
import chainRhEve from "./__fixtures__/chain-rh-eve.json";
import chainRhEve2028 from "./__fixtures__/chain-rh-eve-2028.json";
import chainWeekday from "./__fixtures__/chain-weekday.json";
import chainYomKippurEve from "./__fixtures__/chain-yom-kippur-eve.json";
import { chainTabLabels, defaultTab, phoneFreeChain, shabbatTimes, type HebcalItem } from "./shabbatTimes";

// Real Hebcal responses (geonameid 293397, lg=he, start=date, end=date+1, saved 2026-11-19). The expected values
// below were read by hand from each response, not produced by the code under test.
const items = (raw: unknown): HebcalItem[] => HebcalItemsSchema.parse(raw).items;
const run = (raw: unknown, date: string) => {
  const r = shabbatTimes(items(raw), date);
  return { yomtov: r.yomtov, holiday: r.holiday?.title_orig ?? null, candles: r.candles, end: r.end };
};

describe("shabbatTimes: edge cases", () => {
  it("an invalid date gives nothing", () => {
    expect(shabbatTimes(items(friday), "20-11-2026")).toEqual({ holiday: null, yomtov: false, candles: null, end: null });
  });
  it("no items gives nothing", () => {
    expect(shabbatTimes([], "2026-11-20")).toEqual({ holiday: null, yomtov: false, candles: null, end: null });
  });
  it("a candle item without a time part is not a time", () => {
    const r = shabbatTimes([{ title: "x", date: "2026-11-20", category: "candles" }], "2026-11-20");
    expect(r.candles).toBeNull();
  });
  it("the year and month roll over: 2026-12-31 is a Thursday, its tomorrow 2027-01-01 a Friday", () => {
    const r = shabbatTimes(
      [
        { title: "c", date: "2026-12-31T16:30:00+02:00", category: "candles" },
        { title: "h", date: "2027-01-01T17:30:00+02:00", category: "havdalah" },
      ],
      "2026-12-31",
    );
    expect(r.candles).toEqual({ time: "16:30", kind: "other" });
    expect(r.end).toEqual({ time: "17:30", kind: "holiday", day: "tomorrow" });
  });
  it("Yom Kippur on a Saturday ends as a fast, not as Shabbat", () => {
    const r = shabbatTimes(
      [
        { title: "yk", date: "2026-10-03", category: "holiday", title_orig: "Yom Kippur", yomtov: true },
        { title: "h", date: "2026-10-03T18:40:00+03:00", category: "havdalah" },
      ],
      "2026-10-03",
    );
    expect(r.end).toEqual({ time: "18:40", kind: "fast", day: "today" });
  });
});

describe("shabbatTimes: ordinary days", () => {
  it("weekday: nothing", () => expect(run(weekday, "2026-11-18")).toEqual({ yomtov: false, holiday: null, candles: null, end: null }));
  it("Friday: candles as Shabbat, end tomorrow (Saturday)", () =>
    expect(run(friday, "2026-11-20")).toEqual({ yomtov: false, holiday: null, candles: { time: "16:18", kind: "shabbat" }, end: { time: "17:17", kind: "shabbat", day: "tomorrow" } }));
  it("Saturday: end today, no candles", () =>
    expect(run(saturday, "2026-11-21")).toEqual({ yomtov: false, holiday: null, candles: null, end: { time: "17:17", kind: "shabbat", day: "today" } }));
});

describe("shabbatTimes: holidays (Israel, 2027)", () => {
  it("erev Pesach (Wednesday): candles named plainly, end tomorrow is the holiday's; the holiday is not today's", () =>
    expect(run(erevPesach, "2027-04-21")).toEqual({
      yomtov: false,
      holiday: "Erev Pesach",
      candles: { time: "18:54", kind: "other" },
      end: { time: "19:53", kind: "holiday", day: "tomorrow" },
    }));
  it("Pesach I (Thursday): Yom Tov, no candles, end today", () =>
    expect(run(pesachDay1, "2027-04-22")).toEqual({ yomtov: true, holiday: "Pesach I", candles: null, end: { time: "19:53", kind: "holiday", day: "today" } }));
  it("erev Rosh Hashana is a Friday: Shabbat candles, but the end is two days away so none", () =>
    expect(run(rhEve, "2027-10-01")).toEqual({ yomtov: false, holiday: "Erev Rosh Hashana", candles: { time: "18:06", kind: "shabbat" }, end: null }));
  it("Rosh Hashana day 1 (Saturday): candles after nightfall are 'other', the end is tomorrow", () =>
    expect(run(rhDay1, "2027-10-02")).toEqual({ yomtov: true, holiday: "Rosh Hashana 5788", candles: { time: "19:01", kind: "other" }, end: { time: "19:00", kind: "holiday", day: "tomorrow" } }));
  it("Rosh Hashana day 2 (Sunday): end today", () =>
    expect(run(rhDay2, "2027-10-03")).toEqual({ yomtov: true, holiday: "Rosh Hashana II", candles: null, end: { time: "19:00", kind: "holiday", day: "today" } }));
  it("erev Shavuot (Thursday), Shavuot on the Friday that runs into Shabbat: end is 2 days away, none", () =>
    expect(run(erevShavuot, "2027-06-10")).toEqual({ yomtov: false, holiday: "Erev Shavuot", candles: { time: "19:26", kind: "other" }, end: null }));
  it("Shavuot on a Friday: Shabbat candles, end is Saturday's", () =>
    expect(run(shavuotDay, "2027-06-11")).toEqual({ yomtov: true, holiday: "Shavuot", candles: { time: "19:27", kind: "shabbat" }, end: { time: "20:30", kind: "shabbat", day: "tomorrow" } }));
  it("erev Yom Kippur (Sunday): candles 'other', end tomorrow (Hebcal gives a plain havdalah item)", () =>
    expect(run(yomKippurEve, "2027-10-10")).toEqual({ yomtov: false, holiday: "Erev Yom Kippur", candles: { time: "17:54", kind: "other" }, end: { time: "18:50", kind: "fast", day: "tomorrow" } }));
  it("Yom Kippur itself (Monday): the fast ends today; the day before it never said fast", () =>
    expect(run(yomKippurDay, "2027-10-11")).toEqual({ yomtov: true, holiday: "Yom Kippur", candles: null, end: { time: "18:50", kind: "fast", day: "today" } }));
});

describe("shabbatTimes: Chanukah (its candles are 'holiday' events with a time, not 'candles')", () => {
  it("a weekday night shows no candle line", () => {
    const r = run(chanukahWeekday, "2026-12-07");
    expect(r.candles).toBeNull();
    expect(r.end).toBeNull();
  });
  it("Friday of Chanukah: only the real Shabbat candle item counts", () =>
    expect(run(chanukahFriday, "2026-12-04").candles).toEqual({ time: "16:15", kind: "shabbat" }));
  it("and tomorrow's end is Shabbat's", () => expect(run(chanukahFriday, "2026-12-04").end).toEqual({ time: "17:16", kind: "shabbat", day: "tomorrow" }));
});

// The chain fixtures are real Hebcal responses for the app's default location (geonameid 294981, i=on, lg=he,
// start=date, end=date+3: the range the calendar load asks for; saved 2026-11-19). Expected chains read by hand.
const chain = (raw: unknown, date: string) => phoneFreeChain(items(raw), date);
const RH1 = { he: "ראש השנה 5788", en: "Rosh Hashana 5788" };
const RH2 = { he: "ראש השנה ב׳", en: "Rosh Hashana II" };

describe("phoneFreeChain", () => {
  it("an ordinary weekday (Thursday) opens nothing, though Friday's candles are in the response", () =>
    expect(chain(chainWeekday, "2026-11-19")).toEqual([]));
  it("an ordinary Friday: Shabbat", () => expect(chain(chainFriday, "2026-11-20")).toEqual([{ date: "2026-11-21", kind: "shabbat", holiday: null }]));
  it("erev Rosh Hashana on a Friday: Saturday (RH I, as Shabbat), Sunday (RH II)", () =>
    expect(chain(chainRhEve, "2027-10-01")).toEqual([
      { date: "2027-10-02", kind: "shabbat", holiday: RH1 },
      { date: "2027-10-03", kind: "holiday", holiday: RH2 },
    ]));
  it("erev Shavuot on a Thursday: Friday (Shavuot), then Shabbat", () =>
    expect(chain(chainErevShavuot, "2027-06-10")).toEqual([
      { date: "2027-06-11", kind: "holiday", holiday: { he: "שבועות", en: "Shavuot" } },
      { date: "2027-06-12", kind: "shabbat", holiday: null },
    ]));
  it("Rosh Hashana on Thursday-Friday (5789): three days, the longest chain", () =>
    expect(chain(chainRhEve2028, "2028-09-20")).toEqual([
      { date: "2028-09-21", kind: "holiday", holiday: { he: "ראש השנה 5789", en: "Rosh Hashana 5789" } },
      { date: "2028-09-22", kind: "holiday", holiday: RH2 },
      { date: "2028-09-23", kind: "shabbat", holiday: null },
    ]));
  it("erev Pesach (Wednesday), a one-day weekday holiday: Thursday's havdalah ends it before Friday's candles", () =>
    expect(chain(chainErevPesach, "2027-04-21")).toEqual([{ date: "2027-04-22", kind: "holiday", holiday: { he: "פסח א׳", en: "Pesach I" } }]));
  it("erev Yom Kippur (Sunday): Monday", () =>
    expect(chain(chainYomKippurEve, "2027-10-10")).toEqual([{ date: "2027-10-11", kind: "holiday", holiday: { he: "יום כיפור", en: "Yom Kippur" } }]));
  it("a chain whose havdalah is out of range is not planned", () =>
    expect(phoneFreeChain([{ title: "c", date: "2027-10-01T18:06:00+03:00", category: "candles" }], "2027-10-01")).toEqual([]));
  it("an invalid date opens nothing", () => expect(chain(chainFriday, "20-11-2026")).toEqual([]));
  it("the times row reads the wider range exactly as before", () => {
    expect(run(chainFriday, "2026-11-20")).toEqual({ yomtov: false, holiday: null, candles: { time: "16:18", kind: "shabbat" }, end: { time: "17:17", kind: "shabbat", day: "tomorrow" } });
    expect(run(chainErevShavuot, "2027-06-10").end).toBeNull();
    expect(run(chainRhEve2028, "2028-09-20")).toEqual({ yomtov: false, holiday: "Erev Rosh Hashana", candles: { time: "18:19", kind: "other" }, end: null });
  });
});

describe("chainTabLabels", () => {
  const kinds = (raw: unknown, date: string) => chainTabLabels(chain(raw, date));
  it("Friday: for Shabbat", () => expect(kinds(chainFriday, "2026-11-20")).toEqual([{ kind: "shabbat" }]));
  it("a one-day holiday: for the holiday", () => expect(kinds(chainErevPesach, "2027-04-21")).toEqual([{ kind: "holiday", day: null }]));
  it("Shavuot into Shabbat: for the holiday, for Shabbat", () =>
    expect(kinds(chainErevShavuot, "2027-06-10")).toEqual([{ kind: "holiday", day: null }, { kind: "shabbat" }]));
  it("Rosh Hashana on Saturday-Sunday: for Shabbat, for the holiday (only one non-Shabbat holiday day)", () =>
    expect(kinds(chainRhEve, "2027-10-01")).toEqual([{ kind: "shabbat" }, { kind: "holiday", day: null }]));
  it("Rosh Hashana on Thursday-Friday: holiday day 1, day 2, then Shabbat", () =>
    expect(kinds(chainRhEve2028, "2028-09-20")).toEqual([{ kind: "holiday", day: 1 }, { kind: "holiday", day: 2 }, { kind: "shabbat" }]));
  it("no chain, no tabs", () => expect(chainTabLabels([])).toEqual([]));
});

describe("defaultTab", () => {
  const base = { candles: "16:18", todayRecorded: false, recorded: [false] };
  it("today until three hours before candle lighting", () => {
    expect(defaultTab({ ...base, now: "09:00" })).toBe(0);
    expect(defaultTab({ ...base, now: "13:17" })).toBe(0);
  });
  it("the planned day from three hours before", () => {
    expect(defaultTab({ ...base, now: "13:18" })).toBe(1);
    expect(defaultTab({ ...base, now: "14:00" })).toBe(1);
    expect(defaultTab({ ...base, now: "23:30" })).toBe(1);
  });
  it("the planned day as soon as today's outfit is worn, whatever the hour", () =>
    expect(defaultTab({ ...base, now: "07:00", todayRecorded: true })).toBe(1));
  it("the first planned day not recorded yet; the first one when all are", () => {
    expect(defaultTab({ ...base, now: "15:00", recorded: [true, false, false] })).toBe(2);
    expect(defaultTab({ ...base, now: "15:00", recorded: [true, true, false] })).toBe(3);
    expect(defaultTab({ ...base, now: "15:00", recorded: [true, true] })).toBe(1);
  });
  it("no candles, no chain or an unreadable time: today", () => {
    expect(defaultTab({ ...base, now: "15:00", candles: null })).toBe(0);
    expect(defaultTab({ ...base, now: "15:00", recorded: [] })).toBe(0);
    expect(defaultTab({ ...base, now: "3pm" })).toBe(0);
  });
});

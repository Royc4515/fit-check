import { NO_CALENDAR, type CalendarFields } from "./observance";
import { CHAIN_MAX_DAYS, isYomKippur, phoneFreeChain, shabbatTimes, stripNiqqud, type HebcalItem } from "./shabbatTimes";

/*
 * The Hebrew calendar as Today keeps it: one Hebcal answer covering a window of days ahead, stored on the device, from
 * which every date in the window is read. Pure (the node test runner loads this file); the requests and the storage
 * are in dayContext.ts.
 *
 * Nothing here computes a Hebrew date, a holiday or a candle time: every such fact is read out of Hebcal's own answer.
 * The one thing derived without it is the civil weekday (Friday, Saturday), which is not a Hebrew-calendar fact.
 */

/**
 * How many days one calendar request covers, from the day it is made. A stored answer is good for any date whose
 * planned days (CHAIN_MAX_DAYS after it) still fall inside, so an ordinary morning never waits for the service: the
 * window is renewed in the background on every open, and only a device that has not opened Today for about eight
 * weeks (a long reserve-duty stint) starts without one. Both Hebcal answers for 60 days are about 30 KB together.
 */
export const CALENDAR_WINDOW_DAYS = 60;

/** A stored calendar answer: Hebcal's events for `start..end` (inclusive, `YYYY-MM-DD`). */
export type CalendarWindow = { start: string; end: string; items: HebcalItem[] };

/** A stored Hebrew-date answer: Hebcal's own Hebrew date for each civil date in `start..end`. */
export type HebrewDateWindow = { start: string; end: string; dates: Record<string, { he: string; en: string }> };

/**
 * `YYYY-MM-DD` plus `days`, and that date's weekday (0 = Sunday), in UTC so no device time zone is involved. An
 * unreadable date gives itself back with weekday -1 (never thrown: callers compare strings and the date never matches).
 */
export function addDays(date: string, days: number): { iso: string; weekday: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { iso: date, weekday: -1 };
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return { iso: t.toISOString().slice(0, 10), weekday: t.getUTCDay() };
}

/**
 * Whether a stored window answers for `date`: the date and the `ahead` days after it (the longest chain of planned
 * days) are all inside it. `YYYY-MM-DD` strings compare in date order. False for an unreadable date.
 */
export function windowCovers(window: { start: string; end: string }, date: string, ahead: number = CHAIN_MAX_DAYS): boolean {
  const last = addDays(date, ahead);
  if (last.weekday < 0) return false;
  return window.start <= date && last.iso <= window.end;
}

/**
 * The calendar fields of one date, read out of a window of Hebcal events: the times row, today's holiday and Yom Tov
 * flag, Yom Kippur, and the chain of planned days. Pure; the same reading the app did per request before, now per date.
 *
 * @param items Hebcal events covering at least `date..date+CHAIN_MAX_DAYS`; events on other dates are ignored.
 * @param date `YYYY-MM-DD`, the local day. An invalid date gives NO_CALENDAR's values (shabbatTimes and
 * phoneFreeChain return nothing for it). Never throws.
 */
export function calendarOn(items: readonly HebcalItem[], date: string): CalendarFields {
  const times = shabbatTimes(items, date);
  return {
    // Detect Yom Tov from the `yomtov` flag, never from the title (Hebcal docs). Only today's events count, so
    // tomorrow's holiday (in the same window) can never change today's day type.
    yomtov: times.yomtov,
    holiday: times.holiday ? { he: stripNiqqud(times.holiday.hebrew ?? times.holiday.title), en: times.holiday.title_orig ?? times.holiday.title } : null,
    candles: times.candles,
    end: times.end,
    yomKippur: times.holiday !== null && isYomKippur(times.holiday),
    chain: phoneFreeChain(items, date),
  };
}

/**
 * What a day is while the Hebrew calendar is not known (no stored answer, no answer yet): only what the civil calendar
 * says. Saturday is Shabbat and Friday's evening opens it, so with the observance switch on a Friday plans tomorrow as
 * Shabbat (one planned day, "for Shabbat"); there are no times, no holiday and no Yom Tov, which the app cannot know
 * without Hebcal and never computes. Every other weekday is NO_CALENDAR. Saturday's own day type comes from the weekday
 * already (observance.ts dayTypeFor).
 *
 * The Friday chain may be short: a holiday that starts or ends next to that Shabbat adds days only the calendar knows.
 * The screen says the calendar is missing while this stands (TodayView's calendar line).
 *
 * @param date `YYYY-MM-DD`, the local day. @param weekday 0 = Sunday ... 6 = Saturday, in the same zone.
 * @param observes The observance switch; off gives NO_CALENDAR (no planned days at all).
 */
export function civilCalendar(date: string, weekday: number, observes: boolean): CalendarFields {
  if (!observes || weekday !== 5) return NO_CALENDAR;
  const saturday = addDays(date, 1);
  if (saturday.weekday !== 6) return NO_CALENDAR;
  return { ...NO_CALENDAR, chain: [{ date: saturday.iso, kind: "shabbat", holiday: null }] };
}

/**
 * Whether a Hebcal events answer can be the calendar (no candle lighting in seven days or more: not a calendar).
 * Shared with the MCP server's calendar request since 2026-11-20 (packages/schema day-context.ts).
 */
export { calendarAnswerUsable } from "@fit-check/schema";

/**
 * Whether a Hebcal converter answer can be the Hebrew-date window: it holds the date asked for. An empty `hdates`
 * passes the schema; stored, it would leave the Hebrew date missing for the window's life. Pure; never throws.
 */
export function hebrewDatesUsable(dates: Readonly<Record<string, unknown>>, date: string): boolean {
  return date in dates;
}

/** The Hebrew date of `date` from a stored window, or null when the window does not hold it. */
export function hebrewDateOn(window: HebrewDateWindow, date: string): { he: string; en: string } | null {
  return window.dates[date] ?? null;
}

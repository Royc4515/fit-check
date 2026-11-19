import type { DayType } from "./dayContext";
import type { PhoneFreeDay, ShabbatTimes } from "./shabbatTimes";

/**
 * "Keeps Shabbat and holidays" (DESIGN.md "שלב 4.1" item 10): the one input behind everything Shabbat-related. Pure
 * here (the node test runner loads this file); the stored setting and its hook are in useObservance.ts.
 *
 * Known limitation: a device setting. The MCP tools (`outfit_today`) compute the day's context on the server and do
 * not know it, so for a user who switched it off they still plan Shabbat by the Shabbat rules.
 */

/** Device storage key, beside the language setting. */
export const OBSERVANCE_KEY = "fitcheck:observes-shabbat";

/** The stored value to the setting: only an explicit "no" turns it off; missing or unreadable means on (the default). */
export function parseObservance(raw: string | null): boolean {
  return raw !== "no";
}

/** The setting to its stored value. */
export const storedObservance = (observes: boolean): string => (observes ? "yes" : "no");

/** The engine's day type: Shabbat and Yom Tov only for someone who keeps them; otherwise every day is a weekday. */
export function dayTypeFor(weekday: number, yomtov: boolean, observes: boolean): DayType {
  if (!observes) return "weekday";
  return yomtov ? "holiday" : weekday === 6 ? "shabbat" : "weekday";
}

/**
 * A Yom Tov for someone who does not keep it: still an ordinary weekday for the engine, but planned a little dressier
 * (DESIGN.md "שלב 4.1" item 10). Never true while the switch is on (then the day is a holiday proper).
 */
export function isFestiveWeekday(yomtov: boolean, observes: boolean): boolean {
  return !observes && yomtov;
}

/** The calendar fields of a day: times row, holiday, Yom Tov flag and the planned days. */
export type CalendarFields = Pick<ShabbatTimes, "candles" | "end"> & {
  holiday: { he: string; en: string } | null;
  yomtov: boolean;
  chain: PhoneFreeDay[];
};

/** What a day without the calendar looks like: no times, no holiday, nothing planned ahead. */
export const NO_CALENDAR: CalendarFields = { holiday: null, candles: null, end: null, yomtov: false, chain: [] };

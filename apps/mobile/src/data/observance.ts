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

/**
 * What the profile's answer means for the setting (DESIGN.md "שלב 4.5" item 7): its boolean when the row has one;
 * null, meaning "the device copy stands", for no row, a null, a malformed answer and any error, including the column
 * not existing yet. Pure, so the hook's one decision is tested.
 */
export function observanceFromProfile(data: unknown, error: unknown): boolean | null {
  if (error) return null;
  if (typeof data !== "object" || data === null || !("observes_shabbat" in data)) return null;
  const value = (data as { observes_shabbat: unknown }).observes_shabbat;
  return typeof value === "boolean" ? value : null;
}

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
  yomKippur: boolean;
  chain: PhoneFreeDay[];
};

/** What a day without the calendar looks like: no times, no holiday, nothing planned ahead. */
export const NO_CALENDAR: CalendarFields = { holiday: null, candles: null, end: null, yomtov: false, yomKippur: false, chain: [] };

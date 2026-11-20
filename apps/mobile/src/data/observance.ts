import type { PhoneFreeDay, ShabbatTimes } from "./shabbatTimes";

/**
 * "Keeps Shabbat and holidays" (DESIGN.md "שלב 4.1" item 10): the one input behind everything Shabbat-related. Pure
 * here (the node test runner loads this file); the stored setting and its hook are in useObservance.ts. The MCP
 * server's `outfit_today` reads the same setting from `profile.observes_shabbat` and plans with the same rule.
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

/**
 * What a profile read changes once it answers: its value, unless the user changed the setting after the read started
 * (their change is newer than the read's answer and must stand), or the answer leaves the device in charge (null).
 * Pure: the change counters come in as data.
 *
 * @param answer The profile's value (observanceFromProfile), null for "the device copy stands".
 * @param changesAtStart The number of user changes when the read started.
 * @param changesNow The number of user changes now.
 * @returns The value to apply, or null for nothing to do.
 */
export function profileReadResult(answer: boolean | null, changesAtStart: number, changesNow: number): boolean | null {
  if (answer === null || changesNow !== changesAtStart) return null;
  return answer;
}

/** The stored value to the setting: only an explicit "no" turns it off; missing or unreadable means on (the default). */
export function parseObservance(raw: string | null): boolean {
  return raw !== "no";
}

/** The setting to its stored value. */
export const storedObservance = (observes: boolean): string => (observes ? "yes" : "no");

/**
 * The engine's day type from the weekday, Hebcal's Yom Tov flag and the switch, and whether a holiday starts one step
 * dressier. Shared with the MCP server's `outfit_today` since 2026-11-20 (packages/schema day-context.ts), so the two
 * plan a day the same way; re-exported here where the app has always read them.
 */
export { dayTypeFor, isFestiveWeekday } from "@fit-check/schema";

/** The calendar fields of a day: times row, holiday, Yom Tov flag and the planned days. */
export type CalendarFields = Pick<ShabbatTimes, "candles" | "end"> & {
  holiday: { he: string; en: string } | null;
  yomtov: boolean;
  yomKippur: boolean;
  chain: PhoneFreeDay[];
};

/** What a day without the calendar looks like: no times, no holiday, nothing planned ahead. */
export const NO_CALENDAR: CalendarFields = { holiday: null, candles: null, end: null, yomtov: false, yomKippur: false, chain: [] };

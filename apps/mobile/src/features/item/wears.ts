import type { TFunction } from "i18next";
import type { ItemWear } from "../../data/feedback";

/** LTR isolate for a number inside Hebrew; first-strong isolate for a date whose words decide its own direction. */
const ltr = (s: string) => `⁦${s}⁩`;
const fsi = (s: string) => `⁨${s}⁩`;

/** yyyy-mm-dd as a Date at UTC midnight, formatted in UTC below, so no device timezone can move the day. */
function utcDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * A wear date in words for the summary line ("12 בנובמבר", "November 12"), in the active locale; the year only when
 * it is not `currentYear`. Wrapped in a first-strong isolate so a Hebrew month stays RTL and an English one LTR.
 * @param date - yyyy-mm-dd (wears.worn_on, the user's local day).
 */
export function longWearDate(date: string, locale: string, currentYear: number): string {
  const day = utcDay(date);
  const year = day.getUTCFullYear() === currentYear ? undefined : "numeric";
  return fsi(new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year, timeZone: "UTC" }).format(day));
}

/**
 * A wear date in digits for a history row (mono `num-sm`: Plex Mono has no Hebrew letters, so no month names), in
 * the active locale's order ("16.11.26", "11/16/26"), LTR-isolated.
 */
export function shortWearDate(date: string, locale: string): string {
  return ltr(new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).format(utcDay(date)));
}

/**
 * The summary under "לבישות": "נלבש 6 פעמים · לאחרונה ב-12 בנובמבר" with the language's plural forms (Hebrew: one,
 * two, other), or "עוד לא נלבש". The count is LTR-isolated in the visible text; pass the result through `spoken()`
 * for an accessible name.
 * @param total - worn wears of the item; `lastDate` the newest one's date (null when there is none).
 */
export function wearSummary(t: TFunction, total: number, lastDate: string | null, locale: string, currentYear: number): string {
  if (total === 0 || !lastDate) return t("item.wears.never");
  return t("item.wears.summary", { count: total, n: ltr(String(total)), date: longWearDate(lastDate, locale, currentYear) });
}

/** The names of the OTHER pieces of a worn outfit, in outfit order; pieces no longer in the wardrobe data are left out. */
export function otherPieces(wear: ItemWear, itemId: string, names: ReadonlyMap<string, string>): string[] {
  return wear.itemIds.flatMap((id) => {
    const name = id === itemId ? undefined : names.get(id);
    return name ? [name] : [];
  });
}

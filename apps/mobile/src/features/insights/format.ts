/**
 * Number and date text for the Insights screen. Numbers are wrapped in LTR isolates so digits and the dollar sign
 * never reorder inside a Hebrew line (DESIGN.md section 2); `spoken()` strips the isolates for screen readers.
 */

/** An isolated left-to-right run (U+2066 … U+2069). */
export const ltr = (s: string | number) => `⁦${s}⁩`;

/** USD with 2 decimals, "$1.20". Always the Latin form: a mono figure, not a localized currency phrase. */
export function usd(n: number): string {
  return ltr(`$${(Math.round(n * 100) / 100).toFixed(2)}`);
}

const parse = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // Noon UTC with timeZone UTC below: the calendar date as written, whatever the device's zone.
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** "12.11" / "11/12": a short numeric date in the active language's order, for the mono column. */
export function shortDate(date: string, locale: string): string {
  return ltr(new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(parse(date)));
}

/** "יום רביעי" / "Wednesday". */
export function weekday(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(parse(date));
}

/** "12 בנובמבר" / "November 12": the spoken form for accessible names. */
export function longDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(parse(date));
}

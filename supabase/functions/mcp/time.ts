/**
 * Today's date in Israel (`YYYY-MM-DD`). Shared by outfit.ts and context.ts so "today" means the same thing in every
 * tool; the app uses the same zone (DEFAULT_LOCATION). Inputs: an instant (default now). Never fails.
 */
export const israelDate = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/**
 * The local time in Israel as zero-padded `HH:MM` (24-hour), the form the shared occasion rule compares against
 * Hebcal's havdalah time. Inputs: an instant (default now). Never fails.
 */
export function israelTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

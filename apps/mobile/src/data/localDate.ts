const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The local date and weekday in `tz` (en-CA formats as yyyy-mm-dd). In its own module, free of React Native, so the
 * pure planning code that needs "today in Israel" stays importable by the node test runner.
 */
export function localDate(tz: string, now: Date = new Date()): { date: string; weekday: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now));
  return { date, weekday };
}

/** Today's date and weekday in Israel. */
export function israelDate(now: Date = new Date()): { date: string; weekday: number } {
  return localDate("Asia/Jerusalem", now);
}

/** The local time `HH:MM` (24-hour) in `tz`, for the default tab's "three hours before candle lighting". */
export function localTime(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

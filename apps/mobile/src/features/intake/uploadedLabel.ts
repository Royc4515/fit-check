const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When a pending photo was uploaded, as the queue's caption says it (DESIGN.md "תור ההזנה"): relative within the last
 * 24 hours ("לפני 3 שעות", "3 hours ago"), a short date after that, with the year only when it is not this year.
 * Pure: `now` comes in, so the gallery's fixtures read the same on every run.
 * @param uploadedAt - ISO time; null or unparsable gives null (the caption is then left out).
 * @param locale - the active UI language, "he" or "en".
 */
export function uploadedLabel(uploadedAt: string | null, now: number, locale: string): string | null {
  const at = uploadedAt ? Date.parse(uploadedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  // A clock a little behind the server's makes a just-sent photo "in 1 minute"; it is "now".
  const ago = Math.max(0, now - at);
  if (ago < DAY) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (ago < MINUTE) return rtf.format(0, "second");
    if (ago < HOUR) return rtf.format(-Math.floor(ago / MINUTE), "minute");
    return rtf.format(-Math.floor(ago / HOUR), "hour");
  }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
}

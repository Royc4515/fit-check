const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The i18n keys of the phrases Intl cannot say cleanly in Hebrew. */
export type AgoKey = "intake.queue.ago.minuteOne" | "intake.queue.ago.hourOne" | "intake.queue.ago.hourTwo";

/**
 * When a pending photo was uploaded, as the queue's caption says it (DESIGN.md "תור ההזנה"): relative within the last
 * 24 hours ("לפני 3 שעות", "3 hours ago"), a short date after that, with the year only when it is not this year.
 * Pure: `now` comes in, so the gallery's fixtures read the same on every run.
 * Hebrew: the singular and the dual are written out by the i18n strings (`intake.queue.ago.*`), because
 * `Intl.RelativeTimeFormat("he")` appends a stray numeral to them ("לפני דקה (1)", "לפני שעתיים (2)"). Every other
 * count, and every English count, still comes from Intl.
 * @param uploadedAt - ISO time; null or unparsable gives null (the caption is then left out).
 * @param locale - the active UI language, "he" or "en".
 * @param t - the translation function, for the three phrases Intl gets wrong in Hebrew.
 */
export function uploadedLabel(uploadedAt: string | null, now: number, locale: string, t: (key: AgoKey) => string): string | null {
  const at = uploadedAt ? Date.parse(uploadedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  // A clock a little behind the server's makes a just-sent photo "in 1 minute"; it is "now".
  const ago = Math.max(0, now - at);
  if (ago < DAY) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (ago < MINUTE) return rtf.format(0, "second");
    if (ago < HOUR) {
      const minutes = Math.floor(ago / MINUTE);
      return minutes === 1 ? t("intake.queue.ago.minuteOne") : rtf.format(-minutes, "minute");
    }
    const hours = Math.floor(ago / HOUR);
    // don't touch / 1 and 2 hours are written out for Hebrew ("שעה", "שעתיים"); the other counts are fine in Intl.
    if (hours === 1) return t("intake.queue.ago.hourOne");
    if (hours === 2) return t("intake.queue.ago.hourTwo");
    return rtf.format(-hours, "hour");
  }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
}

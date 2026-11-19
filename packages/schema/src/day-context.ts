import { z } from "zod";

/**
 * The occasion contexts a person (by hand in the app) or their AI assistant (through the MCP server) can set for a
 * date (PRD 7.1). Only the three the engine styles a look for: `reserve` and `trip` are packing lists, and
 * `weekday | shabbat | holiday` come from the calendar, so none of those may be written through this path.
 */
export const OCCASION_TYPES = ["date", "interview", "event"] as const;
export type OccasionType = (typeof OCCASION_TYPES)[number];

/** `manual`: chosen in the app, or told to the assistant outright. `calendar`: the assistant inferred it. (`hebcal` rows are never written here.) */
export const OCCASION_SOURCES = ["manual", "calendar"] as const;
export type OccasionSource = (typeof OCCASION_SOURCES)[number];

export const OCCASION_LABEL_MAX = 60;

export const OccasionTypeSchema = z.enum(OCCASION_TYPES);
export const OccasionSourceSchema = z.enum(OCCASION_SOURCES);

/** `YYYY-MM-DD`. zod's date check also rejects impossible days such as 2026-02-30. */
export const OccasionDateSchema = z.string().date();

const LINE_BREAKS: ReadonlySet<number> = new Set([0x0a, 0x0d, 0x2028, 0x2029]);

// don't touch / no U+2028 or U+2029 in this file's output, neither raw nor as a \u escape inside a regex or string
// literal (2026-11-19). The mcp bundle travels to the deploy tool as a JSON string, which turned the escapes into
// the raw characters; those are line terminators in JavaScript, so a regex literal holding them failed to parse
// ("Unterminated regexp literal") and the deploy was refused. Code points in a Set keep the source and the bundle ASCII.
function isSingleLine(value: string): boolean {
  for (const ch of value) if (LINE_BREAKS.has(ch.codePointAt(0) ?? 0)) return false;
  return true;
}

/**
 * A short generic description for display ("job interview", "family event in the evening"), never a person's name or
 * the calendar event's title word for word (PRD 7.1). Trimmed first, so the length counts what is shown.
 *
 * don't touch / the single-line rule runs after the trim: a trailing newline is whitespace the trim removes, an
 * embedded one (two lines) is rejected. U+2028/U+2029 count as line breaks because they break a line in the UI too.
 */
export const OccasionLabelSchema = z
  .string()
  .trim()
  .min(1, "label must not be empty")
  .max(OCCASION_LABEL_MAX, `label must be at most ${OCCASION_LABEL_MAX} characters`)
  .refine(isSingleLine, "label must be a single line");

/** One day's occasion context, as stored: what `contexts` holds minus bookkeeping. */
export const DayContextSchema = z.object({
  type: OccasionTypeSchema,
  date: OccasionDateSchema,
  label: OccasionLabelSchema.optional(),
  source: OccasionSourceSchema,
});
export type DayContext = z.infer<typeof DayContextSchema>;

/** How far from today the MCP server accepts a date: a guard against an assistant that mixed up the day. */
export const OCCASION_MAX_DAYS_AHEAD = 14;
export const OCCASION_MAX_DAYS_PAST = 1;

const DAY_MS = 86_400_000;

/** Whole days from `today` to `date` (both `YYYY-MM-DD`); negative for the past. UTC arithmetic: no DST, no time zone. */
export function daysBetween(today: string, date: string): number {
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / DAY_MS);
}

/**
 * Why `date` may not be written or cleared relative to `today`, or null when it is inside the window
 * (1 day back .. 14 days ahead). Both arguments are `YYYY-MM-DD` already validated; `today` is the caller's, so the
 * result is deterministic.
 */
export function occasionDateWindowError(date: string, today: string): string | null {
  const diff = daysBetween(today, date);
  if (diff > OCCASION_MAX_DAYS_AHEAD) return `${date} is ${diff} days ahead; at most ${OCCASION_MAX_DAYS_AHEAD} days ahead is accepted (today is ${today}).`;
  if (diff < -OCCASION_MAX_DAYS_PAST) return `${date} is ${-diff} days in the past; at most ${OCCASION_MAX_DAYS_PAST} day back is accepted (today is ${today}).`;
  return null;
}

export type CalendarDayType = "weekday" | "shabbat" | "holiday";

export type DayPlan = {
  /** Which engine rule set (DEFAULT_CONTEXT_RULES key) the look follows. */
  rules: CalendarDayType | OccasionType;
  /** Taps of "dressier" applied on top of the rule set (engine DayAdjustment.formality_steps). */
  formality_steps: 0 | 1;
  /** One plain line saying which context was used and why, shown to the assistant. */
  reason: string;
};

/**
 * Decides which rule set today's outfit follows. Pure: the calendar's answer, the stored occasion and the profile
 * setting all come in as arguments.
 *
 * Order (PRD 7.1, DESIGN 4.1 item 10):
 * 1. A day type the caller passed explicitly wins over everything (an explicit argument is the most deliberate input).
 * 2. A stored occasion beats the calendar-derived day type, even on Shabbat: setting it was an explicit choice.
 * 3. A user who does not keep Shabbat and holidays: Shabbat is a weekday, a holiday a weekday one step dressier.
 * 4. Otherwise the calendar's day type.
 */
export function planDay(input: {
  dayType: CalendarDayType;
  dayTypeForced: boolean;
  occasion: { type: OccasionType; label?: string; source: OccasionSource } | null;
  observesShabbat: boolean;
}): DayPlan {
  const { dayType, dayTypeForced, occasion, observesShabbat } = input;
  if (dayTypeForced) return { rules: dayType, formality_steps: 0, reason: `${dayType}, as requested by the caller` };
  if (occasion) {
    const how = occasion.source === "manual" ? "set by hand" : "set from the calendar";
    return { rules: occasion.type, formality_steps: 0, reason: `${occasion.type}${occasion.label ? ` ("${occasion.label}")` : ""}, ${how}` };
  }
  if (!observesShabbat && dayType === "shabbat") {
    return { rules: "weekday", formality_steps: 0, reason: "weekday (it is Shabbat, but the profile says the user does not keep Shabbat)" };
  }
  if (!observesShabbat && dayType === "holiday") {
    return { rules: "weekday", formality_steps: 1, reason: "weekday, one step dressier (it is a holiday, but the profile says the user does not keep holidays)" };
  }
  return { rules: dayType, formality_steps: 0, reason: dayType };
}

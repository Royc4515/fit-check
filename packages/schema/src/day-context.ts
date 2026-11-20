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


// ---------------------------------------------------------------------------------------------------------------
// Which context decides a date's look: ONE rule for the app (Today) and the MCP server (outfit_today), so the two
// cannot drift again (2026-11-20: the server let a calendar "date" replace Shabbat clothes on Shabbat for days after
// the app stopped doing it). Pure: the calendar's facts, the clock and the profile setting all come in as arguments.
// Nothing here computes a Hebrew date, a holiday or a candle time: those facts are read out of Hebcal's own answer.
// ---------------------------------------------------------------------------------------------------------------

export type CalendarDayType = "weekday" | "shabbat" | "holiday";

/**
 * The engine's day type: Shabbat and Yom Tov only for someone who keeps them; otherwise every day is a weekday.
 *
 * @param weekday 0 = Sunday ... 6 = Saturday, in the location's time zone (a civil fact, no calendar needed).
 * @param yomtov Hebcal flags one of the date's events as Yom Tov; false when the calendar is not known.
 * @param observes The profile's "keeps Shabbat and holidays" switch. Never throws.
 */
export function dayTypeFor(weekday: number, yomtov: boolean, observes: boolean): CalendarDayType {
  if (!observes) return "weekday";
  return yomtov ? "holiday" : weekday === 6 ? "shabbat" : "weekday";
}

/**
 * A Yom Tov for someone who does not keep it: still an ordinary weekday for the engine, but planned a little dressier
 * (DESIGN.md "שלב 4.1" item 10). Never true while the switch is on (then the day is a holiday proper). Never throws.
 */
export function isFestiveWeekday(yomtov: boolean, observes: boolean): boolean {
  return !observes && yomtov;
}

/** What "may an occasion decide this look" needs to know about the day and the moment. */
export type OccasionTiming = {
  /** "today", or "planned" for a planned day's tab (Shabbat or a holiday after today's candle lighting). */
  tab: "today" | "planned";
  /** The calendar's day type for that date, after the observance switch (dayTypeFor). */
  dayType: CalendarDayType;
  /** That date's havdalah `HH:MM` when it falls on that date (Hebcal's havdalah item), else null. */
  havdalahToday: string | null;
  /** The local time `HH:MM` in the location's time zone (clockOnDate for a date other than today). */
  now: string;
};

/**
 * Whether a day's occasion (date, interview, event) may decide its look (DESIGN.md "שלב 4.5" item 3, corrected
 * 19.11): on a weekday, yes; on Shabbat or a holiday for someone who keeps them, only after that date's havdalah
 * (a date on Saturday night gets a date look; the Shabbat look itself stays Shabbat's), and never on a date without
 * a havdalah (the first day of a two-day holiday). A planned day's tab ("for Shabbat", "for the holiday") never.
 * With the observance switch off, Shabbat and holidays already reach here as weekdays, so the occasion always wins.
 * Pure: the time comes in as data. Never throws; an unreadable `now` or `havdalahToday` compares as text.
 */
export function occasionMayApply(args: OccasionTiming): boolean {
  if (args.tab === "planned") return false;
  if (args.dayType === "weekday") return true;
  // Zero-padded `HH:MM` strings compare in time order.
  return args.havdalahToday !== null && args.now >= args.havdalahToday;
}

/** The occasion that decides a day's look: the stored one when it may apply (occasionMayApply), else none. */
export function occasionInEffect(occasion: OccasionType | null | undefined, args: OccasionTiming): OccasionType | undefined {
  return occasion && occasionMayApply(args) ? occasion : undefined;
}

/**
 * The clock to judge a date by, as `HH:MM`: the real local time on `today`; "00:00" for a later date (its day has not
 * begun, so its havdalah has not come); "24:00" for an earlier one (its day is over, every havdalah of it has passed).
 * All three are `YYYY-MM-DD` / `HH:MM` strings already validated by the caller. Never throws.
 */
export function clockOnDate(date: string, today: string, nowToday: string): string {
  return date === today ? nowToday : date > today ? "00:00" : "24:00";
}

/** The engine rule set a day follows (a key of DEFAULT_CONTEXT_RULES, or Yom Kippur's own rules). */
export type RuleSet = CalendarDayType | OccasionType | "yom_kippur";

/**
 * The rule set of a day: its occasion when one is in effect (it overrides the calendar, Yom Kippur included: PRD 7.1),
 * else Yom Kippur's own rules on Yom Kippur (no leather shoes; it is still recorded as `holiday`), else the day type.
 * Holidays share the Shabbat rules inside the engine's table (PRD section 7). Pure; never throws.
 */
export function ruleSetOf(day: { dayType: CalendarDayType; yomKippur?: boolean | undefined; occasion?: OccasionType | undefined }): RuleSet {
  if (day.occasion) return day.occasion;
  return day.yomKippur && day.dayType !== "weekday" ? "yom_kippur" : day.dayType;
}

/** The fields of a Hebcal event this module reads (a subset of `HebcalItemsSchema`'s items). */
export type HebcalDayItem = { date: string; category: string; title_orig?: string | undefined; yomtov?: boolean | undefined };

/** What the Hebrew calendar says about one date, as the rule needs it. */
export type HebrewDayFacts = {
  /** One of the date's events is flagged Yom Tov by Hebcal (never read from a title). */
  yomtov: boolean;
  /** The date is Yom Kippur (Hebcal `title_orig === "Yom Kippur"`, exact). */
  yomKippur: boolean;
  /** The havdalah that falls on this date, `HH:MM`, else null. */
  havdalahToday: string | null;
};

const timeOf = (item: HebcalDayItem): string | null => {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(item.date);
  return m ? m[1]! : null;
};

/**
 * The facts of `date` read out of Hebcal events, exactly as the app reads them (apps/mobile/src/data/shabbatTimes.ts
 * `shabbatTimes` and calendarWindow.ts `calendarOn`; a parity test in the app checks the two agree on real answers).
 * Only events dated `date` count: tomorrow's holiday never marks today.
 *
 * @param items Hebcal events covering at least `date` (others are ignored by date).
 * @param date `YYYY-MM-DD`. A date with no events is an ordinary day (all false / null). Never throws.
 */
export function hebcalDayFacts(items: readonly HebcalDayItem[], date: string): HebrewDayFacts {
  const todays = items.filter((i) => i.date.startsWith(date));
  const yomtovItem = todays.find((i) => i.yomtov === true);
  const holiday = yomtovItem ?? todays.find((i) => i.category === "holiday") ?? null;
  const havdalah = todays.find((i) => i.category === "havdalah");
  return {
    yomtov: yomtovItem !== undefined,
    // don't touch / exact English name from `title_orig` (the other fields are localized): "Erev Yom Kippur" and
    // "Yom Kippur Katan" are not the day.
    yomKippur: holiday !== null && holiday.category === "holiday" && holiday.title_orig === "Yom Kippur",
    havdalahToday: havdalah ? timeOf(havdalah) : null,
  };
}

/**
 * Whether a Hebcal events answer for `start..end` can be the calendar. Every week has a Friday, and Hebcal (asked with
 * `c=on`) gives a candle lighting for it, so a window of seven days or more with no candle-lighting item is not a real
 * calendar: an empty or truncated answer that still passes the schema. Stored as known it would hide every Shabbat and
 * holiday for two months with no warning line, so the caller treats it as a failed request. Pure; never throws. A
 * window shorter than seven days, or with unreadable dates, is judged by the schema alone (true).
 */
export function calendarAnswerUsable(items: readonly { category: string }[], start: string, end: string): boolean {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || (b - a) / 86_400_000 + 1 < 7) return true;
  return items.some((i) => i.category === "candles");
}

/** Said when the Hebrew calendar could not be read on a day other than Saturday (PRD 7, "כשהלוח העברי לא זמין"). */
export const CALENDAR_UNAVAILABLE_MESSAGE =
  "The Hebrew calendar could not be read, so if the day is a holiday or its eve the candidates do not fit.";
/** Said on a Saturday without the calendar: Shabbat is known from the weekday, Yom Kippur is not. */
export const CALENDAR_UNAVAILABLE_SHABBAT_MESSAGE =
  "The Hebrew calendar could not be read. Saturday is Shabbat by the civil calendar, so the candidates follow the Shabbat rules; if the day is Yom Kippur they do not fit.";

/** The typed warning an answer carries when the Hebrew calendar is not known (the app's calendar line, in words). */
export type CalendarWarning = { code: "hebrew_calendar_unavailable"; message: string };

/** A stored occasion as the rule needs it. */
export type StoredOccasion = { type: OccasionType; label?: string | undefined; source: OccasionSource };

export type DayPlan = {
  /** The engine rule set the look follows (DEFAULT_CONTEXT_RULES key, or "yom_kippur" for YOM_KIPPUR_RULES). */
  rules: RuleSet;
  /** The calendar's day type after the observance switch (and after an explicit day type). */
  dayType: CalendarDayType;
  /** The context a wear of this look is recorded in (`outfits.context_type`): the occasion in effect, else the day type. */
  contextType: CalendarDayType | OccasionType;
  /** Start one "dressier" step up (engine FESTIVE_FORMALITY_STEPS): a holiday for someone who does not keep it. */
  festive: boolean;
  /** The stored occasion and whether it decides the look now, with the reason in plain words; null when none is stored. */
  occasion: { type: OccasionType; label: string | null; source: OccasionSource; applied: boolean; why: string } | null;
  /** The Hebrew calendar's facts were known (false: only the civil calendar was used). */
  calendarKnown: boolean;
  /** Present when the calendar is not known and that matters (observance on): the answer must say so. */
  warning: CalendarWarning | null;
  /** One plain line saying which context was used and why, shown to the assistant. */
  reason: string;
};

/**
 * Decides which rule set a date's look follows, with the same rules as the app's Today screen. Pure: the calendar's
 * facts, the stored occasion, the profile setting and the clock all come in as arguments.
 *
 * Order (PRD 7.1 "קדימות", DESIGN.md "שלב 4.5" items 1 and 3 as corrected 19.11):
 * 1. A day type the caller passed explicitly wins over everything, the occasion included (the most deliberate input).
 * 2. The calendar's day type (dayTypeFor): Shabbat and holidays only for someone who keeps them.
 * 3. A stored occasion decides on a weekday; on Shabbat or a holiday (switch on) only after that date's havdalah, and
 *    never on a date without one (occasionMayApply). With the switch off it always decides.
 * 4. Yom Kippur (switch on, no occasion in effect) follows its own rules (ruleSetOf).
 *
 * Without the Hebrew calendar (`calendar` null: the request failed or timed out) only the civil calendar is used, as
 * the app does: Saturday is Shabbat (so an occasion never applies on it: its havdalah is unknown), every other day a
 * weekday, and nothing is guessed about a holiday. With the switch on, `warning` then says the candidates may not fit.
 *
 * @param input.weekday 0 = Sunday ... 6 = Saturday of the date, in Israel.
 * @param input.calendar Hebcal's facts for the date (hebcalDayFacts), or null when they could not be read.
 * @param input.now The clock to judge the date by (clockOnDate).
 * @param input.dayTypeForced An explicit day type from the caller, or null.
 * Failure modes: none; never throws.
 */
export function planDay(input: {
  weekday: number;
  calendar: HebrewDayFacts | null;
  observesShabbat: boolean;
  occasion: StoredOccasion | null;
  dayTypeForced: CalendarDayType | null;
  now: string;
}): DayPlan {
  const { weekday, calendar, observesShabbat, occasion, dayTypeForced, now } = input;
  const stored = (applied: boolean, why: string): DayPlan["occasion"] =>
    occasion ? { type: occasion.type, label: occasion.label ?? null, source: occasion.source, applied, why } : null;
  const named = occasion
    ? `${occasion.type}${occasion.label ? ` ("${occasion.label}")` : ""}, ${occasion.source === "manual" ? "set by hand" : "set from the calendar"}`
    : "";

  if (dayTypeForced) {
    return {
      rules: dayTypeForced,
      dayType: dayTypeForced,
      contextType: dayTypeForced,
      festive: false,
      occasion: stored(false, "not used: a day_type was passed explicitly"),
      calendarKnown: calendar !== null,
      warning: null,
      reason: `${dayTypeForced}, as requested by the caller`,
    };
  }

  const facts: HebrewDayFacts = calendar ?? { yomtov: false, yomKippur: false, havdalahToday: null };
  const dayType = dayTypeFor(weekday, facts.yomtov, observesShabbat);
  const yomKippur = observesShabbat && facts.yomKippur;
  const inEffect = occasionInEffect(occasion?.type, { tab: "today", dayType, havdalahToday: facts.havdalahToday, now });
  const rules = ruleSetOf({ dayType, yomKippur, occasion: inEffect });
  const festive = isFestiveWeekday(facts.yomtov, observesShabbat) && !inEffect;
  const warning: CalendarWarning | null =
    observesShabbat && calendar === null
      ? { code: "hebrew_calendar_unavailable", message: weekday === 6 ? CALENDAR_UNAVAILABLE_SHABBAT_MESSAGE : CALENDAR_UNAVAILABLE_MESSAGE }
      : null;

  const day = rules === "yom_kippur" ? "Yom Kippur" : dayType;
  let why = "";
  if (occasion && !inEffect) {
    why =
      facts.havdalahToday !== null
        ? `waits: on ${day} the ${day} rules decide until havdalah at ${facts.havdalahToday}, and the ${occasion.type} rules apply only after it`
        : calendar === null
          ? `not used: it is ${day} by the civil calendar and the Hebrew calendar could not be read, so the time of havdalah is unknown`
          : `not used: on ${day} the ${day} rules decide all day, because this date has no havdalah (the holiday or Shabbat goes on)`;
  }
  const base = festive
    ? "weekday, one step dressier (it is a holiday, but the profile says the user does not keep holidays)"
    : !observesShabbat && weekday === 6 && !inEffect
      ? "weekday (it is Shabbat, but the profile says the user does not keep Shabbat)"
      : day;
  const reason = inEffect
    ? `${named}${dayType === "weekday" ? "" : ` (after havdalah at ${facts.havdalahToday})`}`
    : occasion
      ? `${base}; the stored occasion (${named}) ${why}`
      : base;

  return {
    rules,
    dayType,
    contextType: inEffect ?? dayType,
    festive,
    occasion: stored(inEffect !== undefined, inEffect ? "applies" : why),
    calendarKnown: calendar !== null,
    warning,
    reason,
  };
}

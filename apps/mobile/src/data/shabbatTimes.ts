/** The fields of a Hebcal event that this module reads (a subset of what `HebcalItemsSchema` parses). */
export type HebcalItem = {
  title: string;
  date: string;
  category: string;
  title_orig?: string | undefined;
  hebrew?: string | undefined;
  yomtov?: boolean | undefined;
};

export type ShabbatTimes = {
  /** Today's holiday event (Yom Tov first), or null. Only events dated today; tomorrow's never marks today. */
  holiday: HebcalItem | null;
  /** True when one of today's events is flagged Yom Tov by Hebcal. */
  yomtov: boolean;
  /** Candle lighting today as `HH:MM`; "shabbat" only on a Friday, "other" for a holiday eve or a second night. */
  candles: { time: string; kind: "shabbat" | "other" } | null;
  /**
   * The end of Shabbat, of the holiday, or of the Yom Kippur fast as `HH:MM`, only when it falls today or tomorrow.
   * `day` says which. Yom Kippur wins over "shabbat" when it falls on a Saturday. Combinations that occur: tomorrow
   * with "shabbat" only from a Friday; tomorrow with "holiday" or "fast" only from a non-Friday; but the function
   * decides from the data and stays total.
   */
  end: { time: string; kind: "shabbat" | "holiday" | "fast"; day: "today" | "tomorrow" } | null;
};

const NONE: ShabbatTimes = { holiday: null, yomtov: false, candles: null, end: null };

/** `date + 1` for a `YYYY-MM-DD` string, and its weekday (0 = Sunday), in UTC so no device time zone is involved. */
function dayInfo(date: string, plus = 0): { iso: string; weekday: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plus);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return { iso: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
}

/** The day after a `YYYY-MM-DD` string (for Hebcal's `end=`), or null if the string is not a date. */
export function nextDate(date: string): string | null {
  return dayInfo(date, 1)?.iso ?? null;
}

/** `HH:MM` from an ISO date-time, or null for a date-only item (candle and havdalah items always carry a time). */
function timeOf(item: HebcalItem): string | null {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(item.date);
  return m ? m[1]! : null;
}

/**
 * What Today shows about Shabbat and holidays, from Hebcal events for `date` and the next day.
 *
 * @param items Events for `date` and `date + 1` (Hebcal `start=date&end=date+1`); anything else is ignored by date.
 * @param date `YYYY-MM-DD`, the Israel-local day. An invalid string yields all-null (no guess).
 * @returns Today's holiday and Yom Tov flag from today's events only; today's candle time (kind by weekday); and
 * the end of Shabbat/holiday if it is today, or tomorrow when there are candles today (a holiday that runs more
 * than one more day shows no end yet: a time without its day would mislead).
 *
 * Hebcal returns the end as category `havdalah` on weekdays and Saturdays alike; Chanukah candles are
 * `holiday` events, not `candles`, so a weekday Chanukah night correctly shows nothing.
 */
export function shabbatTimes(items: readonly HebcalItem[], date: string): ShabbatTimes {
  const today = dayInfo(date);
  const tomorrow = dayInfo(date, 1);
  if (!today || !tomorrow) return NONE;
  const onDay = (iso: string) => items.filter((i) => i.date.startsWith(iso));
  const todays = onDay(today.iso);

  const yomtovItem = todays.find((i) => i.yomtov === true);
  const holiday = yomtovItem ?? todays.find((i) => i.category === "holiday") ?? null;

  const candleTime = (() => {
    const item = todays.find((i) => i.category === "candles");
    return item ? timeOf(item) : null;
  })();
  const candles = candleTime ? { time: candleTime, kind: today.weekday === 5 ? ("shabbat" as const) : ("other" as const) } : null;

  const todayEnd = todays.find((i) => i.category === "havdalah");
  const tomorrowEnd = candles ? onDay(tomorrow.iso).find((i) => i.category === "havdalah") : undefined;
  const endItem = todayEnd ?? tomorrowEnd;
  const endDay = todayEnd ? today : tomorrow;
  const endTime = endItem ? timeOf(endItem) : null;
  // Yom Kippur is found by the English event name Hebcal keeps in `title_orig` whatever `lg` is: the other fields
  // are localized (`title`, `hebrew`, the havdalah item's `memo`) and `link` is a URL slug that is not a documented
  // contract. Exact match, so "Erev Yom Kippur" and "Yom Kippur Katan" do not count. It is read on the day the
  // havdalah belongs to, so the eve never says "fast".
  const endIsFast = onDay(endDay.iso).some((i) => i.category === "holiday" && i.title_orig === "Yom Kippur");
  const kind = endIsFast ? ("fast" as const) : endDay.weekday === 6 ? ("shabbat" as const) : ("holiday" as const);
  const end = endTime ? { time: endTime, kind, day: todayEnd ? ("today" as const) : ("tomorrow" as const) } : null;

  return { holiday, yomtov: yomtovItem !== undefined, candles, end };
}

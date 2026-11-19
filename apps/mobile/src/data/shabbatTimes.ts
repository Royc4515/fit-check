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

/** One day after candle lighting on which the phone stays off, planned ahead (DESIGN.md "שלב 4.1" item 8). */
export type PhoneFreeDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** "shabbat" when the date is a Saturday (Rosh Hashana on Shabbat included), else "holiday". */
  kind: "shabbat" | "holiday";
  /** That date's Yom Tov name, niqqud stripped (he) and Hebcal's English (en); null for a plain Shabbat. */
  holiday: { he: string; en: string } | null;
};

/**
 * How many days after today the calendar must cover: the longest chain of phone-free days that one candle lighting
 * opens. In Israel that is three (Rosh Hashana on Thursday and Friday, then Shabbat: 2028-09-21..23); abroad a
 * two-day Yom Tov on Thursday and Friday followed by Shabbat is also three. Hebcal is asked for `date..date+3`.
 */
export const CHAIN_MAX_DAYS = 3;

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

/** Hebcal returns pointed Hebrew (niqqud); the editorial lines read cleaner without it. */
export function stripNiqqud(s: string): string {
  return s.replace(/[\u0591-\u05C7]/g, "");
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

/**
 * The phone-free days that today's candle lighting opens: every date after today up to and including the date of the
 * next `havdalah` item, in order. Pure; the items come in as data.
 *
 * @param items Hebcal events for `date..date+CHAIN_MAX_DAYS` (anything else is ignored by date).
 * @param date `YYYY-MM-DD`, the local day.
 * @returns [] when there is no candle lighting today, when the date is invalid, and when no havdalah falls within
 * CHAIN_MAX_DAYS (a chain whose end cannot be seen is not planned: a guess would plan a weekday as Shabbat).
 * Chanukah candles are `holiday` events, not `candles`, so they open nothing.
 */
export function phoneFreeChain(items: readonly HebcalItem[], date: string): PhoneFreeDay[] {
  const today = dayInfo(date);
  if (!today) return [];
  const onDay = (iso: string) => items.filter((i) => i.date.startsWith(iso));
  if (!onDay(today.iso).some((i) => i.category === "candles")) return [];
  const chain: PhoneFreeDay[] = [];
  for (let plus = 1; plus <= CHAIN_MAX_DAYS; plus++) {
    const day = dayInfo(date, plus);
    if (!day) return [];
    const events = onDay(day.iso);
    const yomtov = events.find((i) => i.yomtov === true);
    chain.push({
      date: day.iso,
      kind: day.weekday === 6 ? "shabbat" : "holiday",
      holiday: yomtov ? { he: stripNiqqud(yomtov.hebrew ?? yomtov.title), en: yomtov.title_orig ?? yomtov.title } : null,
    });
    // The havdalah closes the chain on its own date; candles on the evening of a chain day keep it going.
    if (events.some((i) => i.category === "havdalah")) return chain;
  }
  return [];
}

/** What a tab after "today" is called (DESIGN.md "שלב 4.1" item 8); the screen maps it to its string. */
export type ChainTabLabel = { kind: "shabbat" } | { kind: "holiday"; day: 1 | 2 | null };

/**
 * Tab labels for a chain, in its order: "for Shabbat" for a Saturday, "for the holiday" for a holiday day, and
 * "holiday, day 1 / day 2" when two days of the chain are holiday days that are not Shabbat (Rosh Hashana on
 * Thursday-Friday). Rosh Hashana on Saturday-Sunday is "for Shabbat", "for the holiday": one of its days is Shabbat.
 */
export function chainTabLabels(chain: readonly Pick<PhoneFreeDay, "kind">[]): ChainTabLabel[] {
  const holidays = chain.filter((d) => d.kind === "holiday").length;
  let n = 0;
  return chain.map((d): ChainTabLabel => {
    if (d.kind === "shabbat") return { kind: "shabbat" };
    n++;
    return { kind: "holiday", day: holidays >= 2 ? (n === 1 ? 1 : 2) : null };
  });
}

/** How long before candle lighting Today opens on the first planned day (PRD 4.3; DESIGN.md "שלב 4.1" item 3). */
export const PLAN_AHEAD_MINUTES = 180;

const minutesOf = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Which tab Today opens on, as an index into ["today", ...chain]. Today until three hours before candle lighting;
 * from then on, or once today's outfit is recorded as worn, the first planned day not recorded yet (the first planned
 * day when every one is). Pure: the clock comes in as data.
 *
 * @param args.now The local time `HH:MM`, in the same time zone as `candles`.
 * @param args.candles Today's candle lighting `HH:MM`; null (no candles) or an unreadable time always gives 0.
 * @param args.todayRecorded Today's outfit is already recorded as worn.
 * @param args.recorded One flag per chain day: its outfit is recorded as worn. An empty chain always gives 0.
 */
export function defaultTab(args: { now: string; candles: string | null; todayRecorded: boolean; recorded: readonly boolean[] }): number {
  const { now, candles, todayRecorded, recorded } = args;
  if (!candles || recorded.length === 0) return 0;
  const at = minutesOf(now);
  const lighting = minutesOf(candles);
  if (at === null || lighting === null) return 0;
  if (!todayRecorded && at < lighting - PLAN_AHEAD_MINUTES) return 0;
  const open = recorded.findIndex((r) => !r);
  return 1 + (open === -1 ? 0 : open);
}

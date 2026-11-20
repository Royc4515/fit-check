import type { FeedbackHistory } from "../../data/feedback";
import { chainTabLabels, defaultTab, type ChainTabLabel, type PhoneFreeDay } from "../../data/shabbatTimes";

/*
 * The day a wear pressed now belongs to (DESIGN.md "שלב 4.1" item 3, "שלב 5.2" item 4). One rule, used by Today for
 * the tab it opens on and by the saved outfit's screen for the day its button records on, so the two never disagree.
 * Pure: the clock comes in as data.
 */

/** What the rule needs of the day's context (data/dayContext.ts DayContext). */
export type DayInForceInput = {
  /** Today's civil date in the location's time zone. */
  date: string;
  /** Today's candle lighting, null without one (and always with the observance switch off). */
  candles: { time: string } | null;
  /** The phone-free days today's candle lighting opens, in order; [] without candles or with the switch off. */
  chain: readonly { date: string }[];
};

/**
 * The date of the day in force: today until three hours before today's candle lighting; from then on, or once today's
 * outfit is recorded as worn, the first planned day (Shabbat, the holiday) not recorded yet, or the first planned day
 * when every one is (data/shabbatTimes.ts defaultTab). Without candles (any ordinary day, Shabbat itself, after
 * havdalah, the observance switch off) it is always today's date.
 *
 * Callers decide it once, when the screen opens with the day's records read: wearing today's outfit must not pull the
 * screen to Shabbat under the user's thumb.
 *
 * @param args.now The local time `HH:MM` in the location's time zone (localTime).
 * @param args.history The day's records (useFeedback, read up to the last planned day).
 * Failure modes: none thrown; an unreadable candle time gives today.
 */
export function dayInForce(args: { day: DayInForceInput; now: string; history: Pick<FeedbackHistory, "today" | "ahead"> }): string {
  const { day, now, history } = args;
  const tab = defaultTab({
    now,
    candles: day.candles?.time ?? null,
    todayRecorded: history.today.some((r) => r.feedback === "worn"),
    recorded: day.chain.map((d) => history.ahead.some((r) => r.date === d.date && r.feedback === "worn")),
  });
  return day.chain[tab - 1]?.date ?? day.date;
}

/** The i18n key of a planned day's tab ("for Shabbat", "for Yom Kippur", "for the holiday", "holiday, day 1"). */
export const tabKey = (label: ChainTabLabel) =>
  label.kind === "shabbat"
    ? "today.tabs.shabbat"
    : label.kind === "yom_kippur"
      ? "today.tabs.yomKippur"
      : label.day === null
        ? "today.tabs.holiday"
        : `today.tabs.holidayDay${label.day}`;

/**
 * The day tabs of a day (DESIGN.md "שלב 4.1" item 2): today, then each planned day, keyed by date, with the i18n key
 * of each label. Empty when there is no planned day (no tabs are drawn). Today and the saved outfit's screen both draw
 * these (DayTabs.tsx), so they show the same tabs on the same days.
 */
export function dayTabKeys(day: { date: string; chain: readonly Pick<PhoneFreeDay, "date" | "kind">[] }): { key: string; labelKey: string }[] {
  if (day.chain.length === 0) return [];
  const labels = chainTabLabels(day.chain);
  return [{ key: day.date, labelKey: "today.tabs.today" }, ...day.chain.map((d, i) => ({ key: d.date, labelKey: tabKey(labels[i]!) }))];
}

/** A planned day's "I'll wear it on ..." and "Logged: ... for ..." keys, by what the day is (Today's own words). */
export const plannedKeys = (kind: "shabbat" | "holiday" | "yom_kippur") =>
  kind === "shabbat"
    ? { wear: "today.wearOnShabbat", worn: "today.status.wornShabbat" }
    : kind === "yom_kippur"
      ? { wear: "today.wearOnYomKippur", worn: "today.status.wornYomKippur" }
      : { wear: "today.wearOnHoliday", worn: "today.status.wornHoliday" };

import type { SavedOutfitSignal } from "@fit-check/engine";
import type { FeedbackHistory } from "../../data/feedback";

/**
 * Which saved outfits Today's engine learns from (DESIGN.md "שלב 5.2" item 8), and when that list may change. Pure, so
 * the rule is tested without a screen.
 *
 * The saved list is read together with the day's other data, and the first suggestion waits for it a little
 * (firstGeneration, at most SAVED_LIST_GRACE_MS after the rest). A list that answers later would re-rank every tab
 * under the user's eyes, and a new shortlist also costs a new stylist call. So the list in force is fixed when the
 * screen opens (the list if it answered in time, else none) and is replaced only when the user asks for a different
 * outfit anyway: a new skip or dislike, or a nudge in the adjust sheet. An undone skip goes back to the list that was
 * in force before that skip, so undo shows the outfit it took away.
 */
export type LearnState = {
  /** Skip and dislike records across today and the planned days, when this state was made. */
  skips: number;
  /** The adjust sheet's taps by date, by identity: a new object is a nudge. */
  adjustments: unknown;
  /** The list in force at each skip count seen; the current one is `byCount.get(skips)`. */
  byCount: ReadonlyMap<number, readonly SavedOutfitSignal[]>;
};

const NONE: readonly SavedOutfitSignal[] = [];

/** Skip and dislike records (every answer that is not a wear) across today and the planned days. */
export function skipCount(history: Pick<FeedbackHistory, "today" | "ahead">): number {
  let n = 0;
  for (const r of history.today) if (r.feedback !== "worn") n++;
  for (const r of history.ahead) if (r.feedback !== "worn") n++;
  return n;
}

/**
 * The state when Today opens. `live` is the store's list when it has been read, else null (still loading, or failed):
 * then the screen learns from nothing until the next regeneration.
 */
export function initialLearn(skips: number, adjustments: unknown, live: readonly SavedOutfitSignal[] | null): LearnState {
  return { skips, adjustments, byCount: new Map([[skips, live ?? NONE]]) };
}

/**
 * The state after a render. Returns `prev` itself when nothing that regenerates the outfit happened, so the caller can
 * compare by identity. Never throws.
 *
 * - more skips than before (a new skip or dislike) or a nudge: the latest read list, or the one in force if none was
 *   read yet;
 * - fewer skips (an undo): the list that was in force at that count, so the outfit that was skipped comes back as it
 *   was; the latest list if that count was never seen (a skip recorded before the screen opened, undone now).
 */
export function nextLearn(prev: LearnState, skips: number, adjustments: unknown, live: readonly SavedOutfitSignal[] | null): LearnState {
  if (skips === prev.skips && adjustments === prev.adjustments) return prev;
  const fresh = live ?? learnedFrom(prev);
  const byCount = new Map(prev.byCount);
  if (skips < prev.skips && adjustments === prev.adjustments) {
    if (!byCount.has(skips)) byCount.set(skips, fresh);
  } else {
    byCount.set(skips, fresh);
  }
  return { skips, adjustments, byCount };
}

/** The saved outfits the engine learns from in this state. */
export function learnedFrom(state: LearnState): readonly SavedOutfitSignal[] {
  return state.byCount.get(state.skips) ?? NONE;
}

/**
 * How long Today's first suggestion may wait for the saved list once everything else it needs (wardrobe, day, wear
 * history) is in. The first suggestion of the day is the one Roy sees most, so it should carry the saved bonus; but a
 * slow or failed list must not hold the screen: 1.5 s is about what the other reads already take on a phone, so the
 * wait is rarely felt, and past it the outfit is drawn without the list (taken in at the next skip or nudge).
 */
export const SAVED_LIST_GRACE_MS = 1500;

/** What Today's first generation does about the saved list. */
export type FirstGeneration = "wait" | "with" | "without";

/**
 * The first generation's decision. Pure: the time since the other inputs were ready comes in as data.
 *
 * - the other inputs are not ready: `wait` (the screen already waits for them);
 * - the list has answered: `with`;
 * - the list failed: `without`, at once (no retry is waited for; the bookmark says the list is unavailable);
 * - still loading: `wait` until `SAVED_LIST_GRACE_MS` has passed since the other inputs were ready, then `without`.
 *
 * The caller latches the first answer that is not `wait`: a list that arrives later never re-ranks the outfit shown.
 */
export function firstGeneration(args: { othersReady: boolean; saved: "loading" | "ready" | "error"; waitedMs: number }): FirstGeneration {
  if (!args.othersReady) return "wait";
  if (args.saved === "ready") return "with";
  if (args.saved === "error") return "without";
  return args.waitedMs >= SAVED_LIST_GRACE_MS ? "without" : "wait";
}

/**
 * How long Today's first suggestion may wait for the weather, counted from when the forecast request started (it runs
 * in parallel with the other reads, so the bound is not counted from when they arrived). A fresh forecast usually
 * answers in under a second; ten seconds of an empty screen (measured on the live site, 2026-11-20, when Open-Meteo
 * did not answer) is worse than a suggestion from a slightly older forecast, or from none, that says so.
 */
export const WEATHER_GRACE_MS = 2500;

/** Where the forecast request stands: answered (or a cache young enough to trust), still on its way, or given up. */
export type ForecastStatus = "fresh" | "loading" | "failed";

/** What Today's first generation uses for weather. */
export type FirstWeather = "wait" | "fresh" | "cached" | "without";

/**
 * The first generation's weather decision. Pure: the time since the forecast request started comes in as data.
 *
 * - the other inputs are not ready: `wait`;
 * - the forecast has answered: `fresh`;
 * - it failed: at once `cached` when an older forecast for the same place covers the day, else `without`;
 * - still loading: `wait` until `WEATHER_GRACE_MS` has passed since the request started, then `cached` or `without`.
 *
 * Never throws. The caller latches the first answer that is not `wait`; a forecast that arrives later updates the
 * weather line, never the outfit on screen.
 */
export function firstWeather(args: { othersReady: boolean; forecast: ForecastStatus; cached: boolean; waitedMs: number }): FirstWeather {
  if (!args.othersReady) return "wait";
  if (args.forecast === "fresh") return "fresh";
  if (args.forecast === "loading" && args.waitedMs < WEATHER_GRACE_MS) return "wait";
  return args.cached ? "cached" : "without";
}

/**
 * How long Today's first suggestion may wait for the Hebrew calendar, counted from when its request started (in
 * parallel with the forecast's, so the two bounds end together and never add up). The calendar decides the engine's
 * hard rules (Shabbat or holiday clothes, Yom Kippur's shoes) and the planned days; a suggestion made without it on a
 * holiday is a wrong suggestion, so it is waited for as long as the weather and no longer: past the bound the
 * suggestion is drawn by what the civil calendar knows, and a line says the calendar is missing. Hebcal answers in
 * about 0.4 s (measured 2026-11-20), and a stored answer (the ordinary morning) needs no wait at all.
 */
export const CALENDAR_GRACE_MS = 2500;

/** Where the calendar stands: known (stored or answered), its request still on its way, or given up with none. */
export type CalendarStatus = "known" | "loading" | "failed";

/** What Today's first generation knows of the calendar: the real one, only the civil calendar, or it does not matter. */
export type FirstCalendar = "wait" | "known" | "civil" | "unused";

/**
 * The first generation's calendar decision. Pure: the time since the calendar request started comes in as data.
 *
 * - the other inputs are not ready: `wait`;
 * - the observance switch is off: `unused` at once (the outfit is planned by the weekday rules whatever the day; only
 *   the Hebrew date line and a holiday's one "dressier" step depend on it, and neither is worth a wait);
 * - the calendar is known (a stored answer counts, even while its refresh is on its way): `known`;
 * - it failed: `civil` at once;
 * - still loading: `wait` until `CALENDAR_GRACE_MS` has passed since the request started, then `civil`.
 *
 * Never throws. The caller latches the first answer that is not `wait`; a calendar that arrives later updates the
 * lines and the tabs, never the outfit on screen (TodayView's conditions in force).
 */
export function firstCalendar(args: { othersReady: boolean; observes: boolean; calendar: CalendarStatus; waitedMs: number }): FirstCalendar {
  if (!args.othersReady) return "wait";
  if (!args.observes) return "unused";
  if (args.calendar === "known") return "known";
  if (args.calendar === "loading" && args.waitedMs < CALENDAR_GRACE_MS) return "wait";
  return "civil";
}

/** The three decisions of the first suggestion, or `wait` while any one still waits. */
export type FirstSuggestion =
  | "wait"
  | { saved: Exclude<FirstGeneration, "wait">; weather: Exclude<FirstWeather, "wait">; calendar: Exclude<FirstCalendar, "wait"> };

/**
 * Composes the three bounded waits of the first suggestion: the saved list (from when the other inputs were ready),
 * the weather (from when the forecast request started) and the calendar (from when its request started). Each is
 * measured from its own start and all run at once, so the first suggestion is drawn when the latest of them ends: the
 * waits never add up. Worst case, from opening: max(others ready + SAVED_LIST_GRACE_MS, forecast start +
 * WEATHER_GRACE_MS, calendar start + CALENDAR_GRACE_MS); the two requests start together, as soon as the location is
 * read. Pure; never throws.
 */
export function firstSuggestion(args: {
  othersReady: boolean;
  saved: "loading" | "ready" | "error";
  savedWaitedMs: number;
  forecast: ForecastStatus;
  cached: boolean;
  forecastWaitedMs: number;
  observes: boolean;
  calendar: CalendarStatus;
  calendarWaitedMs: number;
}): FirstSuggestion {
  const saved = firstGeneration({ othersReady: args.othersReady, saved: args.saved, waitedMs: args.savedWaitedMs });
  const weather = firstWeather({ othersReady: args.othersReady, forecast: args.forecast, cached: args.cached, waitedMs: args.forecastWaitedMs });
  const calendar = firstCalendar({ othersReady: args.othersReady, observes: args.observes, calendar: args.calendar, waitedMs: args.calendarWaitedMs });
  return saved === "wait" || weather === "wait" || calendar === "wait" ? "wait" : { saved, weather, calendar };
}

/**
 * The forecast each day's outfit is planned with, per tab (by date), and what has to change before a newer one is
 * taken in. Like the saved list (LearnState): a day's forecast is fixed when its outfit is first generated and replaced
 * only when the user asks for a different outfit on that day anyway, so a forecast that answers after the first paint
 * never re-ranks an outfit that has been shown. Switching tabs is not such a request: a tab keeps its outfit while the
 * screen is mounted, and a tab never shown takes the freshest forecast when it is first generated.
 */
export type WeatherInForce<W> = {
  skips: number;
  adjustments: unknown;
  /** Today's occasion type, or null. */
  occasion: string | null;
  /** Presses of "update the suggestion". */
  refresh: number;
  /** The forecast in force per date, at each skip count seen; the current one is `byCount.get(skips)`. */
  byCount: ReadonlyMap<number, ReadonlyMap<string, W>>;
};

/** What the screen shows now, against which the forecast in force is checked. */
export type WeatherTriggers = {
  skips: number;
  adjustments: unknown;
  occasion: string | null;
  refresh: number;
  /** The selected tab's date: the day a skip, a nudge or "update" acts on. */
  tab: string;
  /** Today's date: the day an occasion acts on. */
  today: string;
};

/** The state when Today opens: the shown tab's forecast is the live one. */
export function initialWeatherInForce<W>(now: WeatherTriggers, live: (date: string) => W): WeatherInForce<W> {
  return {
    skips: now.skips,
    adjustments: now.adjustments,
    occasion: now.occasion,
    refresh: now.refresh,
    byCount: new Map([[now.skips, new Map([[now.tab, live(now.tab)]])]]),
  };
}

/** The forecast a day is planned with: the one in force for it, else (never generated yet) the live one. */
export function weatherInForceFor<W>(state: WeatherInForce<W>, date: string, live: (date: string) => W): W {
  const map = state.byCount.get(state.skips);
  return map && map.has(date) ? (map.get(date) as W) : live(date);
}

/**
 * The forecast in force after a render. Returns `prev` itself when nothing changed, so the caller can compare by
 * identity. Pure; never throws.
 *
 * - a new skip or dislike, a nudge or "update the suggestion": the shown tab takes the live forecast;
 * - a different occasion: today takes the live forecast (an occasion belongs to today);
 * - fewer skips (an undo): the forecasts in force at that count come back, so undo shows the outfit it took away as it
 *   was planned; days first shown since keep theirs;
 * - a tab shown for the first time: it takes the live forecast; a tab already shown keeps its own.
 *
 * Nudges have no undo of their own: "reset" or the opposite tap is a new request and takes the live forecast.
 */
export function nextWeatherInForce<W>(prev: WeatherInForce<W>, now: WeatherTriggers, live: (date: string) => W): WeatherInForce<W> {
  const current = prev.byCount.get(prev.skips) ?? new Map<string, W>();
  const regenerate = now.skips > prev.skips || now.adjustments !== prev.adjustments || now.refresh !== prev.refresh;
  const occasionChanged = now.occasion !== prev.occasion;
  const undo = now.skips < prev.skips && !regenerate;
  if (!regenerate && !occasionChanged && !undo && current.has(now.tab)) return prev;
  let map: Map<string, W>;
  if (undo) {
    // What was in force at that count, plus any day first generated since (its outfit has been shown as it is).
    map = new Map(prev.byCount.get(now.skips) ?? current);
    for (const [date, w] of current) if (!map.has(date)) map.set(date, w);
  } else {
    map = new Map(current);
  }
  if (regenerate) map.set(now.tab, live(now.tab));
  if (occasionChanged) map.set(now.today, live(now.today));
  if (!map.has(now.tab)) map.set(now.tab, live(now.tab));
  const byCount = new Map(prev.byCount);
  byCount.set(now.skips, map);
  return { skips: now.skips, adjustments: now.adjustments, occasion: now.occasion, refresh: now.refresh, byCount };
}

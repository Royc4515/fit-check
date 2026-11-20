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

/** Both decisions of the first suggestion, or `wait` while either one still waits. */
export type FirstSuggestion = "wait" | { saved: Exclude<FirstGeneration, "wait">; weather: Exclude<FirstWeather, "wait"> };

/**
 * Composes the two bounded waits of the first suggestion: the saved list (from when the other inputs were ready) and
 * the weather (from when the forecast request started). Each is measured from its own start and both run at once, so
 * the first suggestion is drawn when the later of the two ends: the waits never add up. Worst case, from opening:
 * max(others ready + SAVED_LIST_GRACE_MS, forecast start + WEATHER_GRACE_MS). Pure; never throws.
 */
export function firstSuggestion(args: {
  othersReady: boolean;
  saved: "loading" | "ready" | "error";
  savedWaitedMs: number;
  forecast: ForecastStatus;
  cached: boolean;
  forecastWaitedMs: number;
}): FirstSuggestion {
  const saved = firstGeneration({ othersReady: args.othersReady, saved: args.saved, waitedMs: args.savedWaitedMs });
  const weather = firstWeather({ othersReady: args.othersReady, forecast: args.forecast, cached: args.cached, waitedMs: args.forecastWaitedMs });
  return saved === "wait" || weather === "wait" ? "wait" : { saved, weather };
}

/**
 * The forecast the outfit is planned with, and what has to change before a newer one is taken in. Like the saved list
 * (LearnState): fixed when the screen opens and replaced only when the user asks for a different outfit anyway, so a
 * forecast that answers after the first paint never re-ranks the outfit on screen.
 */
export type WeatherInForce<W> = {
  skips: number;
  adjustments: unknown;
  /** The selected day's tab (its date). */
  tab: string;
  /** Today's occasion type, or null. */
  occasion: string | null;
  /** Presses of "update the suggestion". */
  refresh: number;
  weather: W;
};

/** What the screen shows now, against which the forecast in force is checked. */
export type WeatherTriggers = Omit<WeatherInForce<unknown>, "weather">;

/**
 * The forecast in force after a render. Returns `prev` itself when nothing that regenerates the outfit happened, so the
 * caller can compare by identity. A new skip or dislike, a nudge, a tab change, a different occasion, or "update the
 * suggestion" takes in `live`; an undone skip does not (undo shows the outfit it took away, planned as it was).
 * Pure; never throws.
 */
export function nextWeatherInForce<W>(prev: WeatherInForce<W>, now: WeatherTriggers, live: W): WeatherInForce<W> {
  const changed =
    now.skips > prev.skips || now.adjustments !== prev.adjustments || now.tab !== prev.tab || now.occasion !== prev.occasion || now.refresh !== prev.refresh;
  if (changed) return { ...now, weather: live };
  // An undo moves the count back without taking anything in; remembered, so the next skip counts as new again.
  if (now.skips !== prev.skips) return { ...prev, skips: now.skips };
  return prev;
}

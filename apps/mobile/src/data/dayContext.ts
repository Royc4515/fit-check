import { summarizeDay, type DayWeather } from "@fit-check/engine";
import { HebcalConverterRangeSchema, HebcalItemsSchema, OpenMeteoHourlySchema, type OpenMeteoHourly } from "@fit-check/schema";
import { z } from "zod";
import { candleLightingMinutes } from "./candleLighting";
import {
  addDays,
  calendarAnswerUsable,
  CALENDAR_WINDOW_DAYS,
  calendarOn,
  civilCalendar,
  hebrewDateOn,
  hebrewDatesUsable,
  windowCovers,
  type CalendarWindow,
  type HebrewDateWindow,
} from "./calendarWindow";
import { cacheGetEntry, cacheSet } from "./kv";
import { CHAIN_MAX_DAYS, stripNiqqud, type PhoneFreeDay, type ShabbatTimes } from "./shabbatTimes";
import { placeNameFor, resolveLocation, type ResolvedLocation } from "./location";
import type { PlaceLang } from "./placeName";
import { localDate } from "./localDate";
import { dayTypeFor, isFestiveWeekday, NO_CALENDAR } from "./observance";

/**
 * What kind of day it is, from the real world: Israel-local date, Hebrew date and holidays from Hebcal, and the
 * forecast from Open-Meteo. Each source is independent and nullable, so one outage degrades one line of the
 * screen, not the outfit.
 *
 * Both APIs are free, keyless and CORS-open, so the app calls them directly (no secret, no AI: CLAUDE.md allows
 * it). The daily server job (PLAN.md phase B) will call the same URLs and cache them in the database.
 */

const HOUR = 3_600_000;

export type DayType = "weekday" | "shabbat" | "holiday";

/** A phone-free day after today's candle lighting, with what planning it needs (DESIGN.md "שלב 4.1" item 8). */
export type PlannedDay = PhoneFreeDay & {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** The context stored with a wear (`outfits.context_type`): Yom Kippur is a holiday there. */
  dayType: Exclude<DayType, "weekday">;
  /** Planned by the Yom Kippur rules (no leather shoes; PRD section 7). */
  yomKippur: boolean;
  /** That date's forecast; null is a real state ("no forecast yet": the forecast does not reach it, or failed). */
  weather: DayWeather | null;
};

export type DayContext = {
  /** yyyy-mm-dd in the chosen location's time zone (Israel by default), not the device's. */
  date: string;
  /** 0 = Sunday ... 6 = Saturday, in that time zone. */
  weekday: number;
  /**
   * City name for a chosen city, or the settlement name of "current location" when it could be found; null for the
   * default, and for a current location with no name (the screen labels those).
   */
  place: string | null;
  usesCurrentLocation: boolean;
  hebrewDate: { he: string; en: string } | null;
  weather: DayWeather | null;
  dayType: DayType;
  holiday: { he: string; en: string } | null;
  /** Candle lighting today ("shabbat" on a Friday, "other" for a holiday eve or night), else null. */
  candles: ShabbatTimes["candles"];
  /** The end of Shabbat or the holiday, only when it falls today or tomorrow (see shabbatTimes). */
  end: ShabbatTimes["end"];
  /** Today is Yom Kippur and the switch is on: planned by the Yom Kippur rules (PRD section 7). */
  yomKippur: boolean;
  /** A Yom Tov with the observance switch off: weekday rules, one "dressier" step by default (DESIGN.md 4.1 item 10). */
  festive: boolean;
  /** The location's time zone, for reading the local clock against `candles`. */
  tz: string;
  /** The phone-free days today's candle lighting opens, in order; [] on any day without candles. */
  chain: PlannedDay[];
  /** Where `weather` (and each planned day's) comes from, and whether a newer forecast is still on its way. */
  forecast: ForecastState;
  /**
   * Whether the Hebrew calendar behind `dayType`, `holiday`, `candles`, `end`, `yomKippur` and `chain` is known, and
   * whether its request is still on its way. Not known: those fields hold only what the civil calendar says
   * (calendarWindow.ts civilCalendar), never a guess about a holiday.
   */
  calendar: CalendarState;
  /** The observance switch the day was loaded with (DESIGN.md "שלב 4.1" item 10). */
  observes: boolean;
};

/**
 * The Hebrew calendar's state for the day: `known` when a Hebcal answer covering the date (stored or just received) is
 * in use; `pending` while the request has not settled (a stored answer is used meanwhile and is never called old: the
 * calendar of a date does not change); `startedAt` (epoch ms) is when the request started, from which Today's bounded
 * wait (CALENDAR_GRACE_MS) is counted.
 */
export type CalendarState = { known: boolean; pending: boolean; startedAt: number };

/**
 * What the day's weather is from: a forecast the cache trusts or the network just gave (`fresh`); an older one kept
 * for the same place because the network has not answered or failed (`cached`, `at` = when it was fetched, epoch ms);
 * or none that covers today (`none`, `weather` is null).
 */
export type ForecastSource = { kind: "fresh" } | { kind: "cached"; at: number } | { kind: "none" };

export type ForecastState = {
  source: ForecastSource;
  /** The network request has not settled yet; when it does, useDayContext delivers the day again. */
  pending: boolean;
  /** When the forecast request started (epoch ms): Today's bounded wait is counted from here, not from first paint. */
  startedAt: number;
};

export { israelDate, localDate, localTime } from "./localDate";

/** Cache keys include the place, so switching cities never shows the old city's weather. */
const placeKey = (loc: ResolvedLocation) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;

// Requests in flight, by URL. Today's data is loaded by every mounted screen that uses useDayContext and again on each
// reload (location or place-name change) before the first answer has reached the cache; without sharing, the same
// Hebcal or Open-Meteo URL went out twice per load. Dropped on settle, so a later load asks again.
const inFlight = new Map<string, Promise<unknown>>();

/** `timeoutMs`: the request is aborted after that long and the promise rejects; without it, the browser's own limit. */
async function getJson(url: string, timeoutMs?: number): Promise<unknown> {
  const shared = inFlight.get(url);
  if (shared) return shared;
  const request = (async () => {
    const abort = timeoutMs === undefined ? null : new AbortController();
    const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, abort ? { signal: abort.signal } : undefined);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  })().finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request;
}

/** A cached forecast younger than this is used as is, with no request (Open-Meteo updates its models hourly at most). */
const FORECAST_TRUSTED_MS = 3 * HOUR;
/** An older one is kept this long for when the network does not answer (the free tier rate-limits shared IPs). */
const FORECAST_KEPT_MS = 24 * HOUR;
/**
 * How long the forecast request may take before it is given up. Today no longer waits for it (WEATHER_GRACE_MS), so
 * this only bounds how long the weather line keeps an older forecast and how long a hung request is shared by later
 * loads. Open-Meteo answers in well under a second when it answers at all; 8 s leaves room for a cold phone connection
 * and is below the 10 s after which the browser itself gave up in the live measurement (2026-11-20).
 */
const FORECAST_TIMEOUT_MS = 8000;

type ForecastLoad = {
  startedAt: number;
  /** The newest stored forecast for the place, up to FORECAST_KEPT_MS old, with when it was fetched. */
  stored: Promise<{ forecast: OpenMeteoHourly; at: number } | null>;
  /** The forecast to trust: the stored one if young enough, else the network's; null when the network failed. */
  fresh: Promise<OpenMeteoHourly | null>;
};

// One load per place while it is in flight, so a reload (place name, observance switch) before the forecast answered
// shares the request AND its start time: the bounded wait is never restarted by a reload.
const forecastLoads = new Map<string, ForecastLoad>();

/**
 * Starts loading the hourly forecast for today and the next CHAIN_MAX_DAYS days. Always that many days, whatever
 * today's chain is, so the forecast loads in parallel with the calendar instead of after it (the chain is never
 * longer). Never rejects: a failure is a null `fresh`.
 */
function startForecast(loc: ResolvedLocation): ForecastLoad {
  // v3: four days instead of two (v2 entries would leave the planned days without a forecast).
  const key = `fitcheck:forecast:v3:${placeKey(loc)}`;
  const running = forecastLoads.get(key);
  if (running) return running;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    "&hourly=apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code" +
    `&timezone=${encodeURIComponent(loc.tz)}&forecast_days=${1 + CHAIN_MAX_DAYS}`;
  const startedAt = Date.now();
  const stored = cacheGetEntry<unknown>(key, FORECAST_KEPT_MS).then((entry) => {
    const parsed = OpenMeteoHourlySchema.safeParse(entry?.value);
    return entry && parsed.success ? { forecast: parsed.data, at: entry.at } : null;
  });
  const fresh = stored
    .then(async (entry) => {
      if (entry && Date.now() - entry.at <= FORECAST_TRUSTED_MS) return entry.forecast;
      const forecast = OpenMeteoHourlySchema.parse(await getJson(url, FORECAST_TIMEOUT_MS));
      await cacheSet(key, forecast);
      return forecast;
    })
    .catch((error: unknown) => {
      console.warn("Weather unavailable", error);
      return null;
    })
    .finally(() => forecastLoads.delete(key));
  const load = { startedAt, stored, fresh };
  forecastLoads.set(key, load);
  return load;
}

type WeatherPart = Pick<DayContext, "weather" | "chain" | "forecast">;

/**
 * Today's and each planned day's weather from a forecast, and what to call its source. A forecast that does not cover
 * today gives no weather and the source `none`, whatever it was.
 */
function weatherFrom(
  forecast: OpenMeteoHourly | null,
  source: Exclude<ForecastSource, { kind: "none" }>,
  base: { date: string; chain: PlannedDay[]; startedAt: number; pending: boolean }
): WeatherPart {
  const weather = forecast ? summarizeDay(forecast, base.date) : null;
  return {
    weather,
    chain: base.chain.map((d) => ({ ...d, weather: forecast ? summarizeDay(forecast, d.date) : null })),
    forecast: { source: weather ? source : { kind: "none" }, pending: base.pending, startedAt: base.startedAt },
  };
}

/** A stored calendar or Hebrew-date window is kept this long at most (its facts do not age; its window runs out). */
const WINDOW_KEPT_MS = 90 * 24 * HOUR;
/**
 * A stored window younger than this is the answer itself, with no request. Older, it is still used at once (a date's
 * Hebrew calendar does not change) and renewed in the background, which also moves the window forward. Twelve hours:
 * at most two background requests a day per service, and a Hebcal correction reaches the device within a day.
 */
const WINDOW_TRUSTED_MS = 12 * HOUR;
/**
 * How long a Hebcal request may take before it is given up, as the forecast's (FORECAST_TIMEOUT_MS): Today never
 * waits for it longer than CALENDAR_GRACE_MS (features/today/learning.ts), so this only bounds how long a hung request
 * is shared by later loads and how late its answer can still update the lines. Hebcal answers a 60-day window in about
 * 0.4 s when it answers at all (measured 2026-11-20).
 */
const CALENDAR_TIMEOUT_MS = 8000;

type WindowLoad<T> = {
  startedAt: number;
  /** The stored window when it covers the date (and its planned days), with when it was fetched. */
  stored: Promise<{ value: T; at: number } | null>;
  /** The network's answer, or the stored window itself when young enough; null when the request failed. */
  fresh: Promise<T | null>;
};

// One load per stored key and date while it is in flight, as forecastLoads: a reload shares the request and its start.
const windowLoads = new Map<string, WindowLoad<{ start: string; end: string }>>();

/**
 * Starts loading a window of Hebcal answers for `date`: the stored one at once (if it covers the date), and the
 * network's in parallel unless the stored one is young enough. Never rejects: a failed request is a null `fresh`, a
 * missing or malformed stored window a null `stored`.
 */
function startWindow<T extends { start: string; end: string }>(args: {
  key: string;
  date: string;
  /** The stored value, validated; null when it is not one. */
  read: (raw: unknown) => T | null;
  request: () => Promise<T>;
  label: string;
}): WindowLoad<T> {
  const id = `${args.key}|${args.date}`;
  const running = windowLoads.get(id);
  // don't touch / the map holds loads of every window type; the id carries the key, and one key is always read and
  // requested by the same caller with the same T, so a running load under it is a WindowLoad<T>.
  if (running) return running as WindowLoad<T>;
  const startedAt = Date.now();
  const stored = cacheGetEntry<unknown>(args.key, WINDOW_KEPT_MS).then((entry) => {
    const value = entry ? args.read(entry.value) : null;
    return entry && value && windowCovers(value, args.date) ? { value, at: entry.at } : null;
  });
  const fresh = stored
    .then(async (entry) => {
      if (entry && Date.now() - entry.at <= WINDOW_TRUSTED_MS) return entry.value;
      const value = await args.request();
      await cacheSet(args.key, value);
      return value;
    })
    .catch((error: unknown) => {
      console.warn(`${args.label} unavailable`, error);
      return null;
    })
    .finally(() => windowLoads.delete(id));
  const load: WindowLoad<T> = { startedAt, stored, fresh };
  windowLoads.set(id, load);
  return load;
}

const StoredCalendarSchema = z.object({ start: z.string(), end: z.string(), items: HebcalItemsSchema.shape.items });
const StoredHebrewDatesSchema = z.object({
  start: z.string(),
  end: z.string(),
  dates: z.record(z.string(), z.object({ he: z.string(), en: z.string() })),
});

/** Hebcal's events (holidays, candle lighting, havdalah) for the place, `date` to CALENDAR_WINDOW_DAYS on. */
function startCalendar(date: string, loc: ResolvedLocation): WindowLoad<CalendarWindow> {
  // Coordinates carry the candle minutes in the key: the minutes depend on the point (city boundary). v7: one window
  // per place instead of one entry per date (v6: before Yom Kippur was told apart; v5: before the chain of planned
  // days; v4: before the end-of-Shabbat fields; v3: Hebcal's coordinate default).
  const minutes = loc.geonameid ? null : candleLightingMinutes(loc);
  const key = `fitcheck:hebcal:v7:${loc.geonameid ?? `${placeKey(loc)}:b${minutes}`}`;
  return startWindow<CalendarWindow>({
    key,
    date,
    label: "Hebcal",
    read: (raw) => {
      const parsed = StoredCalendarSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    request: async () => {
      // A GeoNames id gets the city's own custom from Hebcal (Jerusalem 40, Haifa 30). Coordinates get no city custom
      // (20 in Israel, 18 abroad), so the app sends the local custom itself as b= (PRD.md, candle lighting).
      const where = loc.geonameid
        ? `geonameid=${loc.geonameid}`
        : `latitude=${loc.lat}&longitude=${loc.lon}&tzid=${encodeURIComponent(loc.tz)}&b=${minutes}`;
      // i=on is the Israel holiday schedule; it is correct only inside Israel (one day of Yom Tov, not two).
      const israel = loc.tz === "Asia/Jerusalem" ? "&i=on" : "";
      const end = addDays(date, CALENDAR_WINDOW_DAYS).iso;
      const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on${israel}&c=on&M=on&${where}&start=${date}&end=${end}&lg=he`;
      const { items } = HebcalItemsSchema.parse(await getJson(url, CALENDAR_TIMEOUT_MS));
      // don't touch / a 200 with no candle lighting in 60 days is not a calendar (an empty or cut answer): failing it
      // keeps the warning line and stores nothing, instead of two months of days with no Shabbat and no holiday.
      if (!calendarAnswerUsable(items, date, end)) throw new Error("Hebcal answered with no candle lighting in the window");
      return { start: date, end, items };
    },
  });
}

/** Hebcal's Hebrew date for each civil date from `date` on (the same for every place: the line shows the day's date). */
function startHebrewDates(date: string): WindowLoad<HebrewDateWindow> {
  return startWindow<HebrewDateWindow>({
    key: "fitcheck:hdates:v1",
    date,
    label: "Hebrew date",
    read: (raw) => {
      const parsed = StoredHebrewDatesSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    request: async () => {
      const end = addDays(date, CALENDAR_WINDOW_DAYS).iso;
      const r = HebcalConverterRangeSchema.parse(
        await getJson(`https://www.hebcal.com/converter?cfg=json&start=${date}&end=${end}&g2h=1`, CALENDAR_TIMEOUT_MS)
      );
      const dates: HebrewDateWindow["dates"] = {};
      for (const [iso, d] of Object.entries(r.hdates)) dates[iso] = { he: stripNiqqud(d.hebrew), en: `${d.hd} ${d.hm} ${d.hy}` };
      if (!hebrewDatesUsable(dates, date)) throw new Error("Hebcal converter answered without the date asked for");
      // The converter caps a range (180 days today): the window is what it answered, not what was asked.
      return { start: r.start, end: r.end, dates };
    },
  });
}

/**
 * Loads today's context for the saved location; never throws, never rejects. `lang` is the app language, used only for
 * the place name of "my current location" (Nominatim answers in it). `observesShabbat` is the profile switch (DESIGN.md
 * "שלב 4.1" item 10): off, the Hebcal calendar is still asked, but only its Yom Tov flag and holiday name are used (a
 * holiday is a little dressier, `festive`); there are no times and no planned days, and the engine plans Shabbat and
 * holidays by the weekday rules.
 *
 * The day never waits for an outside service (DESIGN.md "היום" item 1): the first day is built from what the device
 * holds (the location, the stored forecast, the stored calendar and Hebrew dates) while the requests to Open-Meteo and
 * Hebcal run in parallel. Each settles once, and `onUpdate` then receives the whole day again: the forecast
 * (`forecast.pending`), the calendar (`calendar.known`, `calendar.pending`), the Hebrew date. `onUpdate` receives the
 * first day too, before any later one, so a caller that listens only there sees the days in order.
 *
 * Failure modes: a source that fails leaves its part as the device had it (stored, or none); nothing throws.
 */
export async function loadDayContext(
  now: Date = new Date(),
  lang: PlaceLang = "he",
  observesShabbat = true,
  onUpdate?: (ctx: DayContext) => void
): Promise<DayContext> {
  const loc = await resolveLocation();
  const { date, weekday } = localDate(loc.tz, now);
  // Started now, in parallel with the loads below, never before them.
  const namePromise = loc.kind === "current" ? placeNameFor(loc, lang) : Promise.resolve(null);
  const forecastLoad = startForecast(loc);
  const calendarLoad = startCalendar(date, loc);
  const hebrewLoad = startHebrewDates(date);
  // What has settled so far, read when a day is built. Filled by the callbacks below, in whatever order they come.
  const settled: {
    forecast: { value: OpenMeteoHourly | null } | null;
    calendar: { value: CalendarWindow | null } | null;
    hebrew: { value: HebrewDateWindow | null } | null;
  } = { forecast: null, calendar: null, hebrew: null };
  // Set once the first day is built: a source that settles before that is simply part of the first day.
  let started = false;
  const emit = () => {
    if (started && onUpdate) onUpdate(build());
  };
  void forecastLoad.fresh.then((value) => {
    settled.forecast = { value };
    emit();
  });
  void calendarLoad.fresh.then((value) => {
    settled.calendar = { value };
    emit();
  });
  void hebrewLoad.fresh.then((value) => {
    settled.hebrew = { value };
    emit();
  });
  const [stored, storedCalendar, storedHebrew] = await Promise.all([forecastLoad.stored, calendarLoad.stored, hebrewLoad.stored]);
  // don't touch / the name is NOT in the Promise.all: a slow or blocked geocoder (3 s cap) must not hold back the
  // day. We take it only if it has already settled; otherwise the screen says "current location" now, and
  // useDayContext reloads when the lookup stores its result (onPlaceNameChange). The already-resolved null is second
  // in the race, so a settled name wins the tie.
  const placeName = await Promise.race([namePromise, Promise.resolve(null)]);
  const young = (at: number, trustedMs: number) => Date.now() - at <= trustedMs;

  function build(): DayContext {
    // The calendar: the network's answer once it came, else the stored window (also when the request failed).
    const window = settled.calendar?.value ?? storedCalendar?.value ?? null;
    const calendar: CalendarState = {
      known: window !== null,
      // A stored window young enough to trust is the answer itself (startWindow makes no request for it).
      pending: settled.calendar === null && !(storedCalendar && young(storedCalendar.at, WINDOW_TRUSTED_MS)),
      startedAt: calendarLoad.startedAt,
    };
    // Without it, only the civil calendar: a Friday plans Saturday as Shabbat, nothing else (calendarWindow.ts).
    const fields = window ? calendarOn(window.items, date) : civilCalendar(date, weekday, observesShabbat);
    // Off: only the holiday itself survives; nothing Shabbat-specific (times, planned days) reaches the screen.
    const cal = observesShabbat ? fields : { ...NO_CALENDAR, holiday: fields.holiday, yomtov: fields.yomtov };
    const hebrewWindow = settled.hebrew?.value ?? storedHebrew?.value ?? null;
    const chainBase: PlannedDay[] = cal.chain.map((d) => ({
      ...d,
      weekday: addDays(d.date, 0).weekday,
      dayType: d.kind === "shabbat" ? ("shabbat" as const) : ("holiday" as const),
      yomKippur: d.kind === "yom_kippur",
      weather: null,
    }));
    const at = (pending: boolean) => ({ date, chain: chainBase, startedAt: forecastLoad.startedAt, pending });
    /** The weather once the request has settled: its answer, else the stored forecast, else none. */
    const afterSettle = (forecast: OpenMeteoHourly | null): WeatherPart =>
      forecast
        ? weatherFrom(forecast, { kind: "fresh" }, at(false))
        : stored
          ? weatherFrom(stored.forecast, { kind: "cached", at: stored.at }, at(false))
          : weatherFrom(null, { kind: "fresh" }, at(false));
    // A stored forecast young enough to trust is the answer itself (startForecast makes no request for it); taken here
    // so that a few microtasks of ordering never present it as an older forecast still waiting for the network.
    const done = settled.forecast ?? (stored && young(stored.at, FORECAST_TRUSTED_MS) ? { value: stored.forecast } : null);
    const weatherPart: WeatherPart = done
      ? afterSettle(done.value)
      : stored
        ? weatherFrom(stored.forecast, { kind: "cached", at: stored.at }, at(true))
        : weatherFrom(null, { kind: "fresh" }, at(true));
    return {
      date,
      weekday,
      place: loc.label ?? placeName,
      usesCurrentLocation: loc.geonameid === null,
      hebrewDate: hebrewWindow ? hebrewDateOn(hebrewWindow, date) : null,
      dayType: dayTypeFor(weekday, cal.yomtov, observesShabbat),
      holiday: cal.holiday,
      candles: cal.candles,
      end: cal.end,
      festive: isFestiveWeekday(cal.yomtov, observesShabbat),
      yomKippur: observesShabbat && cal.yomKippur,
      tz: loc.tz,
      observes: observesShabbat,
      calendar,
      ...weatherPart,
    };
  }

  started = true;
  const first = build();
  onUpdate?.(first);
  return first;
}

const reloadListeners = new Set<() => void>();

/** Asks every mounted useDayContext to load the day again (Today's "try again" on the calendar line). */
export function reloadDayContext(): void {
  for (const listener of reloadListeners) listener();
}

/** Subscribes to reloadDayContext; returns the unsubscribe. */
export function onDayContextReload(listener: () => void): () => void {
  reloadListeners.add(listener);
  return () => {
    reloadListeners.delete(listener);
  };
}

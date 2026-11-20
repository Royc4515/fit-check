import { summarizeDay, type DayWeather } from "@fit-check/engine";
import { HebcalConverterSchema, HebcalItemsSchema, OpenMeteoHourlySchema, type OpenMeteoHourly } from "@fit-check/schema";
import { candleLightingMinutes } from "./candleLighting";
import { cacheGet, cacheGetEntry, cacheSet } from "./kv";
import { CHAIN_MAX_DAYS, isYomKippur, phoneFreeChain, shabbatTimes, stripNiqqud, type PhoneFreeDay, type ShabbatTimes } from "./shabbatTimes";
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
};

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

/** `YYYY-MM-DD` plus `days`, and that date's weekday, in UTC so no device time zone is involved. */
function addDays(date: string, days: number): { iso: string; weekday: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { iso: t.toISOString().slice(0, 10), weekday: t.getUTCDay() };
}

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

async function loadHebrewDate(date: string): Promise<DayContext["hebrewDate"]> {
  const key = `fitcheck:hdate:${date}`;
  const cached = await cacheGet<DayContext["hebrewDate"]>(key, 48 * HOUR);
  if (cached) return cached;
  try {
    const d = HebcalConverterSchema.parse(await getJson(`https://www.hebcal.com/converter?cfg=json&date=${date}&g2h=1&strict=1`));
    const value = { he: stripNiqqud(d.hebrew), en: `${d.hd} ${d.hm} ${d.hy}` };
    await cacheSet(key, value);
    return value;
  } catch (error) {
    console.warn("Hebrew date unavailable", error);
    return null;
  }
}

type Calendar = Pick<DayContext, "holiday" | "candles" | "end"> & { yomtov: boolean; yomKippur: boolean; chain: PhoneFreeDay[] };

async function loadCalendar(date: string, loc: ResolvedLocation): Promise<Calendar> {
  // Coordinates carry the candle minutes in the key: the minutes depend on the point (city boundary). v6 drops the
  // entries from before Yom Kippur was told apart (v5: before the chain of planned days; v4: before the end-of-Shabbat
  // fields; v3: Hebcal's coordinate default).
  const minutes = loc.geonameid ? null : candleLightingMinutes(loc);
  const key = `fitcheck:hebcal:v6:${date}:${loc.geonameid ?? `${placeKey(loc)}:b${minutes}`}`;
  const cached = await cacheGet<Calendar>(key, 24 * HOUR);
  if (cached) return cached;
  try {
    // A GeoNames id gets the city's own custom from Hebcal (Jerusalem 40, Haifa 30). Coordinates get no city custom
    // (20 in Israel, 18 abroad), so the app sends the local custom itself as b= (PRD.md, candle lighting).
    const where = loc.geonameid
      ? `geonameid=${loc.geonameid}`
      : `latitude=${loc.lat}&longitude=${loc.lon}&tzid=${encodeURIComponent(loc.tz)}&b=${minutes}`;
    // i=on is the Israel holiday schedule; it is correct only inside Israel (one day of Yom Tov, not two).
    const israel = loc.tz === "Asia/Jerusalem" ? "&i=on" : "";
    // end=date+3: the longest chain of phone-free days ends with a havdalah three days on (CHAIN_MAX_DAYS); the
    // times row reads only today and tomorrow out of the same response.
    const last = addDays(date, CHAIN_MAX_DAYS).iso;
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on${israel}&c=on&M=on&${where}&start=${date}&end=${last}&lg=he`;
    const { items } = HebcalItemsSchema.parse(await getJson(url));
    const times = shabbatTimes(items, date);
    const value: Calendar = {
      // Detect Yom Tov from the `yomtov` flag, never from the title (Hebcal docs). Only today's events count, so
      // tomorrow's holiday (now in the response) can never change today's day type.
      yomtov: times.yomtov,
      holiday: times.holiday ? { he: stripNiqqud(times.holiday.hebrew ?? times.holiday.title), en: times.holiday.title_orig ?? times.holiday.title } : null,
      candles: times.candles,
      end: times.end,
      yomKippur: times.holiday !== null && isYomKippur(times.holiday),
      chain: phoneFreeChain(items, date),
    };
    await cacheSet(key, value);
    return value;
  } catch (error) {
    console.warn("Hebcal unavailable", error);
    return NO_CALENDAR;
  }
}

/**
 * Loads today's context for the saved location; never throws. `lang` is the app language, used only for the place
 * name of "my current location" (Nominatim answers in it). `observesShabbat` is the profile switch (DESIGN.md
 * "שלב 4.1" item 10): off, the Hebcal calendar is still asked, but only its Yom Tov flag and holiday name are used (a
 * holiday is a little dressier, `festive`); there are no times and no planned days, and the engine plans Shabbat and
 * holidays by the weekday rules.
 *
 * The day resolves without waiting for the forecast's network request (Open-Meteo has gone ten seconds without
 * answering): with the forecast if it has already settled, else with the stored one for the place (source `cached`)
 * or none, `forecast.pending` set; `onForecast` then receives the whole day again once the request settles. Never
 * rejects; `onForecast` is called at most once, and only when `pending` was true.
 */
export async function loadDayContext(
  now: Date = new Date(),
  lang: PlaceLang = "he",
  observesShabbat = true,
  onForecast?: (ctx: DayContext) => void
): Promise<DayContext> {
  const loc = await resolveLocation();
  const { date, weekday } = localDate(loc.tz, now);
  // Started now, in parallel with the three loads below, never before them.
  const namePromise = loc.kind === "current" ? placeNameFor(loc, lang) : Promise.resolve(null);
  const forecastLoad = startForecast(loc);
  // Read synchronously after the calendar is in: has the request already settled?
  let settled: { forecast: OpenMeteoHourly | null } | null = null;
  void forecastLoad.fresh.then((forecast) => {
    settled = { forecast };
  });
  const [stored, hebrewDate, loaded] = await Promise.all([forecastLoad.stored, loadHebrewDate(date), loadCalendar(date, loc)]);
  // Off: only the holiday itself survives; nothing Shabbat-specific (times, planned days) reaches the screen.
  const cal = observesShabbat ? loaded : { ...NO_CALENDAR, holiday: loaded.holiday, yomtov: loaded.yomtov };
  // don't touch / the name is NOT in the Promise.all: a slow or blocked geocoder (3 s cap) must not hold back the
  // weather, the date or the Shabbat times. We take it only if it has already settled; otherwise the screen says
  // "current location" now, and useDayContext reloads when the lookup stores its result (onPlaceNameChange).
  // The already-resolved null is second in the race, so a settled name wins the tie. Awaited before the forecast's
  // state is read below, so nothing is awaited between that read and the return.
  const placeName = await Promise.race([namePromise, Promise.resolve(null)]);
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
  // don't touch / read through a function: TypeScript narrows the `let` to null at this point and would not see the
  // assignment made in the callback above.
  const settledNow = (): { forecast: OpenMeteoHourly | null } | null => settled;
  // A stored forecast young enough to trust is the answer itself (startForecast makes no request for it); taken here
  // so that a few microtasks of ordering never present it as an older forecast still waiting for the network.
  const done = settledNow() ?? (stored && Date.now() - stored.at <= FORECAST_TRUSTED_MS ? { forecast: stored.forecast } : null);
  const weatherPart: WeatherPart = done
    ? afterSettle(done.forecast)
    : stored
      ? weatherFrom(stored.forecast, { kind: "cached", at: stored.at }, at(true))
      : weatherFrom(null, { kind: "fresh" }, at(true));
  const dayType: DayType = dayTypeFor(weekday, cal.yomtov, observesShabbat);
  const ctx: DayContext = {
    date,
    weekday,
    place: loc.label ?? placeName,
    usesCurrentLocation: loc.geonameid === null,
    hebrewDate,
    dayType,
    holiday: cal.holiday,
    candles: cal.candles,
    end: cal.end,
    festive: isFestiveWeekday(cal.yomtov, observesShabbat),
    yomKippur: observesShabbat && cal.yomKippur,
    tz: loc.tz,
    ...weatherPart,
  };
  if (!done && onForecast) void forecastLoad.fresh.then((forecast) => onForecast({ ...ctx, ...afterSettle(forecast) }));
  return ctx;
}

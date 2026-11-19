import { summarizeDay, type DayWeather } from "@fit-check/engine";
import { HebcalConverterSchema, HebcalItemsSchema, OpenMeteoHourlySchema, type OpenMeteoHourly } from "@fit-check/schema";
import { candleLightingMinutes } from "./candleLighting";
import { cacheGet, cacheSet } from "./kv";
import { CHAIN_MAX_DAYS, phoneFreeChain, shabbatTimes, stripNiqqud, type PhoneFreeDay, type ShabbatTimes } from "./shabbatTimes";
import { placeNameFor, resolveLocation, type ResolvedLocation } from "./location";
import type { PlaceLang } from "./placeName";
import { localDate } from "./localDate";
import { dayTypeFor, NO_CALENDAR } from "./observance";

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
  /** The engine context: the day's own kind. */
  dayType: Exclude<DayType, "weekday">;
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
  /** The location's time zone, for reading the local clock against `candles`. */
  tz: string;
  /** The phone-free days today's candle lighting opens, in order; [] on any day without candles. */
  chain: PlannedDay[];
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

async function getJson(url: string): Promise<unknown> {
  const shared = inFlight.get(url);
  if (shared) return shared;
  const request = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  })().finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request;
}

/**
 * The hourly forecast for today and the next CHAIN_MAX_DAYS days, or null. Always that many days, whatever today's
 * chain is, so the forecast loads in parallel with the calendar instead of after it (the chain is never longer).
 */
async function loadForecast(loc: ResolvedLocation): Promise<OpenMeteoHourly | null> {
  // v3: four days instead of two (v2 entries would leave the planned days without a forecast).
  const key = `fitcheck:forecast:v3:${placeKey(loc)}`;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    "&hourly=apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code" +
    `&timezone=${encodeURIComponent(loc.tz)}&forecast_days=${1 + CHAIN_MAX_DAYS}`;
  const fresh = await cacheGet<unknown>(key, 3 * HOUR);
  try {
    const forecast = OpenMeteoHourlySchema.parse(fresh ?? (await getJson(url)));
    if (!fresh) await cacheSet(key, forecast);
    return forecast;
  } catch (error) {
    console.warn("Weather unavailable", error);
    // A forecast up to a day old is still better than none (the free tier rate-limits shared IPs).
    const stale = await cacheGet<unknown>(key, 24 * HOUR);
    const parsed = OpenMeteoHourlySchema.safeParse(stale);
    return parsed.success ? parsed.data : null;
  }
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

type Calendar = Pick<DayContext, "holiday" | "candles" | "end"> & { yomtov: boolean; chain: PhoneFreeDay[] };

async function loadCalendar(date: string, loc: ResolvedLocation): Promise<Calendar> {
  // Coordinates carry the candle minutes in the key: the minutes depend on the point (city boundary), and v4 drops the
  // entries from before the chain of planned days (v4: before the end-of-Shabbat fields; v3: Hebcal's coordinate
  // default).
  const minutes = loc.geonameid ? null : candleLightingMinutes(loc);
  const key = `fitcheck:hebcal:v5:${date}:${loc.geonameid ?? `${placeKey(loc)}:b${minutes}`}`;
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
 * "שלב 4.1" item 10): off, the Hebcal calendar is not asked at all (the Hebrew date still is), there are no times and
 * no planned days, and Shabbat and holidays are weekdays for the engine.
 */
export async function loadDayContext(now: Date = new Date(), lang: PlaceLang = "he", observesShabbat = true): Promise<DayContext> {
  const loc = await resolveLocation();
  const { date, weekday } = localDate(loc.tz, now);
  // Started now, in parallel with the three loads below, never before them.
  const namePromise = loc.kind === "current" ? placeNameFor(loc, lang) : Promise.resolve(null);
  const [forecast, hebrewDate, cal] = await Promise.all([
    loadForecast(loc),
    loadHebrewDate(date),
    observesShabbat ? loadCalendar(date, loc) : Promise.resolve(NO_CALENDAR),
  ]);
  const weather = forecast ? summarizeDay(forecast, date) : null;
  // don't touch / the name is NOT in the Promise.all: a slow or blocked geocoder (3 s cap) must not hold back the
  // weather, the date or the Shabbat times. We take it only if it has already settled; otherwise the screen says
  // "current location" now, and useDayContext reloads when the lookup stores its result (onPlaceNameChange).
  // The already-resolved null is second in the race, so a settled name wins the tie.
  const placeName = await Promise.race([namePromise, Promise.resolve(null)]);
  const dayType: DayType = dayTypeFor(weekday, cal.yomtov, observesShabbat);
  return {
    date,
    weekday,
    place: loc.label ?? placeName,
    usesCurrentLocation: loc.geonameid === null,
    hebrewDate,
    weather,
    dayType,
    holiday: cal.holiday,
    candles: cal.candles,
    end: cal.end,
    tz: loc.tz,
    chain: cal.chain.map((d) => ({
      ...d,
      weekday: addDays(d.date, 0).weekday,
      dayType: d.kind,
      weather: forecast ? summarizeDay(forecast, d.date) : null,
    })),
  };
}

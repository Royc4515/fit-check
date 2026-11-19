import { summarizeDay, type DayWeather } from "@fit-check/engine";
import { HebcalConverterSchema, HebcalItemsSchema, OpenMeteoHourlySchema } from "@fit-check/schema";
import { candleLightingMinutes } from "./candleLighting";
import { cacheGet, cacheSet } from "./kv";
import { resolveLocation, type ResolvedLocation } from "./location";

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

export type DayContext = {
  /** yyyy-mm-dd in the chosen location's time zone (Israel by default), not the device's. */
  date: string;
  /** 0 = Sunday ... 6 = Saturday, in that time zone. */
  weekday: number;
  /** City name for a chosen city; null for the default or "current location" (the screen labels those). */
  place: string | null;
  usesCurrentLocation: boolean;
  hebrewDate: { he: string; en: string } | null;
  weather: DayWeather | null;
  dayType: DayType;
  holiday: { he: string; en: string } | null;
  /** "HH:MM" when candles are lit today (Friday or a holiday eve), else null. */
  candleLighting: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The local date and weekday in `tz` (en-CA formats as yyyy-mm-dd). */
export function localDate(tz: string, now: Date = new Date()): { date: string; weekday: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now));
  return { date, weekday };
}

export function israelDate(now: Date = new Date()): { date: string; weekday: number } {
  return localDate("Asia/Jerusalem", now);
}

/** Cache keys include the place, so switching cities never shows the old city's weather. */
const placeKey = (loc: ResolvedLocation) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;

/** Hebcal returns pointed Hebrew (niqqud); the editorial dateline reads cleaner without it. */
function stripNiqqud(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function loadWeather(date: string, loc: ResolvedLocation): Promise<DayWeather | null> {
  const key = `fitcheck:forecast:v2:${placeKey(loc)}`;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    "&hourly=apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code" +
    `&timezone=${encodeURIComponent(loc.tz)}&forecast_days=2`;
  const fresh = await cacheGet<unknown>(key, 3 * HOUR);
  try {
    const forecast = OpenMeteoHourlySchema.parse(fresh ?? (await getJson(url)));
    if (!fresh) await cacheSet(key, forecast);
    return summarizeDay(forecast, date);
  } catch (error) {
    console.warn("Weather unavailable", error);
    // A forecast up to a day old is still better than none (the free tier rate-limits shared IPs).
    const stale = await cacheGet<unknown>(key, 24 * HOUR);
    const parsed = OpenMeteoHourlySchema.safeParse(stale);
    return parsed.success ? summarizeDay(parsed.data, date) : null;
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

async function loadCalendar(date: string, loc: ResolvedLocation): Promise<Pick<DayContext, "holiday" | "candleLighting"> & { yomtov: boolean }> {
  // Coordinates carry the candle minutes in the key: the minutes depend on the point (city boundary), and v3 drops the
  // v2 entries that were computed with Hebcal's coordinate default instead of the local custom.
  const minutes = loc.geonameid ? null : candleLightingMinutes(loc);
  const key = `fitcheck:hebcal:v3:${date}:${loc.geonameid ?? `${placeKey(loc)}:b${minutes}`}`;
  type Cal = { holiday: DayContext["holiday"]; candleLighting: string | null; yomtov: boolean };
  const cached = await cacheGet<Cal>(key, 24 * HOUR);
  if (cached) return cached;
  try {
    // A GeoNames id gets the city's own custom from Hebcal (Jerusalem 40, Haifa 30). Coordinates get no city custom
    // (20 in Israel, 18 abroad), so the app sends the local custom itself as b= (PRD.md, candle lighting).
    const where = loc.geonameid
      ? `geonameid=${loc.geonameid}`
      : `latitude=${loc.lat}&longitude=${loc.lon}&tzid=${encodeURIComponent(loc.tz)}&b=${minutes}`;
    // i=on is the Israel holiday schedule; it is correct only inside Israel (one day of Yom Tov, not two).
    const israel = loc.tz === "Asia/Jerusalem" ? "&i=on" : "";
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on${israel}&c=on&M=on&${where}&start=${date}&end=${date}&lg=he`;
    const { items } = HebcalItemsSchema.parse(await getJson(url));
    const yomtovItem = items.find((i) => i.yomtov === true);
    const majorItem = yomtovItem ?? items.find((i) => i.category === "holiday");
    const candles = items.find((i) => i.category === "candles");
    const value: Cal = {
      // Detect Yom Tov from the `yomtov` flag, never from the title (Hebcal docs).
      yomtov: yomtovItem !== undefined,
      holiday: majorItem ? { he: stripNiqqud(majorItem.hebrew ?? majorItem.title), en: majorItem.title_orig ?? majorItem.title } : null,
      candleLighting: candles ? candles.date.slice(11, 16) : null,
    };
    await cacheSet(key, value);
    return value;
  } catch (error) {
    console.warn("Hebcal unavailable", error);
    return { holiday: null, candleLighting: null, yomtov: false };
  }
}

/** Loads today's context for the saved location; never throws. */
export async function loadDayContext(now: Date = new Date()): Promise<DayContext> {
  const loc = await resolveLocation();
  const { date, weekday } = localDate(loc.tz, now);
  const [weather, hebrewDate, cal] = await Promise.all([loadWeather(date, loc), loadHebrewDate(date), loadCalendar(date, loc)]);
  const dayType: DayType = cal.yomtov ? "holiday" : weekday === 6 ? "shabbat" : "weekday";
  return {
    date,
    weekday,
    place: loc.label,
    usesCurrentLocation: loc.geonameid === null,
    hebrewDate,
    weather,
    dayType,
    holiday: cal.holiday,
    candleLighting: cal.candleLighting,
  };
}

import { summarizeDay, type DayWeather } from "@fit-check/engine";
import { HebcalConverterSchema, HebcalItemsSchema, OpenMeteoHourlySchema } from "@fit-check/schema";
import { cacheGet, cacheSet } from "./kv";

/**
 * What kind of day it is, from the real world: Israel-local date, Hebrew date and holidays from Hebcal, and the
 * forecast from Open-Meteo. Each source is independent and nullable, so one outage degrades one line of the
 * screen, not the outfit.
 *
 * Both APIs are free, keyless and CORS-open, so the app calls them directly (no secret, no AI: CLAUDE.md allows
 * it). The daily server job (PLAN.md phase B) will call the same URLs and cache them in the database.
 */

// Tel Aviv. don't touch / PRD section 8 had 293397, which is Tel Aviv; 293397 is Tel Aviv itself.
const GEONAME_ID = 293397;
const LAT = 32.0809;
const LON = 34.7806;
const HOUR = 3_600_000;

export type DayType = "weekday" | "shabbat" | "holiday";

export type DayContext = {
  /** Israel-local yyyy-mm-dd: the device clock may sit in another zone, the wardrobe lives in Israel. */
  date: string;
  /** 0 = Sunday ... 6 = Saturday, in Israel. */
  weekday: number;
  hebrewDate: { he: string; en: string } | null;
  weather: DayWeather | null;
  dayType: DayType;
  holiday: { he: string; en: string } | null;
  /** "HH:MM" when candles are lit today (Friday or a holiday eve), else null. */
  candleLighting: string | null;
};

const ISRAEL_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
const ISRAEL_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function israelDate(now: Date = new Date()): { date: string; weekday: number } {
  return { date: ISRAEL_DATE.format(now), weekday: WEEKDAYS.indexOf(ISRAEL_WEEKDAY.format(now)) };
}

/** Hebcal returns pointed Hebrew (niqqud); the editorial dateline reads cleaner without it. */
function stripNiqqud(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function loadWeather(date: string): Promise<DayWeather | null> {
  const key = "fitcheck:forecast:v1";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    "&hourly=apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code" +
    "&timezone=Asia%2FJerusalem&forecast_days=2";
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

async function loadCalendar(date: string): Promise<Pick<DayContext, "holiday" | "candleLighting"> & { yomtov: boolean }> {
  const key = `fitcheck:hebcal:${date}`;
  type Cal = { holiday: DayContext["holiday"]; candleLighting: string | null; yomtov: boolean };
  const cached = await cacheGet<Cal>(key, 24 * HOUR);
  if (cached) return cached;
  try {
    const url =
      `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&i=on&c=on&M=on&geonameid=${GEONAME_ID}` + `&start=${date}&end=${date}&lg=he`;
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

/** Loads today's context; never throws. */
export async function loadDayContext(now: Date = new Date()): Promise<DayContext> {
  const { date, weekday } = israelDate(now);
  const [weather, hebrewDate, cal] = await Promise.all([loadWeather(date), loadHebrewDate(date), loadCalendar(date)]);
  const dayType: DayType = cal.yomtov ? "holiday" : weekday === 6 ? "shabbat" : "weekday";
  return { date, weekday, hebrewDate, weather, dayType, holiday: cal.holiday, candleLighting: cal.candleLighting };
}

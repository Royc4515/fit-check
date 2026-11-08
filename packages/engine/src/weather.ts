import type { OpenMeteoHourly } from "@fit-check/schema";

/** The day as the engine sees it: what you will feel while you are out, not the 24-hour extremes. */
export type DayWeather = {
  /** Lowest apparent ("feels like") temperature in the window, rounded. */
  temp_min_c: number;
  /** Highest apparent temperature in the window, rounded. */
  temp_max_c: number;
  /** Highest precipitation probability in the window, 0..1. */
  rain_probability: number;
  wind_max_kmh: number;
  uv_max: number;
  /** The most severe sky condition in the window, as a display group. */
  sky: SkyGroup;
  /** How many hourly samples fell in the window; 0 means the forecast does not cover the date. */
  hours: number;
};

export type SkyGroup = "clear" | "cloudy" | "fog" | "drizzle" | "rain" | "showers" | "snow" | "storm";

/** WMO weather codes (Open-Meteo docs) grouped by what a person dresses for, ordered by severity. */
export function skyGroup(code: number): SkyGroup {
  if (code >= 95) return "storm";
  if (code >= 85 || (code >= 71 && code <= 77)) return "snow";
  if (code >= 80) return "showers";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code >= 1) return "cloudy";
  return "clear";
}

const SEVERITY: Record<SkyGroup, number> = { clear: 0, cloudy: 1, fog: 2, drizzle: 3, showers: 4, rain: 5, snow: 6, storm: 7 };

/** Default exposure window: when you are outside or commuting on a weekday (07:00-19:00 local). */
export const WEEKDAY_WINDOW = { fromHour: 7, toHour: 19 } as const;

/**
 * Summarizes an hourly forecast for `date` (local yyyy-mm-dd) over [fromHour, toHour]. Pure: the caller fetched
 * and validated the JSON. Returns null when the forecast has no usable sample for that window, so the caller
 * can say "no weather" instead of dressing you for NaN degrees.
 */
export function summarizeDay(
  forecast: OpenMeteoHourly,
  date: string,
  window: { fromHour: number; toHour: number } = WEEKDAY_WINDOW
): DayWeather | null {
  const h = forecast.hourly;
  let min = Infinity;
  let max = -Infinity;
  let rain = 0;
  let wind = 0;
  let uv = 0;
  let sky: SkyGroup = "clear";
  let hours = 0;
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i]!;
    // Times are local ISO without offset ("2026-11-08T07:00"), so the hour is read straight from the string.
    if (!t.startsWith(date)) continue;
    const hour = Number(t.slice(11, 13));
    if (hour < window.fromHour || hour > window.toHour) continue;
    const at = h.apparent_temperature[i];
    if (at === null || at === undefined) continue;
    hours++;
    min = Math.min(min, at);
    max = Math.max(max, at);
    rain = Math.max(rain, (h.precipitation_probability[i] ?? 0) / 100);
    wind = Math.max(wind, h.wind_speed_10m[i] ?? 0);
    uv = Math.max(uv, h.uv_index[i] ?? 0);
    const code = h.weather_code[i];
    if (code !== null && code !== undefined && SEVERITY[skyGroup(code)] > SEVERITY[sky]) sky = skyGroup(code);
  }
  if (hours === 0) return null;
  return {
    temp_min_c: Math.round(min),
    temp_max_c: Math.round(max),
    rain_probability: Math.round(rain * 100) / 100,
    wind_max_kmh: Math.round(wind),
    uv_max: Math.round(uv * 10) / 10,
    sky,
    hours,
  };
}

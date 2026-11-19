import { HAIFA_BOUNDS, JERUSALEM_BOUNDS, ZIKHRON_BOUNDS, type Region, type Ring } from "./candleLightingBounds";

/**
 * Minutes before sunset at which candles are lit, per local custom. These are Hebcal's own numbers (the
 * @hebcal/core README and its Shabbat-times REST docs). Hebcal applies them only to a chosen city (`geonameid`);
 * for raw coordinates it falls back to 20 inside Israel and 18 elsewhere (measured 2026-11-20: Jerusalem
 * coordinates gave 16:17, the Jerusalem city id 15:57). The app sends the minutes itself as `b=`, so a current
 * location inside a city lights at the same minute as picking that city from the list.
 */
/** Jerusalem: 40 minutes before sunset. */
export const CANDLE_MINUTES_JERUSALEM = 40;
/** Haifa and Zikhron Ya'akov: 30 minutes. */
export const CANDLE_MINUTES_HAIFA_ZIKHRON = 30;
/** The rest of Israel: 20 minutes. */
export const CANDLE_MINUTES_ISRAEL = 20;
/** Outside Israel: 18 minutes. */
export const CANDLE_MINUTES_DIASPORA = 18;

/**
 * Ray-casting point-in-polygon test.
 *
 * @param point `[lon, lat]`, the same axis order as the ring (GeoJSON order).
 * @param ring Closed or open ring of `[lon, lat]` pairs; fewer than 3 points is never "inside".
 * @returns true when the point is inside. A point exactly on an edge or vertex may go either way; the boundaries
 * are simplified to about 100 m, so the answer within that distance of an edge is not meaningful anyway.
 */
export function pointInPolygon(point: readonly [number, number], ring: Ring): boolean {
  if (ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    // don't touch / the (yi > y) !== (yj > y) test also guarantees yj !== yi, so the division cannot hit zero
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a region: in any of its outer rings (enclaves are deliberately not excluded, see candleLightingBounds.ts). */
function pointInRegion(point: readonly [number, number], region: Region): boolean {
  return region.some((ring) => pointInPolygon(point, ring));
}

/**
 * Minutes before sunset for candle lighting at a location: 40 inside Jerusalem's municipal boundary, 30 inside
 * Haifa's or Zikhron Ya'akov's, otherwise 20 in Israel and 18 elsewhere.
 *
 * @param loc Coordinates and the IANA time zone of the place. Non-finite coordinates fall through to the
 * Israel/Diaspora rule rather than throwing.
 * @returns Minutes to send to Hebcal as `b=`.
 *
 * "In Israel" means `tz === "Asia/Jerusalem"`, the same test the app already uses to choose Hebcal's Israel
 * holiday schedule (`i=on`) in `loadCalendar`; the two must not disagree. Consequence: a device in Israel that
 * reports another time zone gets 18, like the Diaspora schedule it also gets.
 */
export function candleLightingMinutes(loc: { lat: number; lon: number; tz: string }): number {
  if (loc.tz !== "Asia/Jerusalem") return CANDLE_MINUTES_DIASPORA;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return CANDLE_MINUTES_ISRAEL;
  const point: readonly [number, number] = [loc.lon, loc.lat];
  if (pointInRegion(point, JERUSALEM_BOUNDS)) return CANDLE_MINUTES_JERUSALEM;
  if (pointInRegion(point, HAIFA_BOUNDS) || pointInRegion(point, ZIKHRON_BOUNDS)) return CANDLE_MINUTES_HAIFA_ZIKHRON;
  return CANDLE_MINUTES_ISRAEL;
}

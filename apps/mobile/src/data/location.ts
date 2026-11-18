import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { z } from "zod";

/**
 * Where the weather and Shabbat times are for. A device setting, not account data: "my current location" only
 * means something on the device you are holding, so it lives in local storage, not in Supabase.
 */
export type SavedLocation =
  | { kind: "default" }
  | { kind: "current" }
  | { kind: "city"; name: string; region: string | null; lat: number; lon: number; tz: string; geonameid: number };

/** What the loaders need: coordinates, a time zone, and the GeoNames id when we have one. */
export type ResolvedLocation = {
  label: string | null;
  lat: number;
  lon: number;
  tz: string;
  /**
   * Hebcal applies city customs by GeoNames id (Jerusalem lights candles 40 minutes before sunset, not 18).
   * Coordinates alone get the generic 18, which is why a chosen city carries its id.
   */
  geonameid: number | null;
};

// don't touch / PRD section 8 had 293397, which is Tel Aviv; 293397 is Tel Aviv itself.
export const DEFAULT_LOCATION: ResolvedLocation = { label: null, lat: 32.0809, lon: 34.7806, tz: "Asia/Jerusalem", geonameid: 293397 };

const KEY = "fitcheck:location:v1";
const LAST_FIX_KEY = "fitcheck:location:lastfix:v1";

const SavedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }),
  z.object({ kind: z.literal("current") }),
  z.object({
    kind: z.literal("city"),
    name: z.string(),
    region: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
    tz: z.string(),
    geonameid: z.number(),
  }),
]);

const listeners = new Set<() => void>();

/** Lets the Today screen reload when the setting changes on the location screen. */
export function onLocationChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getSavedLocation(): Promise<SavedLocation> {
  try {
    const parsed = SavedSchema.safeParse(JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null"));
    return parsed.success ? parsed.data : { kind: "default" };
  } catch {
    return { kind: "default" };
  }
}

export async function saveLocation(loc: SavedLocation): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(loc));
  } finally {
    listeners.forEach((fn) => fn());
  }
}

/** Asks for permission (once) and a fresh fix. Returns null when denied or unavailable; never throws. */
export async function currentPosition(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return null;
    // Balanced (~100m) is plenty for weather and is much faster and lighter on battery than High.
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const fix = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    await AsyncStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix)).catch(() => undefined);
    return fix;
  } catch {
    return null;
  }
}

/** Turns the saved setting into coordinates. "Current" falls back to the last fix, then to the default. */
export async function resolveLocation(): Promise<ResolvedLocation> {
  const saved = await getSavedLocation();
  if (saved.kind === "city") {
    return { label: saved.name, lat: saved.lat, lon: saved.lon, tz: saved.tz, geonameid: saved.geonameid };
  }
  if (saved.kind === "current") {
    const fix =
      (await currentPosition()) ??
      (await AsyncStorage.getItem(LAST_FIX_KEY)
        .then((raw) => z.object({ lat: z.number(), lon: z.number() }).parse(JSON.parse(raw ?? "null")))
        .catch(() => null));
    // You are standing there, so the device's own zone is the right one for "today".
    if (fix) return { label: null, lat: fix.lat, lon: fix.lon, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, geonameid: null };
  }
  return DEFAULT_LOCATION;
}

const GeocodingSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      })
    )
    .optional(),
});

/**
 * City search through Open-Meteo's free geocoder. Its ids are GeoNames ids, which is what Hebcal wants.
 * Returns [] for short queries and on any failure: an empty list is an honest answer for a search box.
 */
export async function searchCities(query: string, lang: "he" | "en"): Promise<Extract<SavedLocation, { kind: "city" }>[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=${lang}&format=json`
    );
    if (!res.ok) return [];
    const { results } = GeocodingSchema.parse(await res.json());
    return (results ?? []).map((r) => ({
      kind: "city" as const,
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(", ") || null,
      lat: r.latitude,
      lon: r.longitude,
      tz: r.timezone,
      geonameid: r.id,
    }));
  } catch {
    return [];
  }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Platform } from "react-native";
import { z } from "zod";
import { canReuseName, nameFromDevice, nameFromNominatim, parseCachedPlace, roundForLookup, type Fix, type PlaceLang } from "./placeName";

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
  /** Which setting produced this: only "current" asks for a place name (the others carry their own label). */
  kind: SavedLocation["kind"];
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

// don't touch / PRD section 8 had 293397, which is Tel Aviv; 294981 is Giv'at Shmuel itself.
export const DEFAULT_LOCATION: ResolvedLocation = { kind: "default", label: null, lat: 32.078, lon: 34.848, tz: "Asia/Jerusalem", geonameid: 294981 };

const KEY = "fitcheck:location:v1";
const LAST_FIX_KEY = "fitcheck:location:lastfix:v1";
// A sibling of the last fix, not a field of it: a fresh fix rewrites LAST_FIX_KEY every time, which would drop the name.
const PLACE_NAME_KEY = "fitcheck:location:placename:v1";

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
    return { kind: "city", label: saved.name, lat: saved.lat, lon: saved.lon, tz: saved.tz, geonameid: saved.geonameid };
  }
  if (saved.kind === "current") {
    const fix =
      (await currentPosition()) ??
      (await AsyncStorage.getItem(LAST_FIX_KEY)
        .then((raw) => z.object({ lat: z.number(), lon: z.number() }).parse(JSON.parse(raw ?? "null")))
        .catch(() => null));
    // You are standing there, so the device's own zone is the right one for "today".
    if (fix) return { kind: "current", label: null, lat: fix.lat, lon: fix.lon, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, geonameid: null };
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

/**
 * Web place-name provider: OpenStreetMap's Nominatim (free, no key). Usage policy:
 * https://operations.osmfoundation.org/policies/nominatim/
 * The rules we follow: personal low volume (a lookup only when the position moved more than 300 m or the language
 * changed); results are cached on the device; attribution is shown on the location screen; and it is used on web
 * only, so the provider can be swapped by a deploy, as the policy asks, not by an app update. We send no custom
 * headers: the browser's own Referer identifies the app, and a custom header would force a CORS preflight.
 */
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

/** The name is decoration: after this long we show "current location" instead of making anything wait. */
const LOOKUP_TIMEOUT_MS = 3000;

/** Rejects after `ms` so a hung geocoder cannot hold the screen; the timer is cleared when the work settles first. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function lookupOnWeb(r: Fix, lang: PlaceLang): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const url = `${NOMINATIM_REVERSE_URL}?format=jsonv2&lat=${r.lat}&lon=${r.lon}&zoom=10&addressdetails=1&accept-language=${lang}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return nameFromNominatim(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The settlement name for a position, or null. Web asks Nominatim with coordinates rounded to about 100 m; native
 * asks the device's own geocoder (no service of ours). Never throws: no network, a block, a timeout, a point at sea
 * or a strange answer all read as "no name", and the screen says "current location".
 */
export async function lookupPlaceName(fix: Fix, lang: PlaceLang): Promise<string | null> {
  try {
    const r = roundForLookup(fix);
    if (Platform.OS === "web") return await lookupOnWeb(r, lang);
    return nameFromDevice(await withTimeout(Location.reverseGeocodeAsync({ latitude: r.lat, longitude: r.lon }), LOOKUP_TIMEOUT_MS));
  } catch (error) {
    console.warn("Place name unavailable", error);
    return null;
  }
}

// don't touch / a separate set from `listeners`: Today reloads on a location change, and a reload that looks up a name
// would otherwise notify itself in a loop.
const nameListeners = new Set<() => void>();

/** Lets Profile and the location screen refresh their row when Today's lookup stores a new name. */
export function onPlaceNameChange(fn: () => void): () => void {
  nameListeners.add(fn);
  return () => nameListeners.delete(fn);
}

/** The name stored for the last looked-up point in this language, with no network and no distance check. */
export async function cachedPlaceName(lang: PlaceLang): Promise<string | null> {
  try {
    const cached = parseCachedPlace(await AsyncStorage.getItem(PLACE_NAME_KEY));
    return cached && cached.lang === lang ? cached.name : null;
  } catch {
    return null;
  }
}

/**
 * The name for `fix`: the stored one while the position is within 300 m of its point and the language is the same,
 * else a fresh lookup, stored when it found something. A failed lookup returns null and leaves the stored name alone.
 * Never throws.
 */
export async function placeNameFor(fix: Fix, lang: PlaceLang): Promise<string | null> {
  try {
    const cached = parseCachedPlace(await AsyncStorage.getItem(PLACE_NAME_KEY));
    if (cached && canReuseName(cached, fix, lang)) return cached.name;
  } catch {
    // An unreadable cache is a miss.
  }
  const name = await lookupPlaceName(fix, lang);
  if (name !== null) {
    const r = roundForLookup(fix);
    await AsyncStorage.setItem(PLACE_NAME_KEY, JSON.stringify({ name, lat: r.lat, lon: r.lon, lang })).catch(() => undefined);
    nameListeners.forEach((fn) => fn());
  }
  return name;
}

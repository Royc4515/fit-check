import type { LocationGeocodedAddress } from "expo-location";
import { z } from "zod";

/**
 * The pure half of "show where 'my current location' is" (DESIGN.md section 3, the place-name paragraph): rounding,
 * distance, cache reuse and reading a name out of a provider's answer. No I/O and no clock, so every rule here is
 * unit-tested; the requests themselves live in location.ts.
 */

/** A coordinate pair as the device reports it. */
export type Fix = { lat: number; lon: number };

export type PlaceLang = "he" | "en";

/** A name together with the point and the language it was looked up for. */
export type CachedPlace = { name: string; lat: number; lon: number; lang: PlaceLang };

/**
 * Within this distance of the cached point the cached name is reused and nothing is sent.
 * don't touch / 300 m is a privacy and politeness rule, not a tuning knob: it keeps requests to the Nominatim
 * policy's low volume and keeps our own location from leaving the device on every GPS jitter.
 */
export const REUSE_RADIUS_M = 300;

const EARTH_RADIUS_M = 6_371_000;

/** Latitude and longitude rounded to 3 decimals (about 100 m): all a lookup ever needs to carry. */
export function roundForLookup(fix: Fix): Fix {
  return { lat: Math.round(fix.lat * 1000) / 1000, lon: Math.round(fix.lon * 1000) / 1000 };
}

/** Great-circle distance in metres (haversine). */
export function metersBetween(a: Fix, b: Fix): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether the cached name still describes `fix`: same language, and the fix is no further than
 * {@link REUSE_RADIUS_M} from the point the name belongs to. A null cache, an empty name or another language is a miss.
 */
export function canReuseName(cached: CachedPlace | null, fix: Fix, lang: PlaceLang): boolean {
  if (cached === null || cached.name.trim() === "" || cached.lang !== lang) return false;
  return metersBetween(cached, fix) <= REUSE_RADIUS_M;
}

const NominatimSchema = z.object({
  address: z
    .object({
      city: z.string().optional(),
      town: z.string().optional(),
      village: z.string().optional(),
      municipality: z.string().optional(),
      hamlet: z.string().optional(),
    })
    .optional(),
});

/** The first non-blank string of the list, trimmed; null when there is none. */
function firstNonEmpty(values: readonly (string | null | undefined)[]): string | null {
  for (const v of values) {
    const s = v?.trim();
    if (s) return s;
  }
  return null;
}

/**
 * The settlement name from a Nominatim `reverse` jsonv2 body: city, else town, village, municipality, hamlet.
 * Null for anything else: an `{ "error": ... }` body (a point at sea), a missing address, a body that is not the
 * documented shape, or blank names. Never throws: the name is decoration and must not break the day.
 */
export function nameFromNominatim(json: unknown): string | null {
  const parsed = NominatimSchema.safeParse(json);
  if (!parsed.success || !parsed.data.address) return null;
  const a = parsed.data.address;
  return firstNonEmpty([a.city, a.town, a.village, a.municipality, a.hamlet]);
}

/**
 * The settlement name from the device geocoder's answer (expo-location): the first non-empty of `city`, `subregion`,
 * `district` across the returned addresses, in that order of preference per address. Null for none.
 */
export function nameFromDevice(addresses: readonly Pick<LocationGeocodedAddress, "city" | "subregion" | "district">[]): string | null {
  for (const a of addresses) {
    const name = firstNonEmpty([a.city, a.subregion, a.district]);
    if (name) return name;
  }
  return null;
}

const CachedPlaceSchema = z.object({
  name: z.string().trim().min(1),
  lat: z.number(),
  lon: z.number(),
  lang: z.enum(["he", "en"]),
});

/** Reads the stored cache entry; any corrupt or older shape is "no name", never an error. */
export function parseCachedPlace(raw: string | null): CachedPlace | null {
  if (raw === null) return null;
  try {
    const parsed = CachedPlaceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

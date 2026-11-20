import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Tiny JSON cache with a time-to-live. Every failure (missing, corrupt, expired, storage blocked) reads as a miss:
 * a cache is an optimization and must never be the reason a screen breaks.
 */
export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    return Date.now() - at <= maxAgeMs ? value : null;
  } catch {
    return null;
  }
}

/**
 * Like cacheGet, but also returns when the value was stored (epoch ms), for a caller that tells the user how old it
 * is. Null on every failure, as cacheGet.
 */
export async function cacheGetEntry<T>(key: string, maxAgeMs: number): Promise<{ value: T; at: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    return typeof at === "number" && Date.now() - at <= maxAgeMs ? { value, at } : null;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Full or blocked storage costs us the cache, nothing else.
  }
}

/**
 * A plain device setting with no expiry (the chosen language). Null for missing or unreadable: a setting that cannot
 * be read means the default, never a broken screen.
 */
export async function settingGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a device setting. Blocked storage only loses it for the next start; the choice still applies now. */
export async function settingSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Nothing to do: the caller has already applied the value in memory.
  }
}

/**
 * Web only: the same setting, read synchronously, so a stored language is in force before the first render (no flash
 * of the device language, no direction flip after paint). Null on native, during the static export's server render,
 * and when storage is blocked.
 */
export function settingGetNow(key: string): string | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  try {
    // don't touch / AsyncStorage's web build is window.localStorage under the very same key (async-storage 2.2,
    // lib/module/AsyncStorage.js), so this reads what settingSet wrote. Re-check when that package is upgraded.
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

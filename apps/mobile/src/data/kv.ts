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

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Full or blocked storage costs us the cache, nothing else.
  }
}

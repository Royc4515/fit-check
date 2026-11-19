import { useEffect, useState } from "react";
import { settingGet, settingGetNow, settingSet } from "./kv";
import { OBSERVANCE_KEY, parseObservance, storedObservance } from "./observance";

const listeners = new Set<(observes: boolean) => void>();
// The value this session has seen last, so a screen mounted after a change starts from it and not from storage.
let current: boolean | null = null;

/** The stored setting, read once; web reads it synchronously so the first paint already follows it. */
function initial(): boolean {
  return current ?? parseObservance(settingGetNow(OBSERVANCE_KEY));
}

/**
 * Stores "keeps Shabbat and holidays" on the device and tells every mounted screen at once (Today reloads its day
 * context; Profile, the wardrobe filter sheet and the location screen re-render), so no reload is needed.
 */
export async function setObservesShabbat(observes: boolean): Promise<void> {
  current = observes;
  for (const fn of listeners) fn(observes);
  await settingSet(OBSERVANCE_KEY, storedObservance(observes));
}

/** The setting, live: the stored value (default on), then every change made while the screen is mounted. */
export function useObservesShabbat(): boolean {
  const [observes, setObserves] = useState(initial);
  useEffect(() => {
    listeners.add(setObserves);
    // Native has no synchronous read: the stored value lands here a moment after mount.
    let active = true;
    if (current === null) {
      void settingGet(OBSERVANCE_KEY).then((raw) => {
        if (!active || current !== null) return;
        current = parseObservance(raw);
        setObserves(current);
      });
    }
    return () => {
      active = false;
      listeners.delete(setObserves);
    };
  }, []);
  return observes;
}

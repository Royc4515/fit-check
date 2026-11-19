import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { supabase } from "../lib/supabase";
import { settingGet, settingGetNow, settingSet } from "./kv";
import { OBSERVANCE_KEY, observanceFromProfile, parseObservance, profileReadResult, storedObservance } from "./observance";
import { isPreview, PreviewReadOnlyError } from "./preview";

/**
 * "Keeps Shabbat and holidays" (DESIGN.md "שלב 4.1" item 10, "שלב 4.5" item 7). The value lives on the profile
 * (`profile.observes_shabbat`, migration 0006, own row by RLS) with a copy on the device: the copy is shown at once and
 * the profile's answer replaces it when it arrives; a change is written to both. These functions and the two hooks are
 * the only readers of where it lives: no screen knows.
 */

const listeners = new Set<(observes: boolean) => void>();
const failureListeners = new Set<(failed: boolean) => void>();
// The value this session has seen last, so a screen mounted after a change starts from it and not from storage.
let current: boolean | null = null;
let failed = false;
// The profile is asked until one read has answered (a value, or "no row"); a failed read is asked again on the next
// mount or return to the app, and a read already on its way is not doubled.
let profileAnswered = false;
let profileReading: Promise<void> | null = null;
let readFailureLogged = false;
// User changes this session: a read that started before the latest one must not undo it (profileReadResult).
let changeCount = 0;

/** The stored setting, read once; web reads it synchronously so the first paint already follows it. */
function initial(): boolean {
  return current ?? parseObservance(settingGetNow(OBSERVANCE_KEY));
}

function apply(observes: boolean) {
  current = observes;
  for (const fn of listeners) fn(observes);
  void settingSet(OBSERVANCE_KEY, storedObservance(observes));
}

function setFailed(next: boolean) {
  failed = next;
  for (const fn of failureListeners) fn(next);
}

/**
 * Reads the profile's value once and, when it has one, puts it in charge (and on the device). No row, a missing column
 * or any error leaves the device value in charge; the error is logged once.
 */
function syncFromProfile(): Promise<void> {
  if (profileAnswered) return Promise.resolve();
  if (profileReading) return profileReading;
  const startedAt = changeCount;
  const logFailure = (why: unknown) => {
    if (readFailureLogged) return;
    readFailureLogged = true;
    console.warn("observes_shabbat not read from the profile; the device setting stands", why);
  };
  profileReading = (async () => {
    try {
      const { data, error } = await supabase.from("profile").select("observes_shabbat").maybeSingle();
      if (error) {
        logFailure(error.message);
        return;
      }
      profileAnswered = true;
      const value = profileReadResult(observanceFromProfile(data, error), startedAt, changeCount);
      if (value !== null && value !== current) apply(value);
    } catch (error) {
      logFailure(error);
    } finally {
      profileReading = null;
    }
  })();
  return profileReading;
}

/** The signed-in user's id, or null (signed out, or design preview). */
async function userId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Changes the setting: every mounted screen follows at once (Today reloads its day context), the device copy is
 * written, and the profile row is upserted (created on the first write). If the profile write fails the setting goes
 * back to what it was and the failure is published (useObservanceFailed); preview rejects the write like every write.
 */
export async function setObservesShabbat(observes: boolean): Promise<void> {
  changeCount++;
  const before = current ?? initial();
  setFailed(false);
  apply(observes);
  try {
    if (isPreview()) throw new PreviewReadOnlyError("setObservesShabbat");
    const id = await userId();
    if (!id) throw new Error("not signed in");
    const { error } = await supabase.from("profile").upsert({ user_id: id, observes_shabbat: observes }, { onConflict: "user_id" });
    if (error) throw error;
  } catch (error) {
    console.error("observes_shabbat write failed; back to the previous value", error);
    apply(before);
    setFailed(true);
  }
}

/** The setting, read once outside React: the session's value, else the device copy. */
export async function getObservesShabbat(): Promise<boolean> {
  if (current !== null) return current;
  return parseObservance(await settingGet(OBSERVANCE_KEY));
}

/** The setting, live: the device copy at once, the profile's answer when it arrives, then every change. */
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
    void syncFromProfile();
    // Back in the app after a failed read (offline at start): ask again.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncFromProfile();
    });
    return () => {
      active = false;
      listeners.delete(setObserves);
      sub.remove();
    };
  }, []);
  return observes;
}

/** True after the last change could not be saved to the profile (it was rolled back); cleared by the next change. */
export function useObservanceFailed(): boolean {
  const [value, setValue] = useState(failed);
  useEffect(() => {
    failureListeners.add(setValue);
    return () => {
      failureListeners.delete(setValue);
    };
  }, []);
  return value;
}

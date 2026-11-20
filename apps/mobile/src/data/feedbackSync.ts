/*
 * What every mounted feedback hook (data/useFeedback.ts) must agree on. Today and the saved outfit's screen each run
 * their own hook, and both can record today's wear (DESIGN.md "שלב 5.2" item 4): a wear made on one has to be on the
 * other at once, without a reload. Module state, no React, so the node test runner covers it.
 */

/**
 * Items the day's wear sent to the laundry (`itemIds`, the set L of data/correction.ts), so a screen can name them,
 * offer to keep them home and bring them all back on undo; `keptHome` are the ones the user kept out (never
 * re-laundered).
 */
export type Laundered = { wearId: string; itemIds: string[]; keptHome: string[] };

/** The day's laundry and the date of the wear it belongs to (a failed "keep out of the laundry" shows on that day). */
export type LaundryState = { laundered: Laundered | null; date: string | null };

let laundry: LaundryState = { laundered: null, date: null };
const laundryListeners = new Set<() => void>();

/** The laundry state now (useSyncExternalStore's snapshot: the same object until it changes). */
export function laundryNow(): LaundryState {
  return laundry;
}

/** Listens to laundry changes; returns the unsubscribe. */
export function subscribeLaundry(listener: () => void): () => void {
  laundryListeners.add(listener);
  return () => {
    laundryListeners.delete(listener);
  };
}

/**
 * Changes the laundry state. One state for the whole app, not one per screen: the wear it belongs to is one row, and
 * whichever screen undoes that wear must bring the same garments home. `date` is kept when not given.
 */
export function setLaundry(change: (cur: Laundered | null) => Laundered | null, date?: string): void {
  const next = change(laundry.laundered);
  const nextDate = date ?? laundry.date;
  if (next === laundry.laundered && nextDate === laundry.date) return;
  laundry = { laundered: next, date: nextDate };
  for (const l of laundryListeners) l();
}

/** Who wrote: each hook passes its own token, so it is not told about its own writes. */
export type WriterToken = symbol;

const wearListeners = new Map<WriterToken, () => void>();

/**
 * Tells every other mounted hook that wears were written (stored or deleted), so each reads its history again.
 * Called after every write attempt, failed ones included: a write that failed half way may still have changed a row.
 */
export function announceWears(from: WriterToken): void {
  for (const [token, listener] of wearListeners) if (token !== from) listener();
}

/** Listens to other hooks' wear writes; returns the unsubscribe. */
export function onOtherWears(token: WriterToken, listener: () => void): () => void {
  wearListeners.set(token, listener);
  return () => {
    wearListeners.delete(token);
  };
}

import type { SavedOutfitSignal } from "@fit-check/engine";
import type { FeedbackHistory } from "../../data/feedback";

/**
 * Which saved outfits Today's engine learns from (DESIGN.md "שלב 5.2" item 8), and when that list may change. Pure, so
 * the rule is tested without a screen.
 *
 * The saved list is read after the day's outfit is drawn (it never delays the first paint), so on a cold start it
 * arrives while the user is already looking at an outfit. Taking it in on arrival would re-rank every tab under the
 * user's eyes, and a new shortlist also costs a new stylist call. So the list in force is fixed when the screen opens
 * (the store's list if it was already read, else none) and is replaced only when the user asks for a different
 * outfit anyway: a new skip or dislike, or a nudge in the adjust sheet. An undone skip goes back to the list that was
 * in force before that skip, so undo shows the outfit it took away.
 */
export type LearnState = {
  /** Skip and dislike records across today and the planned days, when this state was made. */
  skips: number;
  /** The adjust sheet's taps by date, by identity: a new object is a nudge. */
  adjustments: unknown;
  /** The list in force at each skip count seen; the current one is `byCount.get(skips)`. */
  byCount: ReadonlyMap<number, readonly SavedOutfitSignal[]>;
};

const NONE: readonly SavedOutfitSignal[] = [];

/** Skip and dislike records (every answer that is not a wear) across today and the planned days. */
export function skipCount(history: Pick<FeedbackHistory, "today" | "ahead">): number {
  let n = 0;
  for (const r of history.today) if (r.feedback !== "worn") n++;
  for (const r of history.ahead) if (r.feedback !== "worn") n++;
  return n;
}

/**
 * The state when Today opens. `live` is the store's list when it has been read, else null (still loading, or failed):
 * then the screen learns from nothing until the next regeneration.
 */
export function initialLearn(skips: number, adjustments: unknown, live: readonly SavedOutfitSignal[] | null): LearnState {
  return { skips, adjustments, byCount: new Map([[skips, live ?? NONE]]) };
}

/**
 * The state after a render. Returns `prev` itself when nothing that regenerates the outfit happened, so the caller can
 * compare by identity. Never throws.
 *
 * - more skips than before (a new skip or dislike) or a nudge: the latest read list, or the one in force if none was
 *   read yet;
 * - fewer skips (an undo): the list that was in force at that count, so the outfit that was skipped comes back as it
 *   was; the latest list if that count was never seen (a skip recorded before the screen opened, undone now).
 */
export function nextLearn(prev: LearnState, skips: number, adjustments: unknown, live: readonly SavedOutfitSignal[] | null): LearnState {
  if (skips === prev.skips && adjustments === prev.adjustments) return prev;
  const fresh = live ?? learnedFrom(prev);
  const byCount = new Map(prev.byCount);
  if (skips < prev.skips && adjustments === prev.adjustments) {
    if (!byCount.has(skips)) byCount.set(skips, fresh);
  } else {
    byCount.set(skips, fresh);
  }
  return { skips, adjustments, byCount };
}

/** The saved outfits the engine learns from in this state. */
export function learnedFrom(state: LearnState): readonly SavedOutfitSignal[] {
  return state.byCount.get(state.skips) ?? NONE;
}

/**
 * "Wore something else?" (DESIGN.md "שלב 5.1" item 1), the pure decisions behind a correction. The order is: record
 * the corrected wear FIRST, and only after it is stored delete the earlier one, so a failure at any step never leaves
 * the day without a record.
 */

import { dueForLaundry } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";

/** Which step of a correction failed: the new wear was not stored (nothing changed), or the earlier wear was not deleted. */
export type CorrectionStage = "record" | "delete";

/** The failure line of a correction: its message key and what "try again" repeats. */
export function correctionFailure(stage: CorrectionStage): { messageKey: string; retries: "whole correction" | "delete only" } {
  return stage === "record"
    ? { messageKey: "today.status.correctionNotSaved", retries: "whole correction" }
    : { messageKey: "today.status.correctionOldKept", retries: "delete only" };
}

/**
 * The laundry of one day's wear (DESIGN.md "שלב 5.1" item 1): L is the set of garments THIS wear moved to the laundry
 * (never garments that were there before it), and K the garments the user sent back with "keep out of the laundry".
 * The status line names L; an undo sends all of L home.
 */
export type DayLaundry = { moved: string[]; keptHome: string[] };

/**
 * The laundry moves of a correction from outfit A (`earlier`) to outfit B (`corrected`), and the day's L after it:
 * - every garment of L not in B goes home;
 * - every garment of B that the laundry rule sends to the laundry, that is at home and not in L, is moved and joins L;
 * - garments in both stay where they are and stay in L: L after = (L ∩ B) ∪ newly moved;
 * - a garment the user kept home today stays home and out of L (it is not re-laundered behind their back).
 * The counts are read while the earlier wear still exists (the delete comes last), so a garment of both outfits has
 * that wear counted twice; one is taken off, and the count is what it will be once the earlier wear is gone.
 *
 * @param args.day The day's L and K (empty when unknown, e.g. after a reload: nothing is then sent home).
 * @param args.earlier The earlier outfit's item ids (A).
 * @param args.corrected The corrected outfit's items (B), with their availability now.
 * @param args.counts Worn wears since each garment's last wash, the corrected wear included (wear_counts_since_wash).
 */
export function laundryAfterCorrection(args: {
  day: DayLaundry;
  earlier: readonly string[];
  corrected: readonly Item[];
  counts: ReadonlyMap<string, number>;
}): { home: string[]; laundry: string[]; day: DayLaundry } {
  const { day, earlier, corrected, counts } = args;
  const inB = new Set(corrected.map((i) => i.id));
  const home = day.moved.filter((id) => !inB.has(id));
  const adjusted = new Map([...counts].map(([id, n]) => [id, earlier.includes(id) ? n - 1 : n]));
  const laundry = dueForLaundry(corrected, adjusted)
    .map((i) => i.id)
    .filter((id) => !day.moved.includes(id) && !day.keptHome.includes(id));
  return { home, laundry, day: { moved: [...day.moved.filter((id) => inB.has(id)), ...laundry], keptHome: day.keptHome } };
}

/** "Keep out of the laundry" on some of the day's garments: they leave L and join K. */
export function keepHomeLaundry(day: DayLaundry, ids: readonly string[]): DayLaundry {
  return { moved: day.moved.filter((id) => !ids.includes(id)), keptHome: [...new Set([...day.keptHome, ...ids])] };
}

/**
 * The steps of a correction, in order, and what a failure leaves. Record first (a failure changes nothing), then the
 * laundry for the corrected outfit (so the laundry already matches the outfit on screen if the delete then fails),
 * then the delete of the earlier wear, then unlearning it. A retried delete only deletes and unlearns: the laundry
 * was already moved and is never moved twice.
 */
export const CORRECTION_STEPS = ["record", "laundry", "delete", "unlearn"] as const;
export const DELETE_RETRY_STEPS = ["delete", "unlearn"] as const;

/**
 * The worn record a day shows when it has more than one (a correction whose delete failed, then a reload): the newest.
 * Records come oldest first, as the history reads them (worn_on, then created_at).
 */
export function newestWorn<R extends { feedback: string }>(records: readonly R[]): R | null {
  for (let i = records.length - 1; i >= 0; i--) if (records[i]!.feedback === "worn") return records[i]!;
  return null;
}

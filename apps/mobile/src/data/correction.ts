/**
 * "Wore something else?" (DESIGN.md "שלב 5.1" item 1), the pure decisions behind a correction. The order is: record
 * the corrected wear FIRST, and only after it is stored delete the earlier one, so a failure at any step never leaves
 * the day without a record.
 */

/** Which step of a correction failed: the new wear was not stored (nothing changed), or the earlier wear was not deleted. */
export type CorrectionStage = "record" | "delete";

/** The failure line of a correction: its message key and what "try again" repeats. */
export function correctionFailure(stage: CorrectionStage): { messageKey: string; retries: "whole correction" | "delete only" } {
  return stage === "record"
    ? { messageKey: "today.status.correctionNotSaved", retries: "whole correction" }
    : { messageKey: "today.status.correctionOldKept", retries: "delete only" };
}

/**
 * Garments the earlier wear sent to the laundry that the corrected outfit does not contain: they go back home once the
 * earlier wear is deleted (the corrected outfit's own garments are then counted by its own laundry pass).
 *
 * @param laundered What the earlier wear moved to the laundry (null when that is unknown, e.g. after a reload).
 * @param corrected The corrected outfit's item ids.
 */
export function itemsBackHome(laundered: readonly string[] | null, corrected: readonly string[]): string[] {
  if (!laundered) return [];
  return laundered.filter((id) => !corrected.includes(id));
}

/**
 * The worn record a day shows when it has more than one (a correction whose delete failed, then a reload): the newest.
 * Records come oldest first, as the history reads them (worn_on, then created_at).
 */
export function newestWorn<R extends { feedback: string }>(records: readonly R[]): R | null {
  for (let i = records.length - 1; i >= 0; i--) if (records[i]!.feedback === "worn") return records[i]!;
  return null;
}

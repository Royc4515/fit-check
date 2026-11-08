import type { Item } from "@fit-check/schema";
import { LAUNDRY_AFTER_WEARS } from "./config";

/**
 * Items that should go to the wash, given how many times each was worn since its last wash (including the wear
 * just logged). Only items currently at home move: one already in the laundry, away or lent is left alone.
 * Ids missing from `wearCounts` are treated as zero wears, never as due.
 */
export function dueForLaundry(items: readonly Item[], wearCounts: ReadonlyMap<string, number>): Item[] {
  return items.filter((item) => {
    const limit = LAUNDRY_AFTER_WEARS[item.tags.subcategory];
    return item.availability === "home" && limit !== undefined && (wearCounts.get(item.id) ?? 0) >= limit;
  });
}

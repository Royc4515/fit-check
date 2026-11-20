import type { Item } from "@fit-check/schema";
import { newestWorn } from "../../data/correction";
import type { TodayRecord } from "../../data/feedback";
import { itemSetKey, type SavedOutfit } from "../../data/savedOutfit";

/*
 * "לובש היום" on a saved outfit's screen (DESIGN.md "שלב 5.2" item 4), its decisions with no I/O and no React: what
 * the screen offers given today's records, and what a press (or a "try again") does. A day has one wear.
 */

/**
 * - `loading`: today's records have not been read yet (no bar: a press could not know whether it replaces a wear).
 * - `worn`: today's wear is this outfit (recorded here or on Today): the recorded line, no bar.
 * - `blocked`: the outfit cannot be worn as it is: a garment was deleted (`missing`) or taken out of the wardrobe
 *   (`archived`, the garments named). No bar, one meta line saying why.
 * - `replace`: today already has a wear of another outfit (`earlier`); a press asks before replacing it.
 * - `fresh`: nothing worn today; a press records the wear.
 */
export type WearTodayState =
  | { kind: "loading" }
  | { kind: "worn"; record: TodayRecord }
  | { kind: "blocked"; reason: "missing" }
  | { kind: "blocked"; reason: "archived"; items: Item[] }
  | { kind: "replace"; earlier: TodayRecord }
  | { kind: "fresh" };

/**
 * See WearTodayState. Pure.
 *
 * "This outfit" is the same garment set (itemSetKey), not only the same row: same garments = same outfit (DESIGN.md
 * "שלב 5.2", the principle), so a wear of these garments recorded on an older unsaved row counts too. The day's wear
 * is the newest worn record (newestWorn), as Today shows it.
 *
 * A worn day wins over `blocked`: the wear happened and keeps its undo even if a garment was archived since.
 *
 * @param args.outfit - the saved outfit (`missing` slots, `itemIds` from `outfit_items`).
 * @param args.garments - its garments as the wardrobe has them now (status, availability).
 * @param args.today - today's records (useFeedback `history.today`), or null while not read.
 */
export function wearTodayState(args: {
  outfit: Pick<SavedOutfit, "itemIds" | "missing">;
  garments: readonly Item[];
  today: readonly TodayRecord[] | null;
}): WearTodayState {
  const { outfit, garments, today } = args;
  const worn = today ? newestWorn(today) : null;
  if (worn && itemSetKey(worn.itemIds) === itemSetKey(outfit.itemIds)) return { kind: "worn", record: worn };
  if (outfit.missing.length > 0) return { kind: "blocked", reason: "missing" };
  const archived = garments.filter((g) => g.status === "archived");
  if (archived.length > 0) return { kind: "blocked", reason: "archived", items: archived };
  if (today === null) return { kind: "loading" };
  return worn ? { kind: "replace", earlier: worn } : { kind: "fresh" };
}

/**
 * What a press of "לובש היום" (or "try again" after it failed) does, computed from the state at that moment, never
 * replayed from the press that failed:
 * - `wear`: record the wear.
 * - `confirm`: open the replace step first.
 * - `replace`: replace `earlier` now; only when the user has already confirmed replacing exactly that wear
 *   (`confirmedEarlierId`, a retry of a failed replacement). A different earlier wear asks again.
 * - `none`: nothing to do (already worn, blocked, or not read yet).
 */
export type WearPress = { kind: "wear" } | { kind: "confirm"; earlier: TodayRecord } | { kind: "replace"; earlier: TodayRecord } | { kind: "none" };

/** See WearPress. Pure. */
export function wearPress(state: WearTodayState, confirmedEarlierId: string | null): WearPress {
  if (state.kind === "fresh") return { kind: "wear" };
  if (state.kind !== "replace") return { kind: "none" };
  return state.earlier.wearId === confirmedEarlierId ? { kind: "replace", earlier: state.earlier } : { kind: "confirm", earlier: state.earlier };
}

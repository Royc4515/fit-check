import {
  CONTEXT_TYPES,
  itemFromRow,
  OUTFIT_SOURCES,
  SAVED_OUTFIT_NAME_MAX,
  SavedOutfitRowSchema,
  SLOTS,
  type ContextType,
  type Item,
  type OutfitSource,
  type SavedOutfitRow,
  type Slot,
} from "@fit-check/schema";
import { z } from "zod";

/**
 * The rules and the shape of a saved outfit (DESIGN.md "שלב 5.2"), with no I/O: what a saved outfit must hold, when
 * two outfits are the same one, how a name is cleaned, how a row becomes the model, and the two delete decisions.
 * `outfits.ts` does the requests and `feedback.ts` the undo; both ask this file, so the node test runner covers every
 * decision without a database.
 */

/** Slots a saved outfit must have exactly once. The flat-lay compositions exist for three and four pieces only. */
export const REQUIRED_SLOTS = ["top", "bottom", "shoes"] as const satisfies readonly Slot[];

/** One garment of an outfit as written to `outfit_items`. */
export const OutfitPieceSchema = z.object({ item_id: z.string().min(1), slot: z.enum(SLOTS) });
export type OutfitPiece = z.infer<typeof OutfitPieceSchema>;

/** What a save needs. `date` is the caller's local yyyy-mm-dd (`created_for_date`), never read from a clock here. */
export const SaveOutfitInputSchema = z.object({
  userId: z.string().min(1),
  date: z.string().date(),
  contextType: z.enum(CONTEXT_TYPES),
  source: z.enum(OUTFIT_SOURCES),
  pieces: z.array(OutfitPieceSchema),
  name: z.string().nullable().optional(),
});
export type SaveOutfitInput = z.infer<typeof SaveOutfitInputSchema>;

/** Why a set of pieces is not a saveable outfit. The build screen turns `missing` into "חסרות נעליים". */
export type OutfitProblem =
  | { kind: "missing"; slot: Slot }
  | { kind: "extra"; slot: Slot }
  | { kind: "duplicate_item"; itemId: string };

/**
 * Every failure the saved-outfit data layer reports on purpose (network and permission errors are thrown as they
 * come). `invalid_outfit` carries the problems; `invalid_input` the zod message.
 */
export type SavedOutfitErrorCode = "invalid_input" | "invalid_outfit" | "name_too_long" | "not_found" | "not_saved" | "same_garments";

export class SavedOutfitError extends Error {
  readonly code: SavedOutfitErrorCode;
  readonly problems: readonly OutfitProblem[];
  /** `same_garments` only: the other saved outfit that already has exactly these garments. */
  readonly otherId: string | null;
  constructor(code: SavedOutfitErrorCode, message: string, problems: readonly OutfitProblem[] = [], otherId: string | null = null) {
    super(message);
    this.name = "SavedOutfitError";
    this.code = code;
    this.problems = problems;
    this.otherId = otherId;
  }
}

/**
 * What an edit of a saved outfit sets: all its garments, "למתי" and the name (null or empty = no name). `userId` and
 * `date` (the caller's local yyyy-mm-dd) are used only when the edit becomes a new row (see `editPlan`).
 */
export const UpdateOutfitInputSchema = z.object({
  userId: z.string().min(1),
  date: z.string().date(),
  garments: z.array(OutfitPieceSchema),
  contextType: z.enum(CONTEXT_TYPES),
  name: z.string().nullable(),
});
export type UpdateOutfitInput = z.infer<typeof UpdateOutfitInputSchema>;

/**
 * The `outfit_items` writes that turn the garments an outfit has into the ones it should have, keyed by item (the
 * table's primary key is (outfit_id, item_id)): `add` rows to insert, `reslot` kept garments whose slot changed (an
 * item's type was re-tagged), `remove` item ids to delete. Empty lists when nothing changes. Order of each list:
 * as given, so the requests are deterministic.
 */
export function garmentChanges(current: readonly OutfitPiece[], next: readonly OutfitPiece[]): { add: OutfitPiece[]; reslot: OutfitPiece[]; remove: string[] } {
  const now = new Map(current.map((p) => [p.item_id, p.slot] as const));
  const wanted = new Set(next.map((p) => p.item_id));
  return {
    add: next.filter((p) => !now.has(p.item_id)),
    reslot: next.filter((p) => now.has(p.item_id) && now.get(p.item_id) !== p.slot),
    remove: [...new Set(current.map((p) => p.item_id))].filter((id) => !wanted.has(id)),
  };
}

/**
 * The problems of a set of pieces, empty when it can be saved: exactly one top, one bottom and one shoes, at most one
 * layer, and no item twice (outfit_items' primary key is (outfit_id, item_id), so a duplicate would fail the insert
 * after the outfits row exists). Order of the result: missing slots in reading order, then extras, then duplicates.
 * @param pieces - already shaped as OutfitPiece; unknown slots are the zod schema's job, not this function's.
 */
export function outfitProblems(pieces: readonly OutfitPiece[]): OutfitProblem[] {
  const count = new Map<Slot, number>();
  for (const p of pieces) count.set(p.slot, (count.get(p.slot) ?? 0) + 1);
  const problems: OutfitProblem[] = [];
  for (const slot of REQUIRED_SLOTS) if (!count.get(slot)) problems.push({ kind: "missing", slot });
  for (const slot of SLOTS) if ((count.get(slot) ?? 0) > 1) problems.push({ kind: "extra", slot });
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const p of pieces) {
    if (seen.has(p.item_id) && !reported.has(p.item_id)) {
      problems.push({ kind: "duplicate_item", itemId: p.item_id });
      reported.add(p.item_id);
    }
    seen.add(p.item_id);
  }
  return problems;
}

/**
 * Throws SavedOutfitError `invalid_outfit` (with the problems) unless the pieces can be saved.
 * @throws SavedOutfitError
 */
export function assertSaveable(pieces: readonly OutfitPiece[]): void {
  const problems = outfitProblems(pieces);
  if (problems.length > 0) throw new SavedOutfitError("invalid_outfit", `outfit cannot be saved: ${problems.map((p) => p.kind).join(", ")}`, problems);
}

/**
 * A name as stored: trimmed (all whitespace, a stricter trim than the constraint's btrim), and null for no name. An
 * empty or whitespace-only name is "no name", not an error, so clearing the field removes the name.
 * @throws SavedOutfitError `name_too_long` past SAVED_OUTFIT_NAME_MAX characters, counted in code points like the
 *   database's char_length (an emoji is one character, not two UTF-16 units).
 */
export function normalizeOutfitName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim();
  if (name === "") return null;
  if ([...name].length > SAVED_OUTFIT_NAME_MAX) throw new SavedOutfitError("name_too_long", `outfit name is longer than ${SAVED_OUTFIT_NAME_MAX} characters`);
  return name;
}

/** An order-free key of a set of item ids: the same garments in any order, or listed twice, give the same key. */
export function itemSetKey(itemIds: readonly string[]): string {
  return [...new Set(itemIds)].sort().join(",");
}

/**
 * The first outfit whose garments are exactly `itemIds` (any order), skipping `exceptId`: "the same garments are the
 * same outfit". Null when there is none.
 * @param outfits - the candidates (the saved outfits), each with all its item ids.
 */
export function findSameOutfit(
  outfits: readonly { id: string; itemIds: readonly string[] }[],
  itemIds: readonly string[],
  exceptId?: string
): string | null {
  const key = itemSetKey(itemIds);
  return outfits.find((o) => o.id !== exceptId && itemSetKey(o.itemIds) === key)?.id ?? null;
}

/**
 * How an edit of a saved outfit is written (DESIGN.md "שלב 5.2" item 4: what was worn is never rewritten):
 * - `in_place`: the garment set is unchanged (only "למתי" or the name), or the row has no wears at all: that row.
 * - `copy`: the set changes and the row has a wear (any feedback: each `wears` row is what was shown that day): a new
 *   saved row with the new garments and the old row's name, favourite and exact `saved_at`; then the old row is
 *   unsaved and keeps its garments and wears.
 * - `resume`: a `copy` that stopped half way (the new row exists, the old one is still saved). Recognised by a saved
 *   row other than this one with exactly the new garments AND exactly this row's `saved_at`: a copy carries it to the
 *   microsecond, a separately saved outfit never shares it. Finish: write "למתי" and the name on that row, unsave this.
 * - `same_garments`: another saved outfit (not such a copy) already has the new set: refused, naming it.
 * Pure: the caller reads this row and every saved row's garments and `saved_at`.
 */
export type EditPlan =
  | { kind: "in_place" }
  | { kind: "copy" }
  | { kind: "resume"; copyId: string }
  | { kind: "same_garments"; otherId: string };

/** See EditPlan. `wearCount` counts every `wears` row of the edited outfit, any feedback. */
export function editPlan(args: {
  id: string;
  savedAt: string;
  currentItemIds: readonly string[];
  wearCount: number;
  nextItemIds: readonly string[];
  saved: readonly { id: string; savedAt: string | null; itemIds: readonly string[] }[];
}): EditPlan {
  const key = itemSetKey(args.nextItemIds);
  const changed = itemSetKey(args.currentItemIds) !== key;
  const others = args.saved.filter((o) => o.id !== args.id && o.savedAt !== null && itemSetKey(o.itemIds) === key);
  if (changed && args.wearCount > 0) {
    const copy = others.find((o) => o.savedAt === args.savedAt);
    if (copy) return { kind: "resume", copyId: copy.id };
  }
  const other = others[0];
  if (other) return { kind: "same_garments", otherId: other.id };
  return changed && args.wearCount > 0 ? { kind: "copy" } : { kind: "in_place" };
}

/** A saved outfit as the screens use it. */
export type SavedOutfit = {
  id: string;
  /** Null = no name; the screens then list the garment types. */
  name: string | null;
  isFavorite: boolean;
  /** ISO timestamp; the collection is ordered by it, newest first. */
  savedAt: string;
  contextType: ContextType;
  source: OutfitSource;
  createdForDate: string;
  /**
   * Garments placed in flat-lay slots, in reading order (top, bottom, shoes, layer), the same `{ slot, item }` shape
   * as Insights' worn outfits so the FlatLay pieces and the legend's 01-04 numbers are built the same way. Archived
   * garments stay in (their row still exists); the screen decides how to show them.
   */
  pieces: { slot: Slot; item: Item }[];
  /**
   * Required slots with no garment: the item was deleted (`outfit_items` cascades) or its row could not be read.
   * Such an outfit is still listed, not hidden: hiding it would leave the user no way to see or remove it. The flat-lay
   * draws what is there and the screen marks the gap.
   */
  missing: Slot[];
  /** Every item id in `outfit_items`, readable or not: what "the same garments" compares. */
  itemIds: string[];
  /** Wears with feedback `worn`, and the newest of their dates (null = never worn). */
  wornCount: number;
  /** Every `wears` row, any feedback: whether editing the garments must keep this row for history (EditPlan). */
  wearCount: number;
  lastWornOn: string | null;
};

/** The outfit row parsed, or null (logged) when it does not match the schema. */
export function parseOutfitRow(raw: unknown): SavedOutfitRow | null {
  const parsed = SavedOutfitRowSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Skipping malformed outfit row", parsed.error);
    return null;
  }
  return parsed.data;
}

/**
 * A parsed outfit row to the model; null when the row is not saved (`saved_at` null), since only saved outfits are
 * in the collection. A garment whose item does not parse is logged and counted as missing, not fatal: one bad item
 * must not hide the outfit. A second garment for a slot that is taken is left out of the picture (kept in itemIds).
 */
export function savedOutfitFromRow(row: SavedOutfitRow): SavedOutfit | null {
  if (row.saved_at === null) return null;
  const bySlot = new Map<Slot, Item>();
  for (const oi of row.outfit_items) {
    if (bySlot.has(oi.slot)) continue;
    try {
      bySlot.set(oi.slot, itemFromRow(oi.item));
    } catch (error) {
      console.error("Outfit garment could not be read", oi.item_id, error);
    }
  }
  const pieces = SLOTS.flatMap((slot) => {
    const item = bySlot.get(slot);
    return item ? [{ slot, item }] : [];
  });
  const worn = row.wears.filter((w) => w.feedback === "worn").map((w) => w.worn_on);
  return {
    id: row.id,
    name: row.name,
    isFavorite: row.is_favorite,
    savedAt: row.saved_at,
    contextType: row.context_type,
    source: row.source,
    createdForDate: row.created_for_date,
    pieces,
    missing: REQUIRED_SLOTS.filter((slot) => !bySlot.has(slot)),
    itemIds: row.outfit_items.map((oi) => oi.item_id),
    wornCount: worn.length,
    wearCount: row.wears.length,
    lastWornOn: worn.reduce<string | null>((last, d) => (last === null || d > last ? d : last), null),
  };
}

/**
 * Rows to the collection, newest `saved_at` first (ties: id, so the order is stable). Repeats the query's order so a
 * caller that merges rows (an optimistic insert) gets the same list. Malformed and unsaved rows are skipped.
 */
export function savedOutfitsFromRows(rows: readonly unknown[]): SavedOutfit[] {
  const out: SavedOutfit[] = [];
  for (const raw of rows) {
    const row = parseOutfitRow(raw);
    const outfit = row ? savedOutfitFromRow(row) : null;
    if (outfit) out.push(outfit);
  }
  const time = (o: SavedOutfit) => Date.parse(o.savedAt);
  return out.sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Removing an outfit from the collection: with any wear (any feedback; each one points at the row) the row stays,
 * only unsaved, so history keeps its garments; with none it is deleted (`outfit_items` cascade).
 */
export function removalAction(wearCount: number): "unsave" | "delete" {
  return wearCount > 0 ? "unsave" : "delete";
}

/**
 * Undoing a wear: whether the outfit row must stay after its wear is deleted. It stays when it is saved (deleting it
 * would delete the user's saved outfit) or when other wears still point at it (deleting it would null their outfit_id
 * and erase which garments they were). Only a one-off, unsaved suggestion is deleted, as before saved outfits existed.
 * @param outfit - the row after the wear was deleted; null when it no longer exists (nothing to delete).
 */
export function undoKeepsOutfit(outfit: { savedAt: string | null; remainingWears: number } | null): boolean {
  if (outfit === null) return true;
  return outfit.savedAt !== null || outfit.remainingWears > 0;
}

import { SAVED_OUTFIT_READ_COLUMNS } from "@fit-check/schema";
import { z } from "zod";
import { readAllPages } from "../features/insights/pagedRead";
import { supabase } from "../lib/supabase";
import { isPreview, PreviewReadOnlyError } from "./preview";
import {
  assertSaveable,
  editPlan,
  findSameOutfit,
  garmentChanges,
  itemSetKey,
  normalizeOutfitName,
  OutfitPieceSchema,
  parseOutfitRow,
  removalAction,
  SavedOutfitError,
  SaveOutfitInputSchema,
  savedOutfitFromRow,
  savedOutfitsFromRows,
  UpdateOutfitInputSchema,
  wornIndex,
  type SavedOutfit,
  type UpdateOutfitInput,
  type WornIndex,
  type WornWear,
} from "./savedOutfit";

/**
 * Reads and writes of saved outfits (DESIGN.md "שלב 5.2", migration 0007). The rules live in `savedOutfit.ts`; this
 * file only sends requests. RLS: every statement here is on `outfits` or `outfit_items`, covered by "own outfits"
 * (for all, user_id = auth.uid()) and "own outfit items" (through the parent outfit); the embedded `items` and `wears`
 * by "own items" and "own wears". `user_id` is passed on insert because RLS checks it but does not fill it in.
 *
 * Design preview: the snapshot has no saved outfits, so reads answer "none" and every write throws
 * PreviewReadOnlyError like the other writes, which the screens already report as "not saved".
 */

/** The result of a save: the saved outfit, and whether this call created it (false: the same garments were saved). */
export type SaveResult = { outfit: SavedOutfit; created: boolean };

const WornWearRowSchema = z.object({
  worn_on: z.string().date(),
  // Null when the wear's outfit row was deleted (`on delete set null`): it has no garments, so it counts for no set.
  outfits: z.object({ outfit_items: z.array(z.object({ item_id: z.string() })) }).nullable(),
});

/**
 * Every worn wear with its outfit row's item ids, for counting by garment set: the one extra read behind
 * `fetchSavedOutfits` / `fetchSavedOutfit`. Paged like Insights (PostgREST cuts one response at 1,000 rows); a typical
 * wardrobe is one page, so the collection costs two requests, sent together.
 *
 * Never throws: a failure (or more rows than the pager's limit, where the oldest wears would be missing) is logged and
 * answers null, and the callers then count each row's own wears, which is what the app did before counting by set. A
 * wear count is a line of text; it must not take the collection down.
 */
async function fetchWornIndex(): Promise<WornIndex | null> {
  try {
    const { rows, partial } = await readAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("wears")
        .select("id,worn_on,outfits(outfit_items(item_id))")
        .eq("feedback", "worn")
        // don't touch / a stable total order: pages are cut by position, and several wears share a date.
        .order("worn_on", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    });
    if (partial) {
      console.error("Worn wears exceed the paged read; counting each outfit's own wears instead");
      return null;
    }
    const wears: WornWear[] = [];
    for (const raw of rows) {
      const parsed = WornWearRowSchema.safeParse(raw);
      if (!parsed.success) {
        console.error("Skipping malformed wear row", parsed.error);
        continue;
      }
      const { worn_on, outfits } = parsed.data;
      if (outfits) wears.push({ date: worn_on, itemIds: outfits.outfit_items.map((i) => i.item_id) });
    }
    return wornIndex(wears);
  } catch (error) {
    console.error("Could not read worn wears; counting each outfit's own wears instead", error);
    return null;
  }
}

/**
 * The collection, newest `saved_at` first, each with its garments and wear count. Malformed rows are skipped and
 * logged. Throws on a network or permission error of the outfits read.
 *
 * `wornCount` / `lastWornOn` count every worn wear of the same garments, on whichever `outfits` row it points at
 * (DESIGN.md "שלב 5.2": the same garments are the same outfit), from a second read sent together with the first. If
 * that second read fails the collection still loads and each outfit counts only the wears on its own row (logged);
 * `wearCount`, the row's own wears, is always from the row.
 */
export async function fetchSavedOutfits(): Promise<SavedOutfit[]> {
  if (isPreview()) return [];
  const [outfits, worn] = await Promise.all([
    supabase
      .from("outfits")
      .select(SAVED_OUTFIT_READ_COLUMNS)
      .not("saved_at", "is", null)
      .order("saved_at", { ascending: false })
      .order("id", { ascending: true }),
    fetchWornIndex(),
  ]);
  if (outfits.error) throw outfits.error;
  return savedOutfitsFromRows(outfits.data ?? [], worn);
}

/**
 * One saved outfit; null when the id does not exist, is someone else's (RLS hides it), or is not saved.
 * Throws on a network or permission error of the outfit read; the wear count falls back as in `fetchSavedOutfits`.
 */
export async function fetchSavedOutfit(id: string): Promise<SavedOutfit | null> {
  if (isPreview()) return null;
  const [outfit, worn] = await Promise.all([supabase.from("outfits").select(SAVED_OUTFIT_READ_COLUMNS).eq("id", id).maybeSingle(), fetchWornIndex()]);
  if (outfit.error) throw outfit.error;
  const row = outfit.data ? parseOutfitRow(outfit.data) : null;
  return row ? savedOutfitFromRow(row, worn) : null;
}

const SavedSetRowSchema = z.object({ id: z.string(), outfit_items: z.array(z.object({ item_id: z.string() })) });

/** The saved outfit with exactly these garments, or null. Reads ids only: the collection is small, the check is exact. */
async function findSavedWithItems(itemIds: readonly string[], exceptId?: string): Promise<string | null> {
  const { data, error } = await supabase.from("outfits").select("id,outfit_items(item_id)").not("saved_at", "is", null);
  if (error) throw error;
  const rows = z.array(SavedSetRowSchema).parse(data ?? []);
  return findSameOutfit(
    rows.map((r) => ({ id: r.id, itemIds: r.outfit_items.map((i) => i.item_id) })),
    itemIds,
    exceptId
  );
}

/** Reads back a row this module just saved or found; its absence means it was removed meanwhile. */
async function mustFetch(id: string): Promise<SavedOutfit> {
  const outfit = await fetchSavedOutfit(id);
  if (!outfit) throw new SavedOutfitError("not_found", `saved outfit ${id} is gone`);
  return outfit;
}

// Saves in progress on this device, by garment set. A double tap, or Today and the build screen saving the same set,
// shares one request instead of racing two inserts past the duplicate check.
const inFlight = new Map<string, Promise<SaveResult>>();

/**
 * Saves an outfit to the collection: a new `outfits` row with `saved_at` and its `outfit_items`. If a saved outfit
 * with exactly the same garments (any order) exists, it is returned with `created: false` and nothing is written.
 *
 * Inputs: `pieces` ({ item_id, slot }), `contextType` ("למתי"), `source` (`manual` built by hand, `daily` or `swap`
 * for a suggestion), optional `name`, and `date`, the caller's local yyyy-mm-dd for `created_for_date`.
 *
 * Failure modes:
 * - Invalid input (zod), an outfit without exactly one top, bottom and shoes, more than one layer, or an item twice:
 *   SavedOutfitError `invalid_input` / `invalid_outfit` before any request; a name over 40 characters: `name_too_long`.
 * - Two saves of the same set at once on this device share one request (the second resolves `created: false`).
 *   On two devices at the same moment both can pass the duplicate check and two rows result: there is no unique key
 *   on a set of garments (that needs an RPC). Accepted for one user; both rows show and either can be removed.
 * - `outfit_items` insert fails after the `outfits` insert: the new row is deleted again (it has no wears yet), so no
 *   empty saved outfit is left, and the error is thrown. Only a crash between the two inserts can leave one; the list
 *   shows it with every slot in `missing`, and it can be removed.
 * - The read-back after a successful save fails: the error is thrown although the outfit is saved; a retry finds it
 *   as a duplicate and returns it with `created: false`.
 * - Design preview: PreviewReadOnlyError.
 */
export async function saveOutfit(args: {
  userId: string;
  date: string;
  contextType: SavedOutfit["contextType"];
  source: SavedOutfit["source"];
  pieces: { item_id: string; slot: SavedOutfit["pieces"][number]["slot"] }[];
  name?: string | null;
  now?: Date;
}): Promise<SaveResult> {
  const parsed = SaveOutfitInputSchema.safeParse(args);
  if (!parsed.success) throw new SavedOutfitError("invalid_input", parsed.error.message);
  const input = parsed.data;
  assertSaveable(input.pieces);
  const name = normalizeOutfitName(input.name);
  if (isPreview()) throw new PreviewReadOnlyError("saveOutfit");

  const key = itemSetKey(input.pieces.map((p) => p.item_id));
  const pending = inFlight.get(key);
  if (pending) return pending.then((r) => ({ outfit: r.outfit, created: false }));
  const run = insertSaved(input.userId, input.date, input.contextType, input.source, input.pieces, name, args.now ?? new Date());
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

async function insertSaved(
  userId: string,
  date: string,
  contextType: SavedOutfit["contextType"],
  source: SavedOutfit["source"],
  pieces: readonly { item_id: string; slot: SavedOutfit["pieces"][number]["slot"] }[],
  name: string | null,
  now: Date
): Promise<SaveResult> {
  const existing = await findSavedWithItems(pieces.map((p) => p.item_id));
  if (existing) return { outfit: await mustFetch(existing), created: false };

  const created = await supabase
    .from("outfits")
    .insert({ user_id: userId, context_type: contextType, created_for_date: date, source, name, saved_at: now.toISOString() })
    .select("id")
    .single();
  if (created.error) throw created.error;
  const outfitId = String(created.data.id);
  const items = await supabase.from("outfit_items").insert(pieces.map((p) => ({ outfit_id: outfitId, item_id: p.item_id, slot: p.slot })));
  if (items.error) {
    // The row was created a moment ago and no wear can point at it yet, so deleting it loses nothing.
    await supabase.from("outfits").delete().eq("id", outfitId);
    throw items.error;
  }
  return { outfit: await mustFetch(outfitId), created: true };
}

/**
 * Saves an outfit that already exists as a row (one that was worn or answered on Today): sets `saved_at` (and the
 * name, when given) on that same row, so its earlier wears count for it. Same duplicate rule as saveOutfit: if another
 * saved outfit has the same garments, that one is returned with `created: false` and this row stays unsaved (its
 * wears stay on it; they are not moved). Already saved: returned as it is, `created: false`.
 *
 * Failure modes: SavedOutfitError `not_found` (no such row, or RLS hides it); `invalid_outfit` when the row's garments
 * are not a saveable outfit (a garment was deleted since); `name_too_long` before any request; PreviewReadOnlyError in
 * the design preview; network and permission errors as thrown.
 */
export async function markOutfitSaved(outfitId: string, options: { name?: string | null; now?: Date } = {}): Promise<SaveResult> {
  const name = normalizeOutfitName(options.name);
  if (isPreview()) throw new PreviewReadOnlyError("markOutfitSaved");
  const { data, error } = await supabase.from("outfits").select(SAVED_OUTFIT_READ_COLUMNS).eq("id", outfitId).maybeSingle();
  if (error) throw error;
  const row = data ? parseOutfitRow(data) : null;
  if (!row) throw new SavedOutfitError("not_found", `outfit ${outfitId} not found`);
  // Not savedOutfitFromRow(row): that would count this row's own wears only, and the caller patches the store with it.
  if (row.saved_at !== null) return { outfit: await mustFetch(outfitId), created: false };
  assertSaveable(row.outfit_items.map((oi) => ({ item_id: oi.item_id, slot: oi.slot })));

  const itemIds = row.outfit_items.map((oi) => oi.item_id);
  const existing = await findSavedWithItems(itemIds, outfitId);
  if (existing) return { outfit: await mustFetch(existing), created: false };

  const now = (options.now ?? new Date()).toISOString();
  const patch = options.name === undefined ? { saved_at: now } : { saved_at: now, name };
  const updated = await supabase.from("outfits").update(patch).eq("id", outfitId).is("saved_at", null);
  if (updated.error) throw updated.error;
  return { outfit: await mustFetch(outfitId), created: true };
}

const RemovalRowSchema = z.object({ saved_at: z.string().nullable(), wears: z.array(z.object({ id: z.string() })) });

/**
 * Removes an outfit from the collection. With any wear it stays as a row with `saved_at` and `is_favorite` cleared,
 * so history keeps its garments; with none it is deleted (outfit_items cascade). Returns which happened.
 *
 * Failure modes: SavedOutfitError `not_found` / `not_saved`; PreviewReadOnlyError in the design preview; network and
 * permission errors as thrown. A wear recorded on another device between the read and the delete would be left with
 * outfit_id null (`on delete set null`); accepted for one user, it needs a wear at the same second as the removal.
 */
export async function removeSavedOutfit(outfitId: string): Promise<"unsaved" | "deleted"> {
  if (isPreview()) throw new PreviewReadOnlyError("removeSavedOutfit");
  const { data, error } = await supabase.from("outfits").select("saved_at,wears(id)").eq("id", outfitId).maybeSingle();
  if (error) throw error;
  if (!data) throw new SavedOutfitError("not_found", `outfit ${outfitId} not found`);
  const row = RemovalRowSchema.parse(data);
  if (row.saved_at === null) throw new SavedOutfitError("not_saved", `outfit ${outfitId} is not saved`);
  if (removalAction(row.wears.length) === "unsave") {
    const res = await supabase.from("outfits").update({ saved_at: null, is_favorite: false }).eq("id", outfitId);
    if (res.error) throw res.error;
    return "unsaved";
  }
  const res = await supabase.from("outfits").delete().eq("id", outfitId);
  if (res.error) throw res.error;
  return "deleted";
}

/** Throws `not_saved` when an update filtered on "is saved" touched no row. */
function requireUpdated(data: readonly unknown[] | null, outfitId: string): void {
  if (!data || data.length === 0) throw new SavedOutfitError("not_saved", `outfit ${outfitId} is not a saved outfit`);
}

/**
 * Favourite on or off. Only a saved outfit (the filter, and the database's `outfits_favorite_is_saved` check).
 * Failure modes: SavedOutfitError `not_saved` (missing, not saved, or RLS hides it); PreviewReadOnlyError; network and
 * permission errors as thrown. The screen writes optimistically and rolls back on any of them.
 */
export async function setOutfitFavorite(outfitId: string, favorite: boolean): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("setOutfitFavorite");
  const { data, error } = await supabase.from("outfits").update({ is_favorite: favorite }).eq("id", outfitId).not("saved_at", "is", null).select("id");
  if (error) throw error;
  requireUpdated(data, outfitId);
}

/**
 * Renames a saved outfit; returns the name as stored (trimmed; null when cleared).
 * Failure modes: SavedOutfitError `name_too_long` before any request; `not_saved`; PreviewReadOnlyError; network and
 * permission errors as thrown.
 */
export async function renameOutfit(outfitId: string, name: string | null): Promise<string | null> {
  const stored = normalizeOutfitName(name);
  if (isPreview()) throw new PreviewReadOnlyError("renameOutfit");
  const { data, error } = await supabase.from("outfits").update({ name: stored }).eq("id", outfitId).not("saved_at", "is", null).select("id");
  if (error) throw error;
  requireUpdated(data, outfitId);
  return stored;
}

const EditRowSchema = z.object({
  saved_at: z.string().nullable(),
  name: z.string().nullable(),
  is_favorite: z.boolean(),
  outfit_items: z.array(OutfitPieceSchema),
  wears: z.array(z.object({ id: z.string() })),
});
const SavedSetsSchema = z.array(z.object({ id: z.string(), saved_at: z.string().nullable(), outfit_items: z.array(z.object({ item_id: z.string() })) }));

/** The result of an edit: the outfit as stored, and the id it replaced when the edit became a new row (else null). */
export type EditResult = { outfit: SavedOutfit; replacedId: string | null };

/**
 * Edits a saved outfit (the build screen, DESIGN.md "שלב 5.2" items 4-5): its garments, "למתי" and name together.
 * What was worn is never rewritten, so the path depends on `editPlan` (data/savedOutfit.ts):
 *
 * In place (the garment set unchanged, or no wears): the same row; id, wears, favourite and `saved_at` stay.
 *   Writes: 1. insert the garments it gains; 2. re-slot kept ones whose slot changed (normally none); 3. delete the
 *   ones it loses; 4. update `context_type` and `name`. A failure at 1 changes nothing; at 2-3 the row holds the old
 *   set plus the new garments; at 4 the new set with the old name and context. Never part of a set. A retry re-reads
 *   and finishes (it inserts nothing twice).
 *
 * Copy (the set changes and the row has a wear of any feedback): a NEW saved row with the new garments and the old
 *   row's name-or-new-name, favourite and exact `saved_at` (its place in the collection does not move), the chosen
 *   context, `source: manual`, `created_for_date` = `date`. Writes: 1. insert the `outfits` row; 2. insert its
 *   `outfit_items` (on failure the new row is deleted again, as in saveOutfit, and nothing changed); 3. unsave the old
 *   row (`saved_at` null, `is_favorite` false): it keeps its garments and wears for history. Returns `replacedId`.
 *   A failure at 3 leaves BOTH rows saved (the old one, and the new one with the same `saved_at`): the collection shows
 *   both, side by side, until the edit is retried, and either can be removed by hand. It is thrown as SavedOutfitError
 *   `copy_saved_old_kept` (`otherId` = the new outfit, `cause` = the request's error), as is a failure while resuming. The build screen keeps the
 *   choices and shows the error with "נסה שוב"; that retry is recognised as `resume` (same new garments, same
 *   `saved_at`) and only writes the name and context on the copy and unsaves the old row. It does not answer
 *   "already saved". Only a crash between 1 and 2 can leave an empty saved row (as with saveOutfit).
 *
 * Refused before any write: zod (`invalid_input`), not exactly one top, bottom and shoes or more than one layer
 * (`invalid_outfit`), a name over 40 (`name_too_long`), the design preview (PreviewReadOnlyError); then `not_found`,
 * `not_saved`, and `same_garments` with `otherId` when another saved outfit (not a half-done copy) has the new set.
 * Network and permission errors are thrown as they come. Not one transaction: that needs an RPC, i.e. a migration.
 */
export async function updateSavedOutfit(outfitId: string, changes: UpdateOutfitInput): Promise<EditResult> {
  const parsed = UpdateOutfitInputSchema.safeParse(changes);
  if (!parsed.success) throw new SavedOutfitError("invalid_input", parsed.error.message);
  const input = parsed.data;
  assertSaveable(input.garments);
  const name = normalizeOutfitName(input.name);
  if (isPreview()) throw new PreviewReadOnlyError("updateSavedOutfit");

  const read = await supabase.from("outfits").select("saved_at,name,is_favorite,outfit_items(item_id,slot),wears(id)").eq("id", outfitId).maybeSingle();
  if (read.error) throw read.error;
  if (!read.data) throw new SavedOutfitError("not_found", `outfit ${outfitId} not found`);
  const row = EditRowSchema.parse(read.data);
  if (row.saved_at === null) throw new SavedOutfitError("not_saved", `outfit ${outfitId} is not saved`);
  const savedAt = row.saved_at;

  const sets = await supabase.from("outfits").select("id,saved_at,outfit_items(item_id)").not("saved_at", "is", null);
  if (sets.error) throw sets.error;
  const plan = editPlan({
    id: outfitId,
    savedAt,
    currentItemIds: row.outfit_items.map((g) => g.item_id),
    wearCount: row.wears.length,
    nextItemIds: input.garments.map((g) => g.item_id),
    saved: SavedSetsSchema.parse(sets.data ?? []).map((o) => ({ id: o.id, savedAt: o.saved_at, itemIds: o.outfit_items.map((i) => i.item_id) })),
  });

  if (plan.kind === "same_garments") throw new SavedOutfitError("same_garments", `saved outfit ${plan.otherId} already has these garments`, [], plan.otherId);
  if (plan.kind === "in_place") return { outfit: await editInPlace(outfitId, row.outfit_items, input, name), replacedId: null };

  let copyId: string;
  // From here on a copy exists: every failure says so (`copy_saved_old_kept`), so the screen can tell the user that
  // the new outfit IS saved and the old one is still in the collection, instead of "nothing was saved".
  const halfDone = (id: string, error: unknown) => new SavedOutfitError("copy_saved_old_kept", `outfit ${id} is saved but ${outfitId} is still in the collection`, [], id, error);
  if (plan.kind === "resume") {
    copyId = plan.copyId;
    const res = await supabase.from("outfits").update({ context_type: input.contextType, name }).eq("id", copyId).not("saved_at", "is", null).select("id");
    if (res.error) throw halfDone(copyId, res.error);
    if (!res.data || res.data.length === 0) throw new SavedOutfitError("not_saved", `outfit ${copyId} is not a saved outfit`);
  } else {
    const created = await supabase
      .from("outfits")
      .insert({ user_id: input.userId, context_type: input.contextType, created_for_date: input.date, source: "manual", name, is_favorite: row.is_favorite, saved_at: savedAt })
      .select("id")
      .single();
    if (created.error) throw created.error;
    copyId = String(created.data.id);
    const items = await supabase.from("outfit_items").insert(input.garments.map((g) => ({ outfit_id: copyId, item_id: g.item_id, slot: g.slot })));
    if (items.error) {
      // Just created, nothing points at it yet: deleting it loses nothing and leaves the outfit as it was.
      await supabase.from("outfits").delete().eq("id", copyId);
      throw items.error;
    }
  }
  const unsave = await supabase.from("outfits").update({ saved_at: null, is_favorite: false }).eq("id", outfitId);
  if (unsave.error) throw halfDone(copyId, unsave.error);
  return { outfit: await mustFetch(copyId), replacedId: outfitId };
}

/** The in-place path of updateSavedOutfit (write order and failure modes there). */
async function editInPlace(outfitId: string, current: UpdateOutfitInput["garments"], input: UpdateOutfitInput, name: string | null): Promise<SavedOutfit> {
  const plan = garmentChanges(current, input.garments);
  if (plan.add.length > 0) {
    const res = await supabase.from("outfit_items").insert(plan.add.map((g) => ({ outfit_id: outfitId, item_id: g.item_id, slot: g.slot })));
    if (res.error) throw res.error;
  }
  for (const g of plan.reslot) {
    const res = await supabase.from("outfit_items").update({ slot: g.slot }).eq("outfit_id", outfitId).eq("item_id", g.item_id);
    if (res.error) throw res.error;
  }
  if (plan.remove.length > 0) {
    const res = await supabase.from("outfit_items").delete().eq("outfit_id", outfitId).in("item_id", plan.remove);
    if (res.error) throw res.error;
  }
  const updated = await supabase.from("outfits").update({ context_type: input.contextType, name }).eq("id", outfitId).not("saved_at", "is", null).select("id");
  if (updated.error) throw updated.error;
  requireUpdated(updated.data, outfitId);
  return mustFetch(outfitId);
}

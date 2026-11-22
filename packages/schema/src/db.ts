import { z } from "zod";
import { CONTEXT_TYPES } from "./context.ts";
import { ItemSchema, type Item } from "./item.ts";
import { SLOTS } from "./stylist.ts";

/**
 * The only place that knows how an `items` row maps to the engine's `Item` and back. The app reads with
 * `itemFromRow`, the seed script writes with `itemToInsertRow`; one module so they cannot drift.
 * `tags` (jsonb) is the source of truth. The duplicated hot columns exist for SQL filters and are derived
 * from it on write, never read back (reading both would let a drifted copy win silently).
 */

/** Columns the app selects. Not `*`: original_path/user_id are not the client's business yet. */
export const ITEM_READ_COLUMNS = "id,name,brand,tags,status,availability,source,price,currency,purchased_at,cutout_path,thumb_path,notes";

// PostgREST returns `numeric` as a JSON number, but a string for values it cannot represent exactly. Accept both
// and let ItemSchema be the judge, instead of trusting the wire type.
const numericOrNull = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((v) => (v === null ? null : Number(v)));

export const ItemRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  tags: z.unknown(),
  status: z.string(),
  availability: z.string(),
  source: z.string(),
  price: numericOrNull,
  currency: z.string().nullable(),
  purchased_at: z.string().nullable(),
  cutout_path: z.string().nullable(),
  thumb_path: z.string().nullable().optional(),
  notes: z.string().nullable(),
});

/**
 * DB row to engine item. Throws a ZodError on a row that violates the frozen tag schema: a malformed item
 * must fail loudly at the boundary, not render as garbage three screens later.
 */
export function itemFromRow(row: unknown): Item {
  return ItemSchema.parse(ItemRowSchema.parse(row));
}

/** A row ready for `insert`/`upsert`: everything NOT NULL without a default, `id` and timestamps left to the DB. */
export type ItemInsertRow = {
  user_id: string;
  external_id: string;
  name: string;
  brand: string | null;
  tags: Item["tags"];
  category: string;
  subcategory: string;
  color_hex: string;
  color_name: string;
  pattern: string;
  material: string;
  formality: number;
  seasons: string[];
  temp_min_c: number;
  temp_max_c: number;
  modesty_flags: string[];
  status: Item["status"];
  availability: Item["availability"];
  source: Item["source"];
  price: number | null;
  currency: string | null;
  purchased_at: string | null;
  cutout_path: string | null;
  notes: string | null;
};

/**
 * Engine item to insert row. `item.id` becomes `external_id` (the sheet id): the DB assigns its own uuid, and
 * (user_id, external_id) is the unique key that makes re-running a seed an update instead of a duplicate.
 */
export function itemToInsertRow(item: Item, userId: string): ItemInsertRow {
  const t = item.tags;
  return {
    user_id: userId,
    external_id: item.id,
    name: item.name,
    brand: item.brand,
    tags: t,
    category: t.category,
    subcategory: t.subcategory,
    color_hex: t.color_hex,
    color_name: t.color_name,
    pattern: t.pattern,
    material: t.material,
    formality: t.formality,
    seasons: t.seasons,
    temp_min_c: t.temp_min_c,
    temp_max_c: t.temp_max_c,
    modesty_flags: t.modesty_flags,
    status: item.status,
    availability: item.availability,
    source: item.source,
    price: item.price,
    currency: item.currency,
    purchased_at: item.purchased_at,
    cutout_path: item.cutout_path,
    notes: item.notes,
  };
}

/**
 * `pair_weights` enforces item_a < item_b (uuid order). Postgres compares uuids bytewise, which for lowercase
 * canonical text is the same as string order, so a plain string compare picks the same side.
 */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export const WEAR_FEEDBACKS = ["worn", "skipped", "disliked"] as const;
export type WearFeedback = (typeof WEAR_FEEDBACKS)[number];

/** One wear with its outfit's items embedded (wears.outfit_id -> outfits -> outfit_items). */
export const WEAR_READ_COLUMNS = "id,worn_on,feedback,outfit_id,outfits(breakdown,outfit_items(item_id))";

/**
 * The adjustment an outfit was chosen under, stored inside `outfits.breakdown` (jsonb) so learning it needed no
 * migration. Absent on outfits from before it was recorded; those count as no adjustment.
 */
export const StoredAdjustmentSchema = z.object({ temp_steps: z.number().int(), formality_steps: z.number().int() });

export const WearRowSchema = z.object({
  id: z.string(),
  worn_on: z.string().date(),
  feedback: z.enum(WEAR_FEEDBACKS),
  outfit_id: z.string().nullable(),
  // null when the outfit was deleted (outfit_id is `on delete set null`); such a wear teaches nothing.
  outfits: z
    .object({
      // passthrough: the score breakdown keys are the stylist's business; only `adjustment` is read here.
      breakdown: z.object({ adjustment: StoredAdjustmentSchema.optional() }).passthrough().nullable(),
      outfit_items: z.array(z.object({ item_id: z.string() })),
    })
    .nullable(),
});
export type WearRow = z.infer<typeof WearRowSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Saved outfits (migration 0007, DESIGN.md "שלב 5.2")
// ---------------------------------------------------------------------------------------------------------------

/** `outfits.source` (enum outfit_source, migration 0001): engine suggestion, built by hand, or a swapped suggestion. */
export const OUTFIT_SOURCES = ["daily", "manual", "swap"] as const;
export type OutfitSource = (typeof OUTFIT_SOURCES)[number];

/**
 * The longest outfit name, in characters (code points).
 * don't touch / must equal the 40 in the `outfits_name_check` constraint of migration 0007_saved_outfits.sql.
 */
export const SAVED_OUTFIT_NAME_MAX = 40;

/**
 * One outfit row with its garments and its wears embedded: outfit_items -> items (the full item, so the flat-lay and
 * the legend need no second read) and wears (all of them, any feedback: the count of `worn` reads them, and so does
 * the decision "removing keeps the row"). A deleted item has no outfit_items row at all (`on delete cascade`).
 */
export const SAVED_OUTFIT_READ_COLUMNS = `id,name,is_favorite,saved_at,context_type,source,created_for_date,outfit_items(item_id,slot,item:items(${ITEM_READ_COLUMNS})),wears(worn_on,feedback)`;

export const SavedOutfitRowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  is_favorite: z.boolean(),
  // Nullable so an unsaved row (one a wear points at, read before it is marked saved) parses with the same schema.
  saved_at: z.string().nullable(),
  context_type: z.enum(CONTEXT_TYPES),
  source: z.enum(OUTFIT_SOURCES),
  created_for_date: z.string().date(),
  outfit_items: z.array(
    z.object({
      item_id: z.string(),
      slot: z.enum(SLOTS),
      // Left unknown here: itemFromRow judges each garment, so one malformed item does not hide the whole outfit.
      item: z.unknown(),
    })
  ),
  wears: z.array(z.object({ worn_on: z.string().date(), feedback: z.enum(WEAR_FEEDBACKS) })),
});
export type SavedOutfitRow = z.infer<typeof SavedOutfitRowSchema>;

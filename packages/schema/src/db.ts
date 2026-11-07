import { z } from "zod";
import { ItemSchema, type Item } from "./item";

/**
 * The only place that knows how an `items` row maps to the engine's `Item` and back. The app reads with
 * `itemFromRow`, the seed script writes with `itemToInsertRow`; one module so they cannot drift.
 * `tags` (jsonb) is the source of truth. The duplicated hot columns exist for SQL filters and are derived
 * from it on write, never read back (reading both would let a drifted copy win silently).
 */

/** Columns the app selects. Not `*`: original_path/thumb_path/user_id are not the client's business yet. */
export const ITEM_READ_COLUMNS = "id,name,brand,tags,status,availability,source,price,currency,purchased_at,cutout_path,notes";

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

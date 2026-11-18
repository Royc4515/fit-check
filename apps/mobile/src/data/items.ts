import type { ItemTags } from "@fit-check/schema";
import { supabase } from "../lib/supabase";
import { isPreview, PreviewReadOnlyError } from "./preview";

/**
 * Edits to an item already in the wardrobe (Roy, 2026-11-10: rename, fix tags, redraw, replace the photo, remove).
 * Every write goes through RLS as the signed-in user; the hot columns are kept in step with `tags` because the
 * engine and SQL filters read them, not the JSON.
 * In the design preview (web only, temporary) every write here throws PreviewReadOnlyError before reaching Supabase;
 * the item screen already shows a failed save and keeps the item as it was.
 */

/** Name, brand and the full tag set. Throws on a failed write so the screen can say so and roll back. */
export async function updateItemDetails(itemId: string, edit: { name: string; brand: string | null; tags: ItemTags }): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("updateItemDetails");
  const t = edit.tags;
  const { error } = await supabase
    .from("items")
    .update({
      name: edit.name,
      brand: edit.brand,
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) throw error;
}

/** Points the item at a new image in the cutouts bucket (a redraw, a new photo, or their cutouts). */
export async function setItemImage(itemId: string, cutoutPath: string, thumbPath: string | null): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("setItemImage");
  const { error } = await supabase
    .from("items")
    .update({ cutout_path: cutoutPath, thumb_path: thumbPath, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

/**
 * Removes the item from the wardrobe by archiving it, not deleting: wears and outfits that used it keep their
 * history, and it can come back (restoreItem). Archived items are never suggested or listed.
 */
export async function archiveItem(itemId: string): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("archiveItem");
  const { error } = await supabase.from("items").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", itemId);
  if (error) throw error;
}

export async function restoreItem(itemId: string): Promise<void> {
  if (isPreview()) throw new PreviewReadOnlyError("restoreItem");
  const { error } = await supabase.from("items").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", itemId);
  if (error) throw error;
}

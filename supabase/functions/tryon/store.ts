import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SLOTS } from "@fit-check/schema/stylist.ts";

/**
 * Where try-on images live. The existing private `originals` bucket under a `tryon/` prefix: no new bucket and no
 * migration (DESIGN.md "שלב 5.3": no table, no migration).
 * don't touch / why its policies are enough: `originals` is private (no public read), and its only policy, "own
 * originals", matches objects whose FIRST folder is the caller's uid. Under `tryon/...` the first folder is
 * "tryon", so no signed-in user can list, read, overwrite or delete these objects with their own token; only this
 * function (service role) writes them, and the app reads them through the short-lived signed URL it returns. Moving
 * the prefix to `{uid}/tryon/...` would let a client overwrite its cached image and skip the cap's record of it.
 * Changing the bucket is this one line.
 */
export const TRYON_BUCKET = "originals";
/** Garment images (items.cutout_path) are in the public `cutouts` bucket, read here with the service role. */
export const GARMENT_BUCKET = "cutouts";

/** The `items` columns the function reads; validated, because the untyped client returns rows of unknown shape. */
export const TryonItemRowSchema = z.object({
  id: z.string(),
  category: z.string(),
  subcategory: z.string(),
  color_name: z.string(),
  color_hex: z.string(),
  pattern: z.string(),
  material: z.string(),
  formality: z.number(),
  cutout_path: z.string().nullable(),
});
export type TryonItemRow = z.infer<typeof TryonItemRowSchema>;
export const ITEM_COLUMNS = "id,category,subcategory,color_name,color_hex,pattern,material,formality,cutout_path";

/** True when a stored category can fill a slot; outerwear and accessories are not outfit slots. */
export const fillsSlot = (category: string, slot: string) => (SLOTS as readonly string[]).includes(category) && category === slot;

export type UploadOutcome = "ok" | "exists" | "error";

/**
 * Everything the handler needs from Supabase, as a narrow port so tests stub it without a network or a cast.
 * Every method answers null (or "error") on failure instead of throwing.
 */
export interface TryonStore {
  /** The caller's own rows among `ids`; ids of other users simply do not come back. Null when the read failed. */
  readItems(userId: string, ids: readonly string[]): Promise<TryonItemRow[] | null>;
  readGarmentImage(path: string): Promise<Uint8Array | null>;
  /** Whether a try-on object exists; null when the bucket could not be listed. */
  exists(path: string): Promise<boolean | null>;
  download(path: string): Promise<Uint8Array | null>;
  upload(path: string, bytes: Uint8Array, contentType: string, upsert: boolean): Promise<UploadOutcome>;
  signedUrl(path: string, expiresInS: number): Promise<string | null>;
}

/**
 * The live store over a service-role client. Ownership is enforced in readItems by `user_id = userId`: the user's
 * token is never forwarded to Supabase from an Edge Function (see _shared/auth.ts for why), so RLS cannot do it here.
 */
export function supabaseStore(db: SupabaseClient): TryonStore {
  const download = async (bucket: string, path: string): Promise<Uint8Array | null> => {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error || !data) {
      console.error("tryon download failed", bucket, error?.message);
      return null;
    }
    return new Uint8Array(await data.arrayBuffer());
  };
  return {
    async readItems(userId, ids) {
      const { data, error } = await db.from("items").select(ITEM_COLUMNS).eq("user_id", userId).in("id", [...ids]);
      if (error) {
        console.error("tryon readItems failed", error.message);
        return null;
      }
      const rows = z.array(TryonItemRowSchema).safeParse(data ?? []);
      return rows.success ? rows.data : null;
    },
    readGarmentImage: (path) => download(GARMENT_BUCKET, path),
    async exists(path) {
      const slash = path.lastIndexOf("/");
      const dir = path.slice(0, slash);
      const name = path.slice(slash + 1);
      const { data, error } = await db.storage.from(TRYON_BUCKET).list(dir, { search: name, limit: 100 });
      if (error) {
        console.error("tryon exists failed", error.message);
        return null;
      }
      // `search` is a prefix match; only the exact name counts.
      return (data ?? []).some((o) => o.name === name);
    },
    download: (path) => download(TRYON_BUCKET, path),
    async upload(path, bytes, contentType, upsert) {
      const { error } = await db.storage.from(TRYON_BUCKET).upload(path, bytes, { contentType, upsert });
      if (!error) return "ok";
      console.error("tryon upload failed", error.message);
      return !upsert && /exist|duplicate|409/i.test(error.message) ? "exists" : "error";
    },
    async signedUrl(path, expiresInS) {
      const { data, error } = await db.storage.from(TRYON_BUCKET).createSignedUrl(path, expiresInS);
      if (error || !data?.signedUrl) {
        console.error("tryon sign failed", error?.message);
        return null;
      }
      return data.signedUrl;
    },
  };
}

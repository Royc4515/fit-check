/**
 * Where a stored garment image is read from. Pure (no Supabase client, no env) so it is unit-tested; the hook that
 * binds it to the app's configuration lives in `ItemArt.tsx`.
 */

/** The address to try first and the one to fall back to when it cannot be read. */
export type CutoutUrls = { primary: string; fallback: string | null };

/**
 * Builds the addresses of one stored image.
 *
 * With an R2 base, R2 is tried first and the Supabase bucket is the fallback: the images that existed on 2026-11-22
 * were copied to R2, but uploads still land in Supabase until the write path moves too, so a new garment is only in
 * Supabase. Without an R2 base, Supabase is the only address.
 *
 * @param path object key inside the `cutouts` bucket, as stored in `items.cutout_path` / `thumb_path`
 * @param r2Base public R2 origin without a trailing slash, or null when R2 is not configured
 * @param supabaseUrl maps a key to its public Supabase Storage address
 */
export function cutoutUrls(path: string, r2Base: string | null, supabaseUrl: (path: string) => string): CutoutUrls {
  if (!r2Base) return { primary: supabaseUrl(path), fallback: null };
  return { primary: `${r2Base}/${path.replace(/^\/+/, "")}`, fallback: supabaseUrl(path) };
}

/**
 * The address to show, given which primary address (if any) has already failed to load.
 *
 * Keyed by the failed address rather than a boolean so a recycled view that moves to another image starts from that
 * image's primary again without an effect to reset it.
 */
export function shownUri(urls: CutoutUrls, failedPrimary: string | null): string {
  return failedPrimary === urls.primary && urls.fallback !== null ? urls.fallback : urls.primary;
}

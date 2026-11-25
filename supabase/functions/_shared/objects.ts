import { AwsClient } from "aws4fetch";

/** The Supabase bucket garment images lived in before R2, and still the fallback for keys R2 does not have. */
export const GARMENT_BUCKET = "cutouts";

// don't touch / every key is written once under a unique name (a new suffix per cutout, thumb or redraw), so a
// year-long immutable cache is safe and is what keeps repeat views off the network. The 42 GB egress of 2026-11 came
// from images served with a one-hour cache.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Where R2 lives. All five values or nothing: a half-configured R2 would write where nobody reads. */
export type R2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public origin the app and Claude read from (r2.dev or a custom domain), no trailing slash. */
  publicUrl: string;
};

/**
 * Reads R2 settings from the function's environment (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL). Null when any is missing; callers then use Supabase Storage as before.
 */
export function r2ConfigFromEnv(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): R2Config | null {
  const accountId = get("R2_ACCOUNT_ID")?.trim();
  const bucket = get("R2_BUCKET")?.trim();
  const accessKeyId = get("R2_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = get("R2_SECRET_ACCESS_KEY")?.trim();
  const publicUrl = get("R2_PUBLIC_URL")?.trim().replace(/\/+$/, "");
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey, publicUrl };
}

/**
 * The part of a Supabase Storage bucket this module uses (`db.storage.from(GARMENT_BUCKET)` satisfies it), so tests
 * stub it without a network or a cast.
 */
export interface SupabaseBucket {
  download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean; cacheControl: string },
  ): Promise<{ error: { message: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

/** Garment image storage as the Edge Functions see it. Nothing here throws; failures answer null or false. */
export interface GarmentStore {
  /** The bytes at `path`: R2 first, then the Supabase bucket. Null when neither has it. */
  read(path: string): Promise<Uint8Array | null>;
  /** Writes `path` (replacing it if present). False when no store took the bytes. */
  write(path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  /** The public address of `path` in the store new images go to. */
  publicUrl(path: string): string;
}

// Each path segment encoded on its own: the slashes are the folder structure, not part of a name.
const encodeKey = (path: string) => path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

/**
 * Garment images in Cloudflare R2, with the Supabase `cutouts` bucket behind it.
 *
 * Why both: images that existed on 2026-11-22 were copied to R2 under the same keys, but the app still uploads its
 * own crops and pending photos to Supabase, so a read must find a key in either place. New images (cutouts, thumbs,
 * redraws, separated garments) are written to R2, where serving them costs no egress.
 * Without R2 settings this is the Supabase bucket alone, exactly as before.
 *
 * Failure modes: an R2 read that is not a 2xx (a 404 for a key only Supabase has, or an outage) falls back to
 * Supabase. An R2 write that fails is retried on Supabase and logged, so the feature still works and the app's
 * R2-then-Supabase read finds the image; that one image then costs Supabase egress until it is rewritten.
 *
 * @param bucket `db.storage.from(GARMENT_BUCKET)` on a service-role client
 * @param config R2 settings, or null to use Supabase only
 * @param fetchImpl injectable for tests
 */
export function garmentStore(
  bucket: SupabaseBucket,
  config: R2Config | null = r2ConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): GarmentStore {
  const supabaseRead = async (path: string): Promise<Uint8Array | null> => {
    const { data, error } = await bucket.download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  };
  const supabaseWrite = async (path: string, bytes: Uint8Array, contentType: string): Promise<boolean> => {
    const { error } = await bucket.upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
    if (error) console.error("supabase write failed", path, error.message);
    return !error;
  };

  if (!config) {
    return { read: supabaseRead, write: supabaseWrite, publicUrl: (path) => bucket.getPublicUrl(path).data.publicUrl };
  }

  const aws = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: "auto" });
  const objectUrl = (path: string) => `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encodeKey(path)}`;

  return {
    async read(path) {
      try {
        const res = await fetchImpl(await aws.sign(objectUrl(path), { method: "GET" }));
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        // A 404 is the normal case for a key the app uploaded to Supabase; anything else is worth a log line.
        if (res.status !== 404) console.error("r2 read failed", path, res.status);
        await res.body?.cancel();
      } catch (error) {
        console.error("r2 read failed", path, error instanceof Error ? error.message : String(error));
      }
      return await supabaseRead(path);
    },
    async write(path, bytes, contentType) {
      try {
        const res = await fetchImpl(
          await aws.sign(objectUrl(path), {
            method: "PUT",
            // A copy typed over a plain ArrayBuffer: newer Deno types reject a view over ArrayBufferLike as a body.
            body: bytes.slice(),
            headers: { "content-type": contentType, "cache-control": CACHE_CONTROL },
          }),
        );
        await res.body?.cancel();
        if (res.ok) return true;
        console.error("r2 write failed, using supabase", path, res.status);
      } catch (error) {
        console.error("r2 write failed, using supabase", path, error instanceof Error ? error.message : String(error));
      }
      return await supabaseWrite(path, bytes, contentType);
    },
    publicUrl: (path) => `${config.publicUrl}/${encodeKey(path)}`,
  };
}

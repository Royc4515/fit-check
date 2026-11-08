import { createClient } from "@supabase/supabase-js";
import { IntakeSeparateInputSchema, type ExtractedGarment } from "@fit-check/schema/intake.ts";
import { listGarments } from "../_shared/ai/anthropic.ts";
import { extractGarment } from "../_shared/ai/gemini.ts";
import { countAiCalls, logAiCall } from "../_shared/ai/log.ts";

/**
 * intake-separate: one photo in, one clean product image per garment out (docs/PLAN.md stage C, steps 1-2).
 *
 * Input (POST JSON): { original_path } of a photo the user already uploaded to the private `originals` bucket
 * under their own folder (`{uid}/...`). Auth: the caller's Supabase JWT; storage reads and writes run as that user,
 * so RLS keeps every user inside their own folder even if a path is forged.
 *
 * Steps: Haiku lists the garments (category + a precise description), then Gemini extracts each one onto white, in
 * parallel. Results go to the public `cutouts` bucket at `{uid}/intake/{photo}/{n}.png`. Nothing is written to
 * `items` here: the user confirms (and tags) on the next screen.
 *
 * Responses (JSON):
 * - 200 { ok: true, garments: ExtractedGarment[], skipped }  skipped = garments listed but not extracted
 * - 200 { ok: false, reason: "no_garments" | "ai_failed" }
 * - 400 bad_input / not_found, 401 unauthorized, 413 too_large, 429 daily_limit
 */

/** Spend guard: one photo is up to 7 calls (about $0.25 at most); 40 photos a day is a generous intake session. */
const DAILY_PHOTO_LIMIT = 40;
/** Phone photos are downscaled in the app; anything bigger than this is a mistake, not a photo. */
const MAX_BYTES = 8 * 1024 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

const MEDIA: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const auth = req.headers.get("authorization");
  if (!url || !anon || !auth) return json(401, { ok: false, reason: "unauthorized" });
  const supabase = createClient(url, anon, { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json(401, { ok: false, reason: "unauthorized" });
  const userId = userData.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const parsed = IntakeSeparateInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });
  const path = parsed.data.original_path;
  // Belt and braces: RLS already scopes storage to the user's folder, but a clear 400 beats a confusing 404.
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return json(400, { ok: false, reason: "bad_input" });
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = MEDIA[ext];
  if (!mediaType) return json(400, { ok: false, reason: "bad_input" });

  const used = await countAiCalls(userId, "separate", new Date(Date.now() - 24 * 3600 * 1000));
  // Each photo logs one listing call plus one call per garment; the cap is on photos, so divide roughly.
  if (used === null || used >= DAILY_PHOTO_LIMIT * 4) return json(429, { ok: false, reason: "daily_limit" });

  const download = await supabase.storage.from("originals").download(path);
  if (download.error || !download.data) return json(400, { ok: false, reason: "not_found" });
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, reason: "too_large" });

  const listed = await listGarments(bytes, mediaType);
  await logAiCall(userId, listed.log);
  if (!listed.output) return json(200, { ok: false, reason: "ai_failed" });
  if (listed.output.garments.length === 0) return json(200, { ok: false, reason: "no_garments" });

  const photoId = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const results = await Promise.all(
    listed.output.garments.map(async (g, n): Promise<ExtractedGarment | null> => {
      const extracted = await extractGarment(bytes, mediaType, g.description);
      await logAiCall(userId, extracted.log);
      if (!extracted.png) return null;
      const out = `${userId}/intake/${photoId}/${n + 1}.png`;
      // upsert off: the cutouts policy grants insert only, and photo ids are unique per upload anyway.
      const upload = await supabase.storage.from("cutouts").upload(out, extracted.png, { contentType: "image/png", upsert: false });
      if (upload.error) {
        console.error("cutout upload failed", upload.error);
        return null;
      }
      const publicUrl = supabase.storage.from("cutouts").getPublicUrl(out).data.publicUrl;
      return { category: g.category, description: g.description, path: out, url: publicUrl };
    })
  );
  const garments = results.filter((g): g is ExtractedGarment => g !== null);
  if (garments.length === 0) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, garments, skipped: results.length - garments.length });
});

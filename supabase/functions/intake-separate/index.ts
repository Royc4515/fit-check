import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IntakeSeparateInputSchema, type ExtractedGarment } from "@fit-check/schema/intake.ts";
import { enhanceGarment, segmentGarments } from "../_shared/ai/gemini.ts";
import { countAiCalls, logAiCall } from "../_shared/ai/log.ts";
import { cutOut, decodePhoto } from "../_shared/image/cutout.ts";

/**
 * intake-separate: photos in, one cutout per garment out (docs/PLAN.md stage C, steps 1-2).
 *
 * Two actions (POST JSON, validated by IntakeSeparateInputSchema):
 * - separate { original_path }: a photo the user uploaded to the private `originals/{uid}/...`. Gemini 2.5 Flash
 *   (free tier) returns a box and a pixel mask per garment; each garment is cut out of the real photo with a
 *   transparent background and stored at `cutouts/{uid}/intake/{photo}/{n}.png`. Costs $0.
 * - enhance { cutout_path, description }: on request only, the paid image model redraws one cutout as a clean
 *   product photo, stored next to it as `{n}-enhanced.png`. While the project has no billing this returns
 *   reason "billing_required" and the free cutout stays as it is.
 * Nothing is written to `items`; the user confirms and tags on the next screen.
 *
 * Auth: the caller's Supabase JWT. Storage reads and writes run as that user, so RLS keeps everyone in their folder.
 * Responses: 200 { ok: true, ... } | 200 { ok: false, reason } | 400 bad_input / not_found | 401 | 413 | 429.
 */

/** Free-tier guard: Google's free quota for 2.5 Flash is a few hundred requests a day; stay well under it. */
const DAILY_SEPARATE_LIMIT = 60;
/** Spend guard for the paid path: 20 enhancements a day is at most about $0.70. */
const DAILY_ENHANCE_LIMIT = 20;
const MAX_BYTES = 8 * 1024 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

const MEDIA: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const ownPath = (userId: string, path: string) => path.startsWith(`${userId}/`) && !path.includes("..");

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
  const input = parsed.data;
  return input.action === "enhance"
    ? await enhance(supabase, userId, input.cutout_path, input.description)
    : await separate(supabase, userId, input.original_path);
});

async function separate(supabase: SupabaseClient, userId: string, path: string): Promise<Response> {
  const mediaType = MEDIA[path.split(".").pop()?.toLowerCase() ?? ""];
  if (!ownPath(userId, path) || !mediaType) return json(400, { ok: false, reason: "bad_input" });

  const used = await countAiCalls(userId, "separate", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_SEPARATE_LIMIT + DAILY_ENHANCE_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  const download = await supabase.storage.from("originals").download(path);
  if (download.error || !download.data) return json(400, { ok: false, reason: "not_found" });
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, reason: "too_large" });

  const result = await segmentGarments(bytes, mediaType);
  await logAiCall(userId, result.log);
  if (!result.segments) return json(200, { ok: false, reason: result.log.error?.startsWith("HTTP 429") ? "rate_limited" : "ai_failed" });
  if (result.segments.length === 0) return json(200, { ok: false, reason: "no_garments" });

  const photo = await decodePhoto(bytes);
  const photoId = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const garments: ExtractedGarment[] = [];
  // Sequential on purpose: each cutout holds a full-size bitmap, and the Edge runtime's memory is small.
  for (const [n, seg] of result.segments.entries()) {
    const png = await cutOut(photo, seg.box, seg.mask).catch((error) => {
      console.error("cutout failed", error);
      return null;
    });
    if (!png) continue;
    const out = `${userId}/intake/${photoId}/${n + 1}.png`;
    // upsert off: the cutouts policy grants insert only, and photo ids are unique per upload.
    const upload = await supabase.storage.from("cutouts").upload(out, png, { contentType: "image/png", upsert: false });
    if (upload.error) {
      console.error("cutout upload failed", upload.error);
      continue;
    }
    garments.push({ category: seg.category, description: seg.description, path: out, url: publicUrl(supabase, out) });
  }
  if (garments.length === 0) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, garments, skipped: result.segments.length - garments.length });
}

async function enhance(supabase: SupabaseClient, userId: string, cutoutPath: string, description: string): Promise<Response> {
  if (!ownPath(userId, cutoutPath) || !cutoutPath.endsWith(".png") || cutoutPath.endsWith("-enhanced.png")) {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const used = await countAiCalls(userId, "separate", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_SEPARATE_LIMIT + DAILY_ENHANCE_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  const download = await supabase.storage.from("cutouts").download(cutoutPath);
  if (download.error || !download.data) return json(400, { ok: false, reason: "not_found" });
  const bytes = new Uint8Array(await download.data.arrayBuffer());

  const result = await enhanceGarment(bytes, "image/png", description);
  await logAiCall(userId, result.log);
  if (!result.png) return json(200, { ok: false, reason: result.billingRequired ? "billing_required" : "ai_failed" });

  const out = cutoutPath.replace(/\.png$/, "-enhanced.png");
  const upload = await supabase.storage.from("cutouts").upload(out, result.png, { contentType: "image/png", upsert: false });
  if (upload.error) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, path: out, url: publicUrl(supabase, out) });
}

function publicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl;
}

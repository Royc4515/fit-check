import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, authenticate } from "../_shared/auth.ts";
import { IntakeSeparateInputSchema } from "@fit-check/schema/intake.ts";
import { DETECT_MODEL, detectGarments, ENHANCE_MODEL, enhanceGarment } from "../_shared/ai/gemini.ts";
import { countAiCalls, logAiCall, sumAiCost } from "../_shared/ai/log.ts";

/**
 * intake-separate: finds the garments in a photo, and optionally redraws one (docs/PLAN.md stage C, steps 1-2).
 *
 * Two actions (POST JSON, validated by IntakeSeparateInputSchema):
 * - detect { original_path }: a photo the user uploaded to the private `originals/{uid}/...`. Gemini 3.8 Flash
 *   (paid key first, free as fallback) returns per garment a box, a rough category, a description and the problems
 *   with the shot (hidden, overlapping, cut off, creased, blurry, dark). Under a cent per photo. The app crops the real photo itself and uploads the
 *   crops; doing it here needed an image library that crashed the Edge runtime at boot.
 * - enhance { cutout_path, description }: on request only, the paid image model redraws one crop the app uploaded
 *   to `cutouts/{uid}/...` as a complete, clean product photo (`...-enhanced.png`). While the project has no
 *   billing it answers reason "billing_required" and the crop stays as it is.
 * Nothing is written to `items`; the user confirms and tags on the next screen.
 *
 * Auth: the caller's Supabase JWT, verified locally (_shared/auth.ts). Storage runs as the service role; ownPath()
 * keeps every read and write inside the caller's folder.
 * Responses: 200 { ok: true, ... } | 200 { ok: false, reason } | 400 bad_input / not_found | 401 | 413 | 429.
 */

/**
 * Runaway-loop guards only; the money guard is MONTHLY_GOOGLE_BUDGET_USD below. Raised 2026-11-10 when Roy hit
 * the old 80/day while uploading his whole wardrobe at about $1.55 a day.
 */
const DAILY_DETECT_LIMIT = 200;
/** 60 redraws a day is at most about $2; the monthly cap still stops spending at $8. */
const DAILY_ENHANCE_LIMIT = 60;
/**
 * Hard monthly cap on paid Google calls (redraws and paid detection together), in USD, below the $10 monthly
 * Google Cloud credit from Google AI Pro (Roy: no real money). Counted across all users from ai_calls, because the
 * credit belongs to the project, not to a user. Past it, detection drops to the free tier and redraws stop.
 */
const MONTHLY_GOOGLE_BUDGET_USD = 8;

/** Paid Google spend since the 1st of this month (UTC); null when it cannot be read, which callers treat as spent. */
async function monthlyGoogleSpend(): Promise<number | null> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [enhance, detect] = await Promise.all([sumAiCost(ENHANCE_MODEL, since), sumAiCost(DETECT_MODEL, since)]);
  return enhance === null || detect === null ? null : enhance + detect;
}
const MAX_BYTES = 8 * 1024 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

const MEDIA: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const mediaOf = (path: string) => MEDIA[path.split(".").pop()?.toLowerCase() ?? ""];
const ownPath = (userId: string, path: string) => path.startsWith(`${userId}/`) && !path.includes("..");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });

  const auth = await authenticate(req);
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized", detail: auth.detail });
  const { userId } = auth;
  // Service role: the user's token is never forwarded (see _shared/auth.ts); ownPath() below keeps every read and
  // write inside this user's folder instead of RLS.
  const supabase = adminClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const parsed = IntakeSeparateInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });
  const input = parsed.data;

  const used = await countAiCalls(userId, "separate", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_DETECT_LIMIT + DAILY_ENHANCE_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  return input.action === "enhance"
    ? await enhance(supabase, userId, input.cutout_path, input.description)
    : await detect(supabase, userId, input.original_path, input.single ?? false);
});

async function download(supabase: SupabaseClient, bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) console.error("download failed", bucket, error.message);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}

async function detect(supabase: SupabaseClient, userId: string, path: string, single: boolean): Promise<Response> {
  const mediaType = mediaOf(path);
  if (!ownPath(userId, path) || !mediaType) return json(400, { ok: false, reason: "bad_input" });
  const bytes = await download(supabase, "originals", path);
  if (!bytes) return json(400, { ok: false, reason: "not_found" });
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, reason: "too_large" });

  const spent = await monthlyGoogleSpend();
  const result = await detectGarments(bytes, mediaType, spent !== null && spent < MONTHLY_GOOGLE_BUDGET_USD, single);
  await logAiCall(userId, result.log);
  if (!result.garments) {
    console.error("detect failed", result.log.error);
    return json(200, { ok: false, reason: /^HTTP (429|500|503)/.test(result.log.error ?? "") ? "rate_limited" : "ai_failed" });
  }
  if (result.garments.length === 0) return json(200, { ok: false, reason: "no_garments" });
  return json(200, { ok: true, garments: result.garments });
}

async function enhance(supabase: SupabaseClient, userId: string, cutoutPath: string, description: string): Promise<Response> {
  const mediaType = mediaOf(cutoutPath);
  if (!ownPath(userId, cutoutPath) || !mediaType || cutoutPath.includes("-enhanced")) return json(400, { ok: false, reason: "bad_input" });
  const spent = await monthlyGoogleSpend();
  if (spent === null || spent >= MONTHLY_GOOGLE_BUDGET_USD) return json(200, { ok: false, reason: "monthly_limit" });

  const bytes = await download(supabase, "cutouts", cutoutPath);
  if (!bytes) return json(400, { ok: false, reason: "not_found" });

  const result = await enhanceGarment(bytes, mediaType, description);
  await logAiCall(userId, result.log);
  if (!result.png) {
    console.error("enhance failed", result.log.error);
    return json(200, { ok: false, reason: result.billingRequired ? "billing_required" : "ai_failed" });
  }

  // A new name per redraw: an item can be redrawn again later from the item page, and each result is kept.
  const out = cutoutPath.replace(/\.[^.]+$/, `-enhanced-${Date.now()}.png`);
  const upload = await supabase.storage.from("cutouts").upload(out, result.png, { contentType: "image/png", upsert: false });
  if (upload.error) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, path: out, url: supabase.storage.from("cutouts").getPublicUrl(out).data.publicUrl });
}

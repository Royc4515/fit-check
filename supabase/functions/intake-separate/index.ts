import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IntakeSeparateInputSchema } from "@fit-check/schema/intake.ts";
import { detectGarments, ENHANCE_MODEL, enhanceGarment } from "../_shared/ai/gemini.ts";
import { countAiCalls, logAiCall, sumAiCost } from "../_shared/ai/log.ts";

/**
 * intake-separate: finds the garments in a photo, and optionally redraws one (docs/PLAN.md stage C, steps 1-2).
 *
 * Two actions (POST JSON, validated by IntakeSeparateInputSchema):
 * - detect { original_path }: a photo the user uploaded to the private `originals/{uid}/...`. Gemini 3.8 Flash
 *   (free tier) returns per garment a box, a category, a description and the problems with the shot (hidden,
 *   overlapping, cut off, creased, blurry, dark). Costs $0. The app crops the real photo itself and uploads the
 *   crops; doing it here needed an image library that crashed the Edge runtime at boot.
 * - enhance { cutout_path, description }: on request only, the paid image model redraws one crop the app uploaded
 *   to `cutouts/{uid}/...` as a complete, clean product photo (`...-enhanced.png`). While the project has no
 *   billing it answers reason "billing_required" and the crop stays as it is.
 * Nothing is written to `items`; the user confirms and tags on the next screen.
 *
 * Auth: the caller's Supabase JWT. Storage reads and writes run as that user, so RLS keeps everyone in their folder.
 * Responses: 200 { ok: true, ... } | 200 { ok: false, reason } | 400 bad_input / not_found | 401 | 413 | 429.
 */

/** Free-tier guard: well under Google's free daily quota, and a generous day of adding clothes. */
const DAILY_DETECT_LIMIT = 60;
/** Spend guard for the paid path: 20 redraws a day is at most about $0.70. */
const DAILY_ENHANCE_LIMIT = 20;
/**
 * Hard monthly cap on redraws, in USD, below the $10 monthly Google Cloud credit from Google AI Pro (Roy: no real
 * money). Counted across all users from ai_calls, because the credit belongs to the project, not to a user.
 */
const MONTHLY_ENHANCE_BUDGET_USD = 8;
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

  const used = await countAiCalls(userId, "separate", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_DETECT_LIMIT + DAILY_ENHANCE_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  return input.action === "enhance"
    ? await enhance(supabase, userId, input.cutout_path, input.description)
    : await detect(supabase, userId, input.original_path);
});

async function download(supabase: SupabaseClient, bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}

async function detect(supabase: SupabaseClient, userId: string, path: string): Promise<Response> {
  const mediaType = mediaOf(path);
  if (!ownPath(userId, path) || !mediaType) return json(400, { ok: false, reason: "bad_input" });
  const bytes = await download(supabase, "originals", path);
  if (!bytes) return json(400, { ok: false, reason: "not_found" });
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, reason: "too_large" });

  const result = await detectGarments(bytes, mediaType);
  await logAiCall(userId, result.log);
  if (!result.garments) return json(200, { ok: false, reason: result.log.error?.startsWith("HTTP 429") ? "rate_limited" : "ai_failed" });
  if (result.garments.length === 0) return json(200, { ok: false, reason: "no_garments" });
  return json(200, { ok: true, garments: result.garments });
}

async function enhance(supabase: SupabaseClient, userId: string, cutoutPath: string, description: string): Promise<Response> {
  const mediaType = mediaOf(cutoutPath);
  if (!ownPath(userId, cutoutPath) || !mediaType || cutoutPath.includes("-enhanced")) return json(400, { ok: false, reason: "bad_input" });
  const now = new Date();
  const spent = await sumAiCost(ENHANCE_MODEL, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  if (spent === null || spent >= MONTHLY_ENHANCE_BUDGET_USD) return json(200, { ok: false, reason: "monthly_limit" });

  const bytes = await download(supabase, "cutouts", cutoutPath);
  if (!bytes) return json(400, { ok: false, reason: "not_found" });

  const result = await enhanceGarment(bytes, mediaType, description);
  await logAiCall(userId, result.log);
  if (!result.png) return json(200, { ok: false, reason: result.billingRequired ? "billing_required" : "ai_failed" });

  const out = cutoutPath.replace(/\.[^.]+$/, "-enhanced.png");
  // upsert off: the cutouts policy grants insert only; a second redraw of the same crop is refused, not overwritten.
  const upload = await supabase.storage.from("cutouts").upload(out, result.png, { contentType: "image/png", upsert: false });
  if (upload.error) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, path: out, url: supabase.storage.from("cutouts").getPublicUrl(out).data.publicUrl });
}

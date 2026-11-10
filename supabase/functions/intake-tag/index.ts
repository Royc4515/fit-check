import { IntakeTagInputSchema } from "@fit-check/schema/intake.ts";
import { adminClient, authenticate } from "../_shared/auth.ts";
import { countAiCalls, logAiCall } from "../_shared/ai/log.ts";
import { DEFAULT_TAG_MODEL, tagItem, type TagCorrection, type WardrobeLine } from "../_shared/ai/tagger.ts";
import { findDuplicate, MAX_CANDIDATES, type Candidate } from "../_shared/ai/duplicates.ts";

/**
 * intake-tag: proposes the full tag set for one cropped garment, for the user to confirm (PRD section 4, step 3).
 *
 * Input (POST JSON, IntakeTagInputSchema): `cutout_path` of a crop the app uploaded to `cutouts/{uid}/...`, an
 * optional `label_path` (a care-label photo in the same bucket and folder), detection's `hint`, and an optional
 * `model` for the Haiku/Sonnet trial. Reads the user's wardrobe names and latest tag corrections so the proposal
 * uses his vocabulary and learns from his fixes. Then compares the crop with up to 4 look-alikes already in the
 * wardrobe (same type and colour) and returns `duplicate` when one is the same garment. Writes nothing but the
 * ai_calls rows; saving is the app's job.
 *
 * Responses: 200 { ok: true, proposal, model } | 200 { ok: false, reason } | 400 bad_input / not_found | 401 | 429.
 */

/** A generous day of adding clothes: two calls per garment (tags, duplicate check), a fraction of a cent each. */
const DAILY_TAG_LIMIT = 160;
/** Latest corrections fed back as examples: enough to show a pattern, few enough to keep the prompt short. */
const MAX_CORRECTIONS = 15;
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
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized" });
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const parsed = IntakeTagInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });
  const input = parsed.data;
  for (const path of [input.cutout_path, input.label_path]) {
    if (path !== undefined && (!ownPath(userId, path) || !mediaOf(path))) return json(400, { ok: false, reason: "bad_input" });
  }

  const used = await countAiCalls(userId, "tag", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_TAG_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  // Service role (see _shared/auth.ts); every query below is filtered to this user explicitly.
  const supabase = adminClient();
  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from("cutouts").download(path);
    if (error || !data) {
      console.error("download failed", path, error?.message);
      return null;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    return bytes.length > MAX_BYTES ? null : { bytes, mediaType: mediaOf(path)! };
  };

  const [image, label, wardrobeRes, correctionsRes] = await Promise.all([
    download(input.cutout_path),
    input.label_path ? download(input.label_path) : Promise.resolve(undefined),
    supabase.from("items").select("name, brand, subcategory, color_name, material").eq("user_id", userId).eq("status", "active").order("created_at"),
    supabase
      .from("tag_corrections")
      .select("final, proposed, changed")
      .eq("user_id", userId)
      .neq("changed", "{}")
      .order("created_at", { ascending: false })
      .limit(MAX_CORRECTIONS),
  ]);
  if (!image || label === null) return json(400, { ok: false, reason: "not_found" });
  if (wardrobeRes.error) console.error("wardrobe read failed", wardrobeRes.error.message);
  if (correctionsRes.error) console.error("corrections read failed", correctionsRes.error.message);

  const corrections: TagCorrection[] = (correctionsRes.data ?? []).map((row) => {
    const final = (row.final ?? {}) as Record<string, unknown>;
    return { name: String(final.name ?? "item"), changed: row.changed as string[], proposed: row.proposed as Record<string, unknown>, final };
  });

  const model = input.model ?? DEFAULT_TAG_MODEL;
  const result = await tagItem({
    image,
    label: label ?? undefined,
    hint: input.hint,
    wardrobe: (wardrobeRes.data ?? []) as WardrobeLine[],
    corrections,
    model,
  });
  await logAiCall(userId, result.log);
  if (!result.proposal) {
    console.error("tag failed", result.log.error);
    return json(200, { ok: false, reason: result.log.error === "rate limited" ? "rate_limited" : "ai_failed" });
  }

  // Duplicate check: look-alikes by the proposed type and colour, compared on their stored images.
  const { data: lookalikes } = await supabase
    .from("items")
    .select("id, name, cutout_path, thumb_path")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("subcategory", result.proposal.tags.subcategory)
    .eq("color_name", result.proposal.tags.color_name)
    // Sleeve length is decisive (Roy, 2026-11-10): a short-sleeved twin of a long-sleeved shirt is another garment.
    .eq("tags->>sleeve", result.proposal.tags.sleeve)
    .not("cutout_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_CANDIDATES);
  const candidates: Candidate[] = [];
  for (const row of lookalikes ?? []) {
    const path = (row.thumb_path ?? row.cutout_path) as string;
    if (!ownPath(userId, path)) continue;
    const img = await download(path);
    if (img) candidates.push({ id: row.id as string, name: row.name as string, image: img });
  }
  let duplicate: { item_id: string; name: string; image_path: string } | null = null;
  if (candidates.length > 0) {
    const dup = await findDuplicate(image, candidates);
    await logAiCall(userId, dup.log);
    const row = (lookalikes ?? []).find((r) => r.id === dup.matchId);
    if (row) duplicate = { item_id: row.id as string, name: row.name as string, image_path: (row.cutout_path ?? row.thumb_path) as string };
  }
  return json(200, { ok: true, proposal: result.proposal, model, duplicate });
});

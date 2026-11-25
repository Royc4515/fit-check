import { IntakeCutoutInputSchema } from "@fit-check/schema/intake.ts";
import { adminClient, authenticate } from "../_shared/auth.ts";
import { removeBackground } from "../_shared/ai/background.ts";
import { countAiCalls, logAiCall } from "../_shared/ai/log.ts";
import { GARMENT_BUCKET, garmentStore } from "../_shared/objects.ts";
import { userAllows } from "../_shared/quota.ts";

/**
 * intake-cutout: removes the background of one cropped garment (PRD section 4, step 3).
 *
 * Input (POST JSON, IntakeCutoutInputSchema): `cutout_path` of a crop the app uploaded to `cutouts/{uid}/...`.
 * Removes its background (removeBackground: Cloudflare Images, the Modal worker as fallback) and stores
 * `<crop>-cutout.png` (transparent, trimmed) and `<crop>-thumb.png` (400 px) next to it, in R2 when it is configured
 * (see _shared/objects.ts). Free: Cloudflare's monthly free transformations, then Modal's $1 monthly credit.
 *
 * Responses: 200 { ok: true, path, url, thumb_path } | 200 { ok: false, reason } with reason "not_configured"
 * (no provider set up; the app keeps the crop), "cutout_monthly_limit", "user_monthly_limit" (this user's own
 * allowance in _shared/quota.ts) or "ai_failed" | 400 bad_input / not_found |
 * 401 | 429 daily_limit (80 a day).
 */

// don't touch / a thirtieth of the month: Cloudflare's free plan covers 2,400 cutouts a month (cloudflare.ts), so 80 a
// day lets a day of adding clothes through while one runaway day cannot use up the month. Was 40 while Modal's $1
// credit was the only provider.
const DAILY_CUTOUT_LIMIT = 80;
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
  const parsed = IntakeCutoutInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });
  const path = parsed.data.cutout_path;
  const mediaType = mediaOf(path);
  // The app's own crops and redraws only: never a previous cutout, thumbnail or label photo.
  if (!ownPath(userId, path) || !mediaType || /-(cutout|thumb|label)/.test(path)) {
    return json(400, { ok: false, reason: "bad_input" });
  }

  const used = await countAiCalls(userId, "cutout", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_CUTOUT_LIMIT) return json(429, { ok: false, reason: "daily_limit" });
  if (!(await userAllows(userId, "cutout"))) return json(200, { ok: false, reason: "user_monthly_limit" });

  // Service role (see _shared/auth.ts); ownPath() above keeps reads and writes in this user's folder.
  const store = garmentStore(adminClient().storage.from(GARMENT_BUCKET));
  const bytes = await store.read(path);
  if (!bytes) return json(400, { ok: false, reason: "not_found" });
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, reason: "too_large" });

  // A redraw shows one garment on white; SAM (Modal only) would just add time and a small risk of trimming it.
  const result = await removeBackground(bytes, mediaType, !/-enhanced/.test(path), (entry) => logAiCall(userId, entry));
  if (!result.ok) {
    if (result.reason !== "not_configured") console.error("cutout failed", result.error);
    return json(200, { ok: false, reason: result.reason });
  }

  const stem = path.replace(/\.[^.]+$/, "");
  const outPath = `${stem}-cutout.png`;
  const thumbPath = `${stem}-thumb.png`;
  // A write replaces an existing key, so re-running the same crop (a retry after a timeout) replaces its cutout.
  const [a, b] = await Promise.all([store.write(outPath, result.cutout, "image/png"), store.write(thumbPath, result.thumb, "image/png")]);
  if (!a || !b) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, path: outPath, thumb_path: thumbPath, url: store.publicUrl(outPath) });
});
